const config = require("../../config");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { buffer_to_stream } = require("../../util/streamutil");

const PUBLIC_DOMAIN_IMAGES = [
    {
        name: 'starry-night',
        url: 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg',
        file: 'starry.jpg',
    },
];

class TestImageService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('test-image', {
            methods: {
                echo_image: {
                    parameters: {
                        source: {
                            type: 'file',
                        },
                    },
                    result: {
                        type: {
                            $: 'stream',
                            content_type: 'image'
                        },
                    },
                },
                get_image: {
                    parameters: {
                        source_type: {
                            type: 'string'
                        },
                    },
                    result: {
                        type: {
                            $: 'stream',
                            content_type: 'image'
                        }
                    }
                }
            }
        });
    }

    static IMPLEMENTS = {
        ['version']: {
            get_version () {
                return 'v1.0.0';
            }
        },
        ['test-image']: {
            async echo_image ({
                source,
            }) {
                const stream = await source.get('stream');
                return new TypedValue({
                    $: 'stream',
                    content_type: 'image/jpeg'
                }, stream);
            },
            async get_image ({
                source_type,
            }) {
                const image = PUBLIC_DOMAIN_IMAGES[0];
                if ( source_type === 'string:url:web' ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, `${config.origin}/test-assets/${image.file}`);
                }
                throw new Error('not implemented yet');
            }
        },
    }
}

module.exports = {
    TestImageService
};
