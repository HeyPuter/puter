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
const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");

const axios = require('axios');
const { TeePromise } = require('@heyputer/putility').libs.promise;


/**
* MistralAIService class extends BaseService to provide integration with the Mistral AI API.
* Implements chat completion functionality with support for various Mistral models including
* mistral-large, pixtral, codestral, and ministral variants. Handles both streaming and
* non-streaming responses, token usage tracking, and model management. Provides cost information
* for different models and implements the puter-chat-completion interface.
*/
class MistralAIService extends BaseService {
    static MODULES = {
        '@mistralai/mistralai': require('@mistralai/mistralai'),
    }
    /**
    * Initializes the service's cost structure for different Mistral AI models.
    * Sets up pricing information for various models including token costs for input/output.
    * Each model entry specifies currency (usd-cents) and costs per million tokens.
    * @private
    */
    _construct () {
        this.costs_ = {
            'mistral-large-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 200,
                output: 600,
            },
            'pixtral-large-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 200,
                output: 600,
            },
            'mistral-small-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 20,
                output: 60,
            },
            'codestral-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 20,
                output: 60,
            },
            'ministral-8b-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 10,
                output: 10,
            },
            'ministral-3b-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 4,
                output: 4,
            },
            'pixtral-12b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 15,
                output: 15,
            },
            'mistral-nemo': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 15,
                output: 15,
            },
            'open-mistral-7b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 25,
                output: 25,
            },
            'open-mixtral-8x7b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 7,
                output: 7,
            },
            'open-mixtral-8x22b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 2,
                output: 6,
            },
        };
    }
    /**
    * Initializes the service's cost structure for different Mistral AI models.
    * Sets up pricing information for various models including token costs for input/output.
    * Each model entry specifies currency (USD cents) and costs per million tokens.
    * @private
    */
    async _init () {
        const require = this.require;
        const { Mistral } = require('@mistralai/mistralai');
        this.api_base_url = 'https://api.mistral.ai/v1';
        this.client = new Mistral({
            apiKey: this.config.apiKey,
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });

        // TODO: make this event-driven so it doesn't hold up boot
        await this.populate_models_();
    }
    /**
    * Populates the internal models array with available Mistral AI models and their configurations.
    * Makes an API call to fetch model data, then processes and filters models based on cost information.
    * Each model entry includes id, name, aliases, context window size, capabilities, and pricing.
    * @private
    * @returns {Promise<void>}
    */
    async populate_models_ () {
        const resp = await axios({
            method: 'get',
            url: this.api_base_url + '/models',
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`
            }
        })

        const response_json = resp.data;
        const models = response_json.data;
        this.models_array_ = [];
        for ( const api_model of models ) {
            
            let cost = this.costs_[api_model.id];
            if ( ! cost ) for ( const alias of api_model.aliases ) {
                cost = this.costs_[alias];
                if ( cost ) break;
            }
            if ( ! cost ) continue;
            const model = {
                id: api_model.id,
                name: api_model.description,
                aliases: api_model.aliases,
                context: api_model.max_context_length,
                capabilities: api_model.capabilities,
                vision: api_model.capabilities.vision,
                cost,
            };

            this.models_array_.push(model);
        }
        // return resp.data;
    }
    /**
    * Populates the internal models array with available Mistral AI models and their metadata
    * Fetches model data from the API, filters based on cost configuration, and stores
    * model objects containing ID, name, aliases, context length, capabilities, and pricing
    * @private
    * @async
    * @returns {void}
    */
    get_default_model () {
        return 'mistral-large-latest';
    }
    static IMPLEMENTS = {
        'puter-chat-completion': {
            /**
             * Returns a list of available models and their details.
             * See AIChatService for more information.
             * 
             * @returns Promise<Array<Object>> Array of model details
             */
            async models () {
                return this.models_array_;
            },

            /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list () {
                return this.models_array_.map(m => m.id);
            },

            /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
            async complete ({ messages, stream, model }) {

                for ( let i = 0; i < messages.length; i++ ) {
                    const message = messages[i];
                    if ( ! message.role ) message.role = 'user';
                }

                if ( stream ) {
                    let usage_promise = new TeePromise();

                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    const completion = await this.client.chat.stream({
                        model: model ?? this.get_default_model(),
                        messages,
                    });
                    (async () => {
                        for await ( let chunk of completion ) {
                            // just because Mistral wants to be different
                            chunk = chunk.data;

                            if ( chunk.usage ) {
                                usage_promise.resolve({
                                    input_tokens: chunk.usage.promptTokens,
                                    output_tokens: chunk.usage.completionTokens,
                                });
                                continue;
                            }

                            if ( chunk.choices.length < 1 ) continue;
                            if ( chunk.choices[0].finish_reason ) {
                                stream.end();
                                break;
                            }
                            if ( nou(chunk.choices[0].delta.content) ) continue;
                            const str = JSON.stringify({
                                text: chunk.choices[0].delta.content
                            });
                            stream.write(str + '\n');
                        }
                        stream.end();
                    })();

                    return new TypedValue({ $: 'ai-chat-intermediate' }, {
                        stream: true,
                        response: retval,
                        usage_promise: usage_promise,
                    });
                }

                const completion = await this.client.chat.complete({
                    model: model ?? this.get_default_model(),
                    messages,
                });
                // Expected case when mistralai/client-ts#23 is fixed
                const ret = completion.choices[0];
                ret.usage = {
                    input_tokens: completion.usage.promptTokens,
                    output_tokens: completion.usage.completionTokens,
                };
                return ret;
            }
        }
    }
}

module.exports = { MistralAIService };
