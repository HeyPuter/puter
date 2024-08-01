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
    }
}

module.exports = {
    AIInterfaceService
};
