// METADATA // {"ai-commented":{"service":"claude"}}
const APIError = require("../../api/APIError");
const { PermissionUtil } = require("../../services/auth/PermissionService");
const BaseService = require("../../services/BaseService");
const { DB_WRITE } = require("../../services/database/consts");
const { TypeSpec } = require("../../services/drivers/meta/Construct");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { Context } = require("../../util/context");

// Maximum number of fallback attempts when a model fails, including the first attempt
const MAX_FALLBACKS = 3 + 1; // includes first attempt


/**
* AIChatService class extends BaseService to provide AI chat completion functionality.
* Manages multiple AI providers, models, and fallback mechanisms for chat interactions.
* Handles model registration, usage tracking, cost calculation, content moderation,
* and implements the puter-chat-completion driver interface. Supports streaming responses
* and maintains detailed model information including pricing and capabilities.
*/
class AIChatService extends BaseService {
    static MODULES = {
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
    }


    /**
    * Initializes the service by setting up core properties.
    * Creates empty arrays for providers and model lists,
    * and initializes an empty object for the model map.
    * Called during service instantiation.
    * @private
    */
    _construct () {
        this.providers = [];

        this.simple_model_list = [];
        this.detail_model_list = [];
        this.detail_model_map = {};
    }
    /**
    * Initializes the service by setting up empty arrays and maps for providers and models.
    * This method is called during service construction to establish the initial state.
    * Creates empty arrays for providers, simple model list, and detailed model list,
    * as well as an empty object for the detailed model map.
    * @private
    */
    _init () {
        this.kvkey = this.modules.uuidv4();

        this.db = this.services.get('database').get(DB_WRITE, 'ai-usage');

        const svc_event = this.services.get('event');
        svc_event.on('ai.prompt.report-usage', async (_, details) => {
            if ( details.service_used === 'fake-chat' ) return;

            const values = {
                user_id: details.actor?.type?.user?.id,
                app_id: details.actor?.type?.app?.id ?? null,
                service_name: details.service_used,
                model_name: details.model_used,
                value_uint_1: details.usage?.input_tokens,
                value_uint_2: details.usage?.output_tokens,
            };

            let model_details = this.detail_model_map[details.model_used];
            if ( Array.isArray(model_details) ) {
                for ( const model of model_details ) {
                    if ( model.provider === details.service_used ) {
                        model_details = model;
                        break;
                    }
                }
            }
            if ( Array.isArray(model_details) ) {
                model_details = model_details[0];
            }
            if ( model_details ) {
                values.cost = 0 + // for formatting

                    model_details.cost.input  * details.usage.input_tokens
                    //            cents/MTok                        tokens
                                              +

                    model_details.cost.output * details.usage.output_tokens
                    //            cents/MTok                        tokens
                    ;
            } else {
                this.log.error('could not find model details', { details });
            }

            await this.db.insert('ai_usage', values);
        });
    }


