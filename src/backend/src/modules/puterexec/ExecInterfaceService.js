const BaseService = require("../../services/BaseService");

class ExecInterfaceService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('puter-exec', {
            description: 'Execute code with various languages.',
            methods: {
                about: {
                    description: 'Get information about the execution service.',
                    parameters: {},
                    result: { type: 'json' },
                },
                supported: {
                    description: 'List supported languages and their details.',
                    parameters: {},
                    result: { type: 'json' },
                },
                exec: {
                    description: 'Execute code with a specific language.',
                    parameters: {
                        runtime: {
                            type: 'string',
                            description: 'Name of programming language or ID of runtime.',
                        },
                        code: {
                            type: 'string',
                            description: 'Code to execute.',
                        },
                        stdin: {
                            type: 'string',
                            description: 'Input to provide to the code.',
                        }
                    },
                    result: {},
                },
            }
        });
    }
}

module.exports = ExecInterfaceService;
