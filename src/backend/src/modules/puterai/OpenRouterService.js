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
const openai = require('openai');
const uuidv4 = require('uuid').v4;
const axios = require('axios');
/**
* XAIService class - Provides integration with X.AI's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for X.AI's language models like Grok.
* @extends BaseService
*/
class OpenRouterService extends BaseService {
    static MODULES = {
        kv: globalThis.kv,
    };

    // TODO DS: extract this into driver wrapper like openAiService
    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async models () {
                return await this.models();
            },
            async list () {
                return await this.list();
            },
            async complete (...params) {
                return await this.complete(...params);
            },
        },
    };

    /**
    * Gets the system prompt used for AI interactions
    * @returns {string} The base system prompt that identifies the AI as running on Puter
    */
    adapt_model (model) {
        return model;
    }

    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    meteringService;

    /**
    * Initializes the XAI service by setting up the OpenAI client and registering with the AI chat provider
    * @private
    * @returns {Promise<void>} Resolves when initialization is complete
    */
    async _init () {
        this.api_base_url = 'https://openrouter.ai/api/v1';
        this.openai = new openai.OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.api_base_url,
        });
        this.kvkey = uuidv4();

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
        this.meteringService = this.services.get('meteringService').meteringService; // TODO DS: move to proper extensions
    }

    /**
    * Returns the default model identifier for the XAI service
    * @returns {string} The default model ID 'grok-beta'
    */
    get_default_model () {
    }
    /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
    async list () {
        const models = await this.models();
        const model_names = [];
        for ( const model of models ) {
            model_names.push(model.id);
        }
        return model_names;
    }

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
            });
        }

        const actor = Context.get('actor');

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
            usage: { include: true },
        });

        const modelDetails =  (await this.models()).find(m => m.id === `openrouter:${ model}`);
        const rawPriceModelDetails =  (await this.models(true)).find(m => m.id === `openrouter:${ model}`);
        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                // custom open router logic because they're pricing are weird
                const trackedUsage = {
                    prompt: (usage.prompt_tokens ?? 0 ) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion: usage.completion_tokens ?? 0,
                    input_cache_read: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };
                const costOverwrites = Object.fromEntries(Object.keys(trackedUsage).map((k) => {
                    return [k, rawPriceModelDetails.cost[k] * trackedUsage[k]];
                }));
                this.meteringService.utilRecordUsageObject(trackedUsage, actor, modelDetails.id, costOverwrites);
                const legacyCostCalculator = OpenAIUtil.create_usage_calculator({
                    model_details: modelDetails,
                });
                return legacyCostCalculator({ usage });
            },
            stream,
            completion,
        });
    }

    /**
    * Retrieves available AI models and their specifications
    * @returns  Array of model objects containing:
    *   - id: Model identifier string
    *   - name: Human readable model name
    *   - context: Maximum context window size
    *   - cost: Pricing information object with currency and rates
    */
    async models (rawPriceKeys = false) {
        let models = this.modules.kv.get(`${this.kvkey}:models`);
        if ( ! models ) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.api_base_url}/models`,
                });

                models = resp.data.data;
                this.modules.kv.set(`${this.kvkey}:models`, models);
            } catch (e) {
                console.log(e);
            }
        }
        const coerced_models = [];
        for ( const model of models ) {
            const microcentCosts = rawPriceKeys ? Object.fromEntries(Object.entries(model.pricing).map(([k, v]) => [k, Math.round(v * 1_000_000 * 100)])) : {
                input: Math.round(model.pricing.prompt * 1_000_000 * 100),
                output: Math.round(model.pricing.completion * 1_000_000 * 100),
            };
            coerced_models.push({
                id: `openrouter:${ model.id}`,
                name: `${model.name } (OpenRouter)`,
                max_tokens: model.top_provider.max_completion_tokens,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    ...microcentCosts,
                },
            });
        }
        return coerced_models;
    }
}

module.exports = {
    OpenRouterService,
};
