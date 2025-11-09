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
const APIError = require('../../api/APIError');
const BaseService = require('../../services/BaseService');
const OpenAIUtil = require('./lib/OpenAIUtil');
const { Context } = require('../../util/context');

/**
* OllamaService class - Provides integration with Ollama's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for Ollama's language models.
* @extends BaseService
*/
class OllamaService extends BaseService {
    static MODULES = {
        openai: require('openai'),
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
        axios: require('axios'),
    };

    /**
    * Gets the system prompt used for AI interactions
    * @returns {string} The base system prompt that identifies the AI as running on Puter
    */
    adapt_model(model) {
        return model;
    }

    /**
    * Initializes the Ollama service by setting up the Ollama client and registering with the AI chat provider
    * @private
    * @returns {Promise<void>} Resolves when initialization is complete
    */
    async _init() {
        // Ollama typically runs on HTTP, not HTTPS
        this.api_base_url = this.config?.api_base_url || 'http://localhost:11434';

        // OpenAI SDK is used to interact with the Ollama API
        this.openai = new this.modules.openai.OpenAI({
            apiKey: "ollama", // Ollama doesn't use an API key, it uses the "ollama" string
            baseURL: this.api_base_url + '/v1',
        });
        this.kvkey = this.modules.uuidv4();

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
        // We don't need to meter usage for Ollama because it's a local service
    }

    /**
    * Returns the default model identifier for the Ollama service
    * @returns {string} The default model ID 'gpt-oss:20b'
    */
    get_default_model() {
        return 'gpt-oss:20b';
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
                return await this.models_();
            },
            /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list() {
                const models = await this.models_();
                const model_names = [];
                for ( const model of models ) {
                    model_names.push(model.id);
                }
                return model_names;
            },

            /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
            async complete({ messages, stream, model, tools, max_tokens, temperature }) {
                model = this.adapt_model(model);

                if ( model.startsWith('ollama:') ) {
                    model = model.slice('ollama:'.length);
                }

                const actor = Context.get('actor');

                messages = await OpenAIUtil.process_input_messages(messages);
                const sdk_params = {
                    messages,
                    model: model ?? this.get_default_model(),
                    ...(tools ? { tools } : {}),
                    max_tokens,
                    temperature: temperature, // default to 1.0
                    stream,
                    ...(stream ? {
                        stream_options: { include_usage: true },
                    } : {}),
                }

                const completion = await this.openai.chat.completions.create(sdk_params);

                const modelDetails =  (await this.models_()).find(m => m.id === 'ollama:' + model);
                return OpenAIUtil.handle_completion_output({
                    usage_calculator: ({ usage }) => {
                        // custom open router logic because its free
                        const trackedUsage = {
                            prompt: 0,
                            completion: 0,
                            input_cache_read: 0,
                        };
                        const legacyCostCalculator = OpenAIUtil.create_usage_calculator({
                            model_details: modelDetails,
                        });
                        return legacyCostCalculator({ usage });
                    },
                    stream,
                    completion,
                });
            },
        },
    };

    /**
    * Retrieves available AI models and their specifications
    * @returns  Array of model objects containing:
    *   - id: Model identifier string
    *   - name: Human readable model name
    *   - context: Maximum context window size
    *   - cost: Pricing information object with currency and rates
    * @private
    */
    async models_(rawPriceKeys = false) {
        const axios = this.require('axios');

        let models = this.modules.kv.get(`${this.kvkey}:models`);
        if ( !models ) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: this.api_base_url + '/api/tags',
                });
                models = resp.data.models || [];
                if ( models.length > 0 ) {
                    this.modules.kv.set(`${this.kvkey}:models`, models);
                }
            } catch (error) {
                this.log.error('Failed to fetch models from Ollama:', error.message);
                // Return empty array if Ollama is not available
                return [];
            }
        }
        
        if ( !models || models.length === 0 ) {
            return [];
        }
        
        const coerced_models = [];
        for ( const model of models ) {
            // Ollama API returns models with 'name' property, not 'model'
            const modelName = model.name || model.model || 'unknown';
            const microcentCosts =  {
                input: 0,
                output: 0,
            };
            coerced_models.push({
                id: 'ollama:' + modelName,
                name: modelName + ' (Ollama)',
                max_tokens: model.size || model.max_context || 8192,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    ...microcentCosts,
                },
            });
        }
        console.log("coerced_models", coerced_models);
        return coerced_models;
    }
}

module.exports = {
    OllamaService,
};
