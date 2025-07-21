/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// METADATA // {"ai-commented":{"service":"claude"}}
const { TeePromise } = require("@heyputer/putility/src/libs/promise");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
let
    obtain,
    OPENAI_CLIENT, SYNC_RESPONSE, PROVIDER_NAME, NORMALIZED_LLM_PARAMS,
    ASYNC_RESPONSE, USAGE_WRITER, COMPLETION_WRITER;

/**
* DeepSeekService class - Provides integration with X.AI's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for X.AI's language models like Grok.
* @extends BaseService
*/
class DeepSeekService extends BaseService {
    static MODULES = {
        openai: require('openai'),
    }


    /**
    * Gets the system prompt used for AI interactions
    * @returns {string} The base system prompt that identifies the AI as running on Puter
    */
    adapt_model (model) {
        return model;
    }
    
    async _construct () {
        ({
            obtain,
            OPENAI_CLIENT, SYNC_RESPONSE, PROVIDER_NAME, NORMALIZED_LLM_PARAMS,
            ASYNC_RESPONSE, USAGE_WRITER, COMPLETION_WRITER
        } = require('@heyputer/airouter.js'));
    }

    /**
    * Initializes the XAI service by setting up the OpenAI client and registering with the AI chat provider
    * @private
    * @returns {Promise<void>} Resolves when initialization is complete
    */
    async _init () {
        this.openai = new this.modules.openai.OpenAI({
            apiKey: this.global_config.services.deepseek.apiKey,
            baseURL: 'https://api.deepseek.com',
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
    }


    /**
    * Returns the default model identifier for the XAI service
    * @returns {string} The default model ID 'grok-beta'
    */
    get_default_model () {
        return 'grok-beta';
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            /**
             * Returns a list of available models and their details.
             * See AIChatService for more information.
             * 
             * @returns Promise<Array<Object>> Array of model details
             */
            async models () {
                return await this.models_();
            },
            /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list () {
                const models = await this.models_();
                const model_names = [];
                for ( const model of models ) {
                    model_names.push(model.id);
                    if ( model.aliases ) {
                        model_names.push(...model.aliases);
                    }
                }
                return model_names;
            },

            /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
            async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
                model = this.adapt_model(model);
                

                if ( stream ) {
                    let usage_promise = new TeePromise();

                    let streamOperation;
                    const init_chat_stream = async ({ chatStream: completionWriter }) => {
                        await obtain(ASYNC_RESPONSE, {
                            [PROVIDER_NAME]: 'openai',
                            [NORMALIZED_LLM_PARAMS]: {
                                messages, model, tools, max_tokens, temperature,
                            },
                            [COMPLETION_WRITER]: completionWriter,
                            [OPENAI_CLIENT]: this.openai,
                            [USAGE_WRITER]: usage_promise,
                        })
                    };

                    return new TypedValue({ $: 'ai-chat-intermediate' }, {
                        init_chat_stream,
                        stream: true,
                        usage_promise: usage_promise,
                        finally_fn: async () => {
                            await streamOperation.cleanup();
                        },
                    });
                } else {
                    return await obtain(SYNC_RESPONSE, {
                        [PROVIDER_NAME]: 'openai',
                        [NORMALIZED_LLM_PARAMS]: {
                            messages, model, tools, max_tokens, temperature,
                        },
                        [OPENAI_CLIENT]: this.openai,
                    });
                }
            }
        }
    }

    async handle_puter_paths_(messages) {
        const require = this.require;
                
        const actor = Context.get('actor');
        const { user } = actor.type;
        for ( const message of messages ) {
            for ( const contentPart of message.content ) {
                if ( ! contentPart.puter_path ) continue;
                
                const node = await (new FSNodeParam(contentPart.puter_path)).consolidate({
                    req: { user },
                    getParam: () => contentPart.puter_path,
                });

                delete contentPart.puter_path;
                contentPart.type = 'data';
                contentPart.data = {
                    async getSize () {
                        return await node.get('size')
                    },
                    async getStream () {
                        const ll_read = new LLRead();
                        return await ll_read.run({
                            actor: Context.get('actor'),
                            fsNode: node,
                        });
                    },
                    async getMimeType () {
                        const mime = require('mime-types');
                        return mime.contentType(await node.get('name'));
                    },
                };
            }
        }
    }


    /**
    * Retrieves available AI models and their specifications
    * @returns {Promise<Array>} Array of model objects containing:
    *   - id: Model identifier string
    *   - name: Human readable model name
    *   - context: Maximum context window size
    *   - cost: Pricing information object with currency and rates
    * @private
    */
    async models_ () {
        return [
            {
                id: 'deepseek-chat',
                name: 'DeepSeek Chat',
                context: 64000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 14,
                    output: 28,
                },
                max_tokens: 8000,
            },
            {
                id: 'deepseek-reasoner',
                name: 'DeepSeek Reasoner',
                context: 64000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 55,
                    output: 219,
                },
                max_tokens: 64000,
            }
        ];
    }
}

module.exports = {
    DeepSeekService,
};

