const BaseService = require("../../services/BaseService");
const { Context } = require("../../util/context");

class AIChatService extends BaseService {
    _construct () {
        this.providers = [];

        this.simple_model_list = [];
        this.detail_model_list = [];
        this.detail_model_map = {};
    }
    _init () {
        const svc_driver = this.services.get('driver')

        for ( const provider of this.providers ) {
            svc_driver.register_service_alias('ai-chat', provider.service_name);
        }
    }

    async ['__on_boot.consolidation'] () {
        // TODO: get models and pricing for each model
        for ( const provider of this.providers ) {
            const delegate = this.services.get(provider.service_name)
                .as('puter-chat-completion');
            
            // Populate simple model list
            {
                const models = await delegate.list();
                this.simple_model_list.push(...models);
            }

            // Populate detail model list and map
            {
                const models = await delegate.models();
                const annotated_models = [];
                for ( const model of models ) {
                    annotated_models.push({
                        ...model,
                        provider: provider.service_name,
                    });
                }
                this.detail_model_list.push(...annotated_models);
                for ( const model of annotated_models ) {
                    if ( this.detail_model_map[model.id] ) {
                        let array = this.detail_model_map[model.id];
                        // replace with array
                        if ( ! Array.isArray(array) ) {
                            array = [array];
                            this.detail_model_map[model.id] = array;
                        }

                        array.push(model);
                        continue;
                    }

                    this.detail_model_map[model.id] = model;
                }
            }
        }
    }

    register_provider (spec) {
        this.providers.push(spec);
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-chat-completion' &&
                    method_name === 'complete';
            }
        },
        ['puter-chat-completion']: {
            async models () {
                const delegate = this.get_delegate();
                if ( ! delegate ) return await this.models_();
                return await delegate.models();
            },
            async list () {
                const delegate = this.get_delegate();
                if ( ! delegate ) return await this.list_();
                return await delegate.list();
            },
            async complete (parameters) {
                const client_driver_call = Context.get('client_driver_call');
                const { test_mode } = client_driver_call;
                let { intended_service } = client_driver_call;

                if ( test_mode ) {
                    intended_service = 'fake-chat';
                }

                if ( intended_service === this.service_name ) {
                    throw new Error('Calling ai-chat directly is not yet supported');
                }

                const svc_driver = this.services.get('driver');
                const ret = await svc_driver.call_new_({
                    actor: Context.get('actor'),
                    service_name: intended_service,
                    iface: 'puter-chat-completion',
                    method: 'complete',
                    args: parameters,
                });
                ret.result.via_ai_chat_service = true;
                return ret.result;
            }
        }
    }

    async models_ () {
        return this.detail_model_list;
    }

    async list_ () {
        return this.simple_model_list;
    }

    get_delegate () {
        const client_driver_call = Context.get('client_driver_call');
        if ( client_driver_call.intended_service === this.service_name ) {
            return undefined;
        }
        console.log('getting service', client_driver_call.intended_service);
        const service = this.services.get(client_driver_call.intended_service);
        return service.as('puter-chat-completion');
    }
}

module.exports = { AIChatService };