    /**
    * Handles consolidation during service boot by registering service aliases
    * and populating model lists/maps from providers.
    * 
    * Registers each provider as an 'ai-chat' service alias and fetches their
    * available models and pricing information. Populates:
    * - simple_model_list: Basic list of supported models
    * - detail_model_list: Detailed model info including costs
    * - detail_model_map: Maps model IDs/aliases to their details
    * 
    * @returns {Promise<void>}
    */
    async ['__on_boot.consolidation'] () {
        {
            const svc_driver = this.services.get('driver')
            for ( const provider of this.providers ) {
                svc_driver.register_service_alias('ai-chat',
                    provider.service_name);
            }
        }

        for ( const provider of this.providers ) {
            const delegate = this.services.get(provider.service_name)
                .as('puter-chat-completion');

            // Populate simple model list
            {
                /**
                * Populates the simple model list by fetching available models from the delegate service.
                * Wraps the delegate.list() call in a try-catch block to handle potential errors gracefully.
                * If the call fails, logs the error and returns an empty array to avoid breaking the service.
                * The fetched models are added to this.simple_model_list.
                * 
                * @private
                * @returns {Promise<void>}
                */
                const models = await (async () => {
                    try {
                        return await delegate.list() ?? [];
                    } catch (e) {
                        this.log.error(e);
                        return [];
                    }
                })();
                this.simple_model_list.push(...models);
            }

            // Populate detail model list and map
            {
                /**
                * Populates the detail model list and map with model information from the provider.
                * Fetches detailed model data including pricing and capabilities.
                * Handles model aliases and potential conflicts by storing multiple models in arrays.
                * Annotates models with their provider service name.
                * Catches and logs any errors during model fetching.
                * @private
                */
                const models = await (async () => {
                    try {
                        return await delegate.models() ?? [];
                    } catch (e) {
                        this.log.error(e);
                        return [];
                    }
                })();
                const annotated_models = [];
                for ( const model of models ) {
                    annotated_models.push({
                        ...model,
                        provider: provider.service_name,
                    });
                }
                this.detail_model_list.push(...annotated_models);
                /**
                * Helper function to set or push a model into the detail_model_map.
                * If there's no existing entry for the key, sets it directly.
                * If there's a conflict, converts the entry to an array and pushes the new model.
                * @param {string} key - The model ID or alias
                * @param {Object} model - The model details to add
                */
                const set_or_push = (key, model) => {
                    // Typical case: no conflict
                    if ( ! this.detail_model_map[key] ) {
                        this.detail_model_map[key] = model;
                        return;
                    }

                    // Conflict: model name will map to an array
                    let array = this.detail_model_map[key];
                    if ( ! Array.isArray(array) ) {
                        array = [array];
                        this.detail_model_map[key] = array;
                    }

                    array.push(model);
                };
                for ( const model of annotated_models ) {
                    set_or_push(model.id, model);

                    if ( ! model.aliases ) continue;

                    for ( const alias of model.aliases ) {
                        set_or_push(alias, model);
                    }
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
            /**
            * Implements the 'puter-chat-completion' interface methods for AI chat functionality.
            * Handles model selection, fallbacks, usage tracking, and moderation.
            * Contains methods for listing available models, completing chat prompts,
            * and managing provider interactions.
            * 
            * @property {Object} models - Available AI models with details like costs
            * @property {Object} list - Simplified list of available models
            * @property {Object} complete - Main method for chat completion requests
            * @param {Object} parameters - Chat completion parameters including model and messages
            * @returns {Promise<Object>} Chat completion response with usage stats
            * @throws {Error} If service is called directly or no fallback models available
            */
            async models () {
                const delegate = this.get_delegate();
                if ( ! delegate ) return await this.models_();
                return await delegate.models();
            },
            /**
            * Returns list of available AI models with detailed information
            * 
            * Delegates to the intended service's models() method if a delegate exists,
            * otherwise returns the internal detail_model_list containing all available models
            * across providers with their capabilities and pricing information.
            * 
            * @returns {Promise<Array>} Array of model objects with details like id, provider, cost, etc.
            */
            async list () {
                const delegate = this.get_delegate();
                if ( ! delegate ) return await this.list_();
                return await delegate.list();
            },
            /**
            * Lists available AI models in a simplified format
            * 
            * Returns a list of basic model information from all registered providers.
            * This is a simpler version compared to models() that returns less detailed info.
            * 
            * @returns {Promise<Array>} Array of simplified model objects
            */
            async complete (parameters) {
                const client_driver_call = Context.get('client_driver_call');
                let { test_mode, intended_service, response_metadata } = client_driver_call;
                
                this.log.noticeme('AIChatService.complete', { intended_service, parameters, test_mode });
                const svc_event = this.services.get('event');
                const event = {
                    allow: true,
                    intended_service,
                    parameters
                };
                if ( ! event.allow ) {
                    test_mode = true;
                }
                
                if ( ! test_mode && ! await this.moderate(parameters) ) {
                    test_mode = true;
                }

                if ( ! test_mode ) {
                    Context.set('moderated', true);
                }

                if ( test_mode ) {
                    intended_service = 'fake-chat';
                }

                if ( intended_service === this.service_name ) {
                    throw new Error('Calling ai-chat directly is not yet supported');
                }
                
                const svc_driver = this.services.get('driver');
                let ret, error;
                let service_used = intended_service;
                let model_used = this.get_model_from_request(parameters, {
                    intended_service
                });
                await this.check_usage_({
                    actor: Context.get('actor'),
                    service: service_used,
                    model: model_used,
                });
                try {
                    ret = await svc_driver.call_new_({
                        actor: Context.get('actor'),
                        service_name: intended_service,
                        iface: 'puter-chat-completion',
                        method: 'complete',
                        args: parameters,
                    });
                } catch (e) {
                    const tried = [];
                    let model = model_used;

                    // TODO: if conflict models exist, add service name
                    tried.push(model);

                    error = e;
                    console.error(e);
                    this.log.error('error calling service', {
                        intended_service,
                        model,
                        error: e,
                    });
                    while ( !! error ) {
                        const fallback = this.get_fallback_model({
                            model, tried,
                        });

                        if ( ! fallback ) {
                            throw new Error('no fallback model available');
                        }

                        const {
                            fallback_service_name,
                            fallback_model_name,
                        } = fallback;

                        this.log.warn('model fallback', {
                            intended_service,
                            fallback_service_name,
                            fallback_model_name
                        });

                        await this.check_usage_({
                            actor: Context.get('actor'),
                            service: fallback_service_name,
                            model: fallback_model_name,
                        });
                        try {
                            ret = await svc_driver.call_new_({
                                actor: Context.get('actor'),
                                service_name: fallback_service_name,
                                iface: 'puter-chat-completion',
                                method: 'complete',
                                args: {
                                    ...parameters,
                                    model: fallback_model_name,
                                },
                            });
                            error = null;
                            service_used = fallback_service_name;
                            model_used = fallback_model_name;
                            response_metadata.fallback = {
                                service: fallback_service_name,
                                model: fallback_model_name,
                                tried: tried,
                            };
                        } catch (e) {
                            error = e;
                            tried.push(fallback_model_name);
                            this.log.error('error calling fallback', {
                                intended_service,
                                model,
                                error: e,
                            });
                        }
                    }
                }
                ret.result.via_ai_chat_service = true;
                response_metadata.service_used = service_used;

                const username = Context.get('actor').type?.user?.username;

                if (
                    // Check if we have 'ai-chat-intermediate' response type;
                    // this means we're streaming and usage comes from a promise.
                    (ret.result instanceof TypedValue) &&
                    TypeSpec.adapt({ $: 'ai-chat-intermediate' })
                    .equals(ret.result.type)
                ) {
                    (async () => {
                        const usage_promise = ret.result.value.usage_promise;
                        const usage = await usage_promise;
                        await svc_event.emit('ai.prompt.report-usage', {
                            actor: Context.get('actor'),
                            service_used,
                            model_used,
                            usage,
                        });
                    })();
                    return ret.result.value.response;
                } else {
                    await svc_event.emit('ai.prompt.report-usage', {
                        actor: Context.get('actor'),
                        username,
                        service_used,
                        model_used,
                        usage: ret.result.usage,
                    });
                }
                
                console.log('emitting ai.prompt.complete');
                await svc_event.emit('ai.prompt.complete', {
                    username,
                    intended_service,
                    parameters,
                    result: ret.result,
                    model_used,
                    service_used,
                });

                return ret.result;
            }
        }
    }
    

    /**
    * Checks if the user has permission to use AI services and verifies usage limits
    * 
    * @param {Object} params - The check parameters
    * @param {Object} params.actor - The user/actor making the request
    * @param {string} params.service - The AI service being used
    * @param {string} params.model - The model being accessed
    * @throws {APIError} If usage is not allowed or limits are exceeded
    * @private
    */
    async check_usage_ ({ actor, service, model }) {
        const svc_permission = this.services.get('permission');
        const svc_event = this.services.get('event');
        const reading = await svc_permission.scan(actor, `paid-services:ai-chat`);
        const options = PermissionUtil.reading_to_options(reading);

        // Query current ai usage in terms of cost
        const [row] = await this.db.read(
            'SELECT SUM(`cost`) AS sum FROM `ai_usage` ' +
            'WHERE `user_id` = ?',
            [actor.type.user.id]
        );
        
        const cost_used = row?.sum || 0;
    
        const event = {
            allowed: true,
            actor,
            service, model,
            cost_used,
            permission_options: options,
        };
        await svc_event.emit('ai.prompt.check-usage', event);
        if ( event.error ) throw event.error;
        if ( ! event.allowed ) {
            throw new APIError('forbidden');
        }
    }
    

    /**
    * Moderates chat messages for inappropriate content using OpenAI's moderation service
    * 
    * @param {Object} params - The parameters object
    * @param {Array} params.messages - Array of chat messages to moderate
    * @returns {Promise<boolean>} Returns true if content is appropriate, false if flagged
    * 
    * @description
    * Extracts text content from messages and checks each against OpenAI's moderation.
    * Handles both string content and structured message objects.
    * Returns false immediately if any message is flagged as inappropriate.
    * Returns true if OpenAI service is unavailable or all messages pass moderation.
    */
    async moderate ({ messages }) {
        const svc_openai = this.services.get('openai-completion');

        // We can't use moderation of openai service isn't available
        if ( ! svc_openai ) return true;
        
        for ( const msg of messages ) {
            const texts = [];
            if ( typeof msg.content === 'string' ) texts.push(msg.content);
            else if ( typeof msg.content === 'object' ) {
                if ( Array.isArray(msg.content) ) {
                    texts.push(...msg.content.filter(o => (
                        ( ! o.type && o.hasOwnProperty('text') ) ||
                        o.type === 'text')).map(o => o.text));
                }
                else texts.push(msg.content.text);
            }
            
            const fulltext = texts.join('\n');
            
            const mod_result = await svc_openai.check_moderation(fulltext);
            if ( mod_result.flagged ) return false;
        }
        return true;
    }


    async models_ () {
        return this.detail_model_list;
    }


    /**
    * Returns a list of available AI models with basic details
    * @returns {Promise<Array>} Array of simple model objects containing basic model information
    */
    async list_ () {
        return this.simple_model_list;
    }


    /**
    * Gets the appropriate delegate service for handling chat completion requests.
    * If the intended service is this service (ai-chat), returns undefined.
    * Otherwise returns the intended service wrapped as a puter-chat-completion interface.
    * 
    * @returns {Object|undefined} The delegate service or undefined if intended service is ai-chat
    */
    get_delegate () {
        const client_driver_call = Context.get('client_driver_call');
        if ( client_driver_call.intended_service === this.service_name ) {
            return undefined;
        }
        console.log('getting service', client_driver_call.intended_service);
        const service = this.services.get(client_driver_call.intended_service);
        return service.as('puter-chat-completion');
    }

    /**
     * Find an appropriate fallback model by sorting the list of models
     * by the euclidean distance of the input/output prices and selecting
     * the first one that is not in the tried list.
     * 
     * @param {*} param0 
     * @returns 
     */
    get_fallback_model ({ model, tried }) {
        let target_model = this.detail_model_map[model];
        if ( ! target_model ) {
            this.log.error('could not find model', { model });
            throw new Error('could not find model');
        }
        if ( Array.isArray(target_model) ) {
            // TODO: better conflict resolution
            this.log.noticeme('conflict exists', { model, target_model });
            target_model = target_model[0];
        }

        // First check KV for the sorted list
        let sorted_models = this.modules.kv.get(
            `${this.kvkey}:fallbacks:${model}`);

        if ( ! sorted_models ) {
            // Calculate the sorted list
            const models = this.detail_model_list;

            sorted_models = models.toSorted((a, b) => {
                return Math.sqrt(
                    Math.pow(a.cost.input - target_model.cost.input, 2) +
                    Math.pow(a.cost.output - target_model.cost.output, 2)
                ) - Math.sqrt(
                    Math.pow(b.cost.input - target_model.cost.input, 2) +
                    Math.pow(b.cost.output - target_model.cost.output, 2)
                );
            });

            sorted_models = sorted_models.slice(0, MAX_FALLBACKS);

            this.modules.kv.set(
                `${this.kvkey}:fallbacks:${model}`, sorted_models);
        }

        for ( const model of sorted_models ) {
            if ( tried.includes(model.id) ) continue;

            return {
                fallback_service_name: model.provider,
                fallback_model_name: model.id,
            };
        }

        // No fallbacks available
        this.log.error('no fallbacks', {
            sorted_models,
            tried,
        });
    }

    get_model_from_request (parameters, modified_context = {}) {
        const client_driver_call = Context.get('client_driver_call');
        let { intended_service } = client_driver_call;
        
        if ( modified_context.intended_service ) {
            intended_service = modified_context.intended_service;
        }

        let model = parameters.model;
        if ( ! model ) {
            const service = this.services.get(intended_service);
            console.log({
                what: intended_service,
                w: service.get_default_model
            });
            if ( ! service.get_default_model ) {
                throw new Error('could not infer model from service');
            }
            model = service.get_default_model();
            if ( ! model ) {
                throw new Error('could not infer model from service');
            }
        }

        return model;
    }
}

module.exports = { AIChatService };
