const BaseService = require("../../services/BaseService");

class AIInterfaceService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('puter-ocr', {
            description: 'Optical character recognition',
            methods: {
                recognize: {
                    description: 'Recognize text in an image or document.',
                    parameters: {
                        source: {
                            type: 'file',
                        },
                    },
                    result: {
                        type: {
                            $: 'stream',
                            content_type: 'image',
                        }
                    },
                },
            }
        });

        col_interfaces.set('puter-chat-completion', {
            description: 'Chatbot.',
            methods: {
                complete: {
                    description: 'Get completions for a chat log.',
                    parameters: {
                        messages: { type: 'json' },
                        vision: { type: 'flag' },
                    },
                    result: { type: 'json' }
                }
            }
        });

        col_interfaces.set('puter-image-generation', {
            description: 'AI Image Generation.',
            methods: {
                generate: {
                    description: 'Generate an image from a prompt.',
                    parameters: {
                        prompt: { type: 'string' },
                    },
                    result_choices: [
                        {
                            names: ['image'],
                            type: {
                                $: 'stream',
                                content_type: 'image',
                            }
                        },
                        {
                            names: ['url'],
                            type: {
                                $: 'string:url:web',
                                content_type: 'image',
                            }
                        },
                    ],
                    result: {
                        description: 'URL of the generated image.',
                        type: 'string'
                    }
                }
            }
        });
    }
}

module.exports = {
    AIInterfaceService
};
