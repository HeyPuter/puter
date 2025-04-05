const APIError = require("../../api/APIError");
const { HLWrite } = require("../../filesystem/hl_operations/hl_write");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { Context } = require("../../util/context");

const mime = require('mime-types');

class ConvertAPIService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('convert-files', {
            description: 'Convert between various data formats.',
            methods: {
                convert: {
                    description: 'Convert data from one format to another.',
                    parameters: {
                        from: {
                            type: 'string',
                            description: 'Source data format.',
                        },
                        to: {
                            type: 'string',
                            description: 'Destination data format.',
                            required: true,
                        },
                        source: {
                            type: 'file',
                            required: true,
                        },
                        
                        // File output mode
                        dest: {
                            type: 'file',
                        },
                        overwrite: { type: 'flag' },
                        dedupe_name: { type: 'flag' },
                    },
                    result_choices: [
                        {
                            type: {
                                $: 'stream',
                            }
                        },
                    ]
                },
            }
        });
    }

    static MODULES = {
        axios: require('axios'),
        convertapi: require('convertapi'),
    }
    
    async _init () {
        this.microcents_per_conversion =
            this.config.microcents_per_conversion ?? 4_500_000 // 4.5 cents
        this.convertapi = this.require('convertapi')(this.config.token);
    }

    static IMPLEMENTS = {
        ['convert-files']: {
            async convert ({
                // Require parameters
                from, to, source,

                // File Output Mode
                dest, overwrite, dedupe_name,
            }) {
                const convertapi = this.convertapi;
                const axios = this.require('axios');

                const fsNode = await source.get('fs-node');
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode,
                });
                
                const name = await fsNode.get('name');
                
                {
                    const svc_cost = this.services.get('cost')
                    const usageAllowed = await svc_cost.get_funding_allowed({
                        minimum: this.microcents_per_conversion,
                    });
                    if ( ! usageAllowed ) {
                        throw APIError.create('insufficient_funds');
                    }
                    await svc_cost.record_cost({
                        cost: this.microcents_per_conversion
                    });
                }

                const uploadResult =
                    await convertapi.upload(stream, name);

                const convertResult =
                    await convertapi.convert(to, { File: uploadResult },
                        ...( from ? [ from ] : [] ));

                const fileInfo = convertResult?.response?.Files?.[0];

                const downloadResponse = await axios.get(fileInfo.Url, {
                    responseType: 'stream',
                });

                if ( dest !== undefined ) {
                    const hl_write = new HLWrite();
                    return await hl_write.run({
                        destination_or_parent: await dest.get('fs-node'),
                        fallback_name: fileInfo.FileName,
                        overwrite,
                        dedupe_name,
                        file: {
                            originalname: fileInfo.FileName,
                            stream: downloadResponse.data,
                            size: fileInfo.FileSize,
                        },
                        actor: Context.get('actor'),
                    });
                }

                return new TypedValue({
                    $: 'stream',
                    content_type: mime.contentType(fileInfo.FileName),
                }, downloadResponse.data);
            }
        }
    };
}

module.exports = ConvertAPIService;
