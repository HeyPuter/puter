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
const BaseService = require("../../services/BaseService");
const axios = require('axios');
const OpenAIUtil = require("./lib/OpenAIUtil");
const { Context } = require("../../util/context");

/**
* MistralAIService class extends BaseService to provide integration with the Mistral AI API.
* Implements chat completion functionality with support for various Mistral models including
* mistral-large, pixtral, codestral, and ministral variants. Handles both streaming and
* non-streaming responses, token usage tracking, and model management. Provides cost information
* for different models and implements the puter-chat-completion interface.
*/
class MistralAIService extends BaseService {
    /** @type {import('../../services/abuse-prevention/MeteringService/MeteringService').MeteringAndBillingService} */
    meteringAndBillingService;
    static MODULES = {
        '@mistralai/mistralai': require('@mistralai/mistralai'),
    };
    /**
    * Initializes the service's cost structure for different Mistral AI models.
    * Sets up pricing information for various models including token costs for input/output.
    * Each model entry specifies currency (usd-cents) and costs per million tokens.
    * @private
    */
    _construct() {
        this.costs_ = {
            'mistral-large-latest': {
                aliases: ['mistral-large-2411'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 200,
                    output: 600,
                },
                max_tokens: 128000,
            },
            'pixtral-large-latest': {
                aliases: ['pixtral-large-2411'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 200,
                    output: 600,
                },
                max_tokens: 128000,
            },
            'mistral-small-latest': {
                aliases: ['mistral-small-2506'],
                license: 'Apache-2.0',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 20,
                    output: 60,
                },
                max_tokens: 128000,
            },
            'codestral-latest': {
                aliases: ['codestral-2501'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 30,
                    output: 90,
                },
                max_tokens: 256000,
            },
            'ministral-8b-latest': {
                aliases: ['ministral-8b-2410'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 10,
                },
                max_tokens: 128000,
            },
            'ministral-3b-latest': {
                aliases: ['ministral-3b-2410'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 4,
                    output: 4,
                },
                max_tokens: 128000,
            },
            'pixtral-12b': {
                aliases: ['pixtral-12b-2409'],
                license: 'Apache-2.0',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 15,
                    output: 15,
                },
                max_tokens: 128000,
            },
            'mistral-nemo': {
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 15,
                    output: 15,
                },
            },
            'open-mistral-7b': {
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 25,
                    output: 25,
                },
            },
            'open-mixtral-8x7b': {
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 7,
                    output: 7,
                },
            },
            'open-mixtral-8x22b': {
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 2,
                    output: 6,
                },
            },
            'magistral-medium-latest': {
                aliases: ['magistral-medium-2506'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 200,
                    output: 500,
                },
                max_tokens: 40000,
            },
            'magistral-small-latest': {
                aliases: ['magistral-small-2506'],
                license: 'Apache-2.0',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 10,
                },
                max_tokens: 40000,
            },
            'mistral-medium-latest': {
                aliases: ['mistral-medium-2505'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 40,
                    output: 200,
                },
                max_tokens: 128000,
            },
            'mistral-moderation-latest': {
                aliases: ['mistral-moderation-2411'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 10,
                },
                max_tokens: 8000,
            },
            'devstral-small-latest': {
                aliases: ['devstral-small-2505'],
                license: 'Apache-2.0',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 10,
                },
                max_tokens: 128000,
            },
            'mistral-saba-latest': {
                aliases: ['mistral-saba-2502'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 20,
                    output: 60,
                },
            },
            'open-mistral-nemo': {
                aliases: ['open-mistral-nemo-2407'],
                license: 'Apache-2.0',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 10,
                },
            },
            'mistral-ocr-latest': {
                aliases: ['mistral-ocr-2505'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 100,
                    output: 300,
                },
            },
        };
    }
    /**
    * Initializes the service's cost structure for different Mistral AI models.
    * Sets up pricing information for various models including token costs for input/output.
    * Each model entry specifies currency (USD cents) and costs per million tokens.
    * @private
    */
    async _init() {
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

        this.meteringAndBillingService = this.services.get('meteringService').meteringAndBillingService;

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
    async populate_models_() {
        const resp = await axios({
            method: 'get',
            url: this.api_base_url + '/models',
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
            },
        });

        const response_json = resp.data;
        const models = response_json.data;
        this.models_array_ = [];
        for ( const api_model of models ) {

            let cost = this.costs_[api_model.id];
            if ( ! cost ) {
                for ( const alias of api_model.aliases ) {
                    cost = this.costs_[alias];
                    if ( cost ) break;
                }
            }
            if ( ! cost ) continue;
            const model = {
                ...cost,
                id: api_model.id,
                name: api_model.description,
                aliases: api_model.aliases,
                context: api_model.max_context_length,
                capabilities: api_model.capabilities,
                vision: api_model.capabilities.vision,
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
    get_default_model() {
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
            async models() {
                return this.models_array_;
            },

            /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list() {
                return this.models_array_.map(m => m.id);
            },

            /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
            async complete({ messages, stream, model, tools, max_tokens, temperature }) {

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

                const actor = Context.get('actor');
                const completion = await this.client.chat[
                    stream ? 'stream' : 'complete'
                ]({
                    model: model ?? this.get_default_model(),
                    ...(tools ? { tools } : {}),
                    messages,
                    max_tokens: max_tokens,
                    temperature,
                });

                const modelDetails = this.models_array_.find(m => m.id === (model ?? this.get_default_model()));

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
                        coerce_completion_usage: completion => ({
                            prompt_tokens: completion.usage.promptTokens,
                            completion_tokens: completion.usage.completionTokens,
                        }),
                    },
                    completion,
                    stream,
                    usage_calculator: ({ usage }) => {
                        const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                        if ( this.meteringAndBillingService ) {
                            this.meteringAndBillingService.utilRecordUsageObject(trackedUsage, actor, `mistral:${modelDetails.id}`);
                        }
                        // Still return legacy cost calculation for compatibility
                        const legacyCostCalculator = OpenAIUtil.create_usage_calculator({
                            model_details: modelDetails,
                        });
                        return legacyCostCalculator({ usage });
                    },
                });
            },
        },
    };
}

module.exports = { MistralAIService };
