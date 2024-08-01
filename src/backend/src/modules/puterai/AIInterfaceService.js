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
    }
}

module.exports = {
    AIInterfaceService
};
