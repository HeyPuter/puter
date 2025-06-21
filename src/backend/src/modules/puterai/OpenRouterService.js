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
const APIError = require("../../api/APIError");
const BaseService = require("../../services/BaseService");
const OpenAIUtil = require("./lib/OpenAIUtil");

/**
* XAIService class - Provides integration with X.AI's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for X.AI's language models like Grok.
* @extends BaseService
*/
class OpenRouterService extends BaseService {
    static MODULES = {
        openai: require('openai'),
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
        axios: require('axios'),
    }


    /**
    * Gets the system prompt used for AI interactions
    * @returns {string} The base system prompt that identifies the AI as running on Puter
    */
    adapt_model (model) {
        return model;
    }
    

    /**
    * Initializes the XAI service by setting up the OpenAI client and registering with the AI chat provider
    * @private
    * @returns {Promise<void>} Resolves when initialization is complete
    */
    async _init () {
        this.api_base_url = 'https://openrouter.ai/api/v1';
        this.openai = new this.modules.openai.OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.api_base_url,
        });
        this.kvkey = this.modules.uuidv4();

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
                }
                return model_names;
            },

            /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
            async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
                model = this.adapt_model(model);

                if ( model.startsWith('openrouter:') ) {
                    model = model.slice('openrouter:'.length);
                }
                
                if ( model === 'openrouter/auto' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'model',
                        expected: 'allowed model',
                        got: 'disallowed model',
                    })
                }

                messages = await OpenAIUtil.process_input_messages(messages);
                
                const completion = await this.openai.chat.completions.create({
                    messages,
                    model: model ?? this.get_default_model(),
                    ...(tools ? { tools } : {}),
                    max_tokens,
                    temperature: temperature, // default to 1.0
                    stream,
                    ...(stream ? {
                        stream_options: { include_usage: true },
                    } : {}),
                });

                return OpenAIUtil.handle_completion_output({
                    usage_calculator: OpenAIUtil.create_usage_calculator({
                        model_details: (await this.models_()).find(m => m.id === 'openrouter:' + model),
                    }),
                    stream, completion,
                });
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
        const axios = this.require('axios');

        const cached_models = this.modules.kv.get(`${this.kvkey}:models`);
        if ( cached_models ) {
            return cached_models;
        }
        const resp = await axios.request({
            method: 'GET',
            url: this.api_base_url + '/models',
        });
        const resp_models = resp.data.data;
        const coerced_models = [];
        for ( const model of resp_models ) {
            coerced_models.push({
                id: 'openrouter:' + model.id,
                name: model.name + ' (OpenRouter)',
                max_tokens: model.top_provider.max_completion_tokens,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: model.pricing.prompt * 1000000,
                    output: model.pricing.completion * 1000000,
                }
            });
        }
        this.modules.kv.set(`${this.kvkey}:models`, coerced_models);
        return coerced_models;
    }
}

module.exports = {
    OpenRouterService,
};

