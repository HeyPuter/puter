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
                        },
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
        this.convertapi = this.require('convertapi')(this.config.token);
    }

    static IMPLEMENTS = {
        ['convert-files']: {
            async convert ({ from, to, source }) {
                const convertapi = this.convertapi;
                const axios = this.require('axios');

                const fsNode = await source.get('fs-node');
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode,
                });
                
                const name = await fsNode.get('name');

                const uploadResult =
                    await convertapi.upload(stream, name);

                const convertResult =
                    await convertapi.convert(to, { File: uploadResult },
                        ...( from ? [ from ] : [] ));

                const fileInfo = convertResult?.response?.Files?.[0];

                const downloadResponse = await axios.get(fileInfo.Url, {
                    responseType: 'stream',
                });

                return new TypedValue({
                    $: 'stream',
                    content_type: mime.contentType(fileInfo.FileName),
                }, downloadResponse.data);
            }
        }
    };
}

module.exports = ConvertAPIService;
