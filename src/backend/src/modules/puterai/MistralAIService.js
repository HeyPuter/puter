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
const OpenAIUtil = require("./lib/OpenAIUtil");
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
            async complete ({ messages, stream, model, tools, max_tokens, temperature }) {

                messages = await OpenAIUtil.process_input_messages(messages);
                for ( const message of messages ) {
                    if ( message.tool_calls ) {
                        message.toolCalls = message.tool_calls;
                        delete message.tool_calls;
                    }
                    if ( message.tool_call_id ) {
                        message.toolCallId = message.tool_call_id;
                        delete message.tool_call_id;
                    }
                }

                console.log('MESSAGES TO MISTRAL', messages);

                const completion = await this.client.chat[
                    stream ? 'stream' : 'complete'
                ]({
                    model: model ?? this.get_default_model(),
                    ...(tools ? { tools } : {}),
                    messages,
                    max_tokens: max_tokens,
                    temperature
                });
            
                return await OpenAIUtil.handle_completion_output({
                    deviations: {
                        index_usage_from_stream_chunk: chunk => {
                            if ( ! chunk.usage ) return;

                            const snake_usage = {};
                            for ( const key in chunk.usage ) {
                                const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
                                snake_usage[snakeKey] = chunk.usage[key];
                            }

                            return snake_usage;
                        },
                        chunk_but_like_actually: chunk => chunk.data,
                        index_tool_calls_from_stream_choice: choice => choice.delta.toolCalls,
                    },
                    completion, stream,
                    usage_calculator: OpenAIUtil.create_usage_calculator({
                        model_details: this.models_array_.find(m => m.id === model),
                    }),
                });
            }
        }
    }
}

module.exports = { MistralAIService };
