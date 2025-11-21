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
const BaseService = require('../../services/BaseService');
const { Context } = require('../../util/context');
const OpenAIUtil = require('./lib/OpenAIUtil');
const dedent = require('dedent');

/**
* DeepSeekService class - Provides integration with DeepSeek's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for DeepSeek's language models like DeepSeek Chat and Reasoner.
* @extends BaseService
*/
class DeepSeekService extends BaseService {
    static MODULES = {
        openai: require('openai'),
    };

    /**
    * @type {import('../../services/MeteringService/MeteringService').MeteringService}
    */
    meteringService;
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
        this.openai = new this.modules.openai.OpenAI({
            apiKey: this.global_config.services.deepseek.apiKey,
            baseURL: 'https://api.deepseek.com',
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
        this.meteringService = this.services.get('meteringService').meteringService;
    }

    /**
    * Returns the default model identifier for the DeepSeek service
    * @returns {string} The default model ID 'deepseek-chat'
    */
    get_default_model () {
        return 'deepseek-chat';
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

                messages = await OpenAIUtil.process_input_messages(messages);
                for ( const message of messages ) {
                    // DeepSeek doesn't appreciate arrays here
                    if ( message.tool_calls && Array.isArray(message.content) ) {
                        message.content = '';
                    }
                }

                // Function calling is just broken on DeepSeek - it never awknowledges
                // the tool results and instead keeps calling the function over and over.
                // (see https://github.com/deepseek-ai/DeepSeek-V3/issues/15)
                // To fix this, we inject a message that tells DeepSeek what happened.
                const TOOL_TEXT = message => dedent(`
                    Hi DeepSeek V3, your tool calling is broken and you are not able to
                    obtain tool results in the expected way. That's okay, we can work
                    around this.

                    Please do not repeat this tool call.

                    We have provided the tool call results below:

                    Tool call ${message.tool_call_id} returned: ${message.content}.
                `);
                for ( let i = messages.length - 1; i >= 0 ; i-- ) {
                    const message = messages[i];
                    if ( message.role === 'tool' ) {
                        messages.splice(i + 1, 0, {
                            role: 'system',
                            content: [
                                {
                                    type: 'text',
                                    text: TOOL_TEXT(message),
                                },
                            ],
                        });
                    }
                }

                const completion = await this.openai.chat.completions.create({
                    messages,
                    model: model ?? this.get_default_model(),
                    ...(tools ? { tools } : {}),
                    max_tokens: max_tokens || 1000,
                    temperature, // the default temperature is 1.0. suggested 0 for math/coding and 1.5 for creative poetry
                    stream,
                    ...(stream ? {
                        stream_options: { include_usage: true },
                    } : {}),
                });

                // Metering integration now handled via usage_calculator in OpenAIUtil.handle_completion_output
                const actor = Context.get('actor');
                const modelDetails = (await this.models_()).find(m => m.id === (model ?? this.get_default_model()));

                return OpenAIUtil.handle_completion_output({
                    usage_calculator: ({ usage }) => {
                        const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                        this.meteringService.utilRecordUsageObject(trackedUsage, actor, `deepseek:${modelDetails.id}`);
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
                context: 128000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 56,
                    output: 168,
                },
                max_tokens: 8000,
            },
            {
                id: 'deepseek-reasoner',
                name: 'DeepSeek Reasoner',
                context: 128000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 56,
                    output: 168,
                },
                max_tokens: 64000,
            },
        ];
    }
}

module.exports = {
    DeepSeekService,
};
