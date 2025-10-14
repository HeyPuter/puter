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
const { Context } = require("../../util/context");
const OpenAIUtil = require("./lib/OpenAIUtil");

/** @type {import('../../services/MeteringService/MeteringService').MeteringAndBillingService} */

/**
* Service class for integrating with Groq AI's language models.
* Extends BaseService to provide chat completion capabilities through the Groq API.
* Implements the puter-chat-completion interface for model management and text generation.
* Supports both streaming and non-streaming responses, handles multiple models including
* various versions of Llama, Mixtral, and Gemma, and manages usage tracking.
* @class GroqAIService
* @extends BaseService
*/
class GroqAIService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringAndBillingService} */
    meteringAndBillingService;
    static MODULES = {
        Groq: require('groq-sdk'),
    };

    /**
    * Initializes the GroqAI service by setting up the Groq client and registering with the AI chat provider
    * @returns {Promise<void>}
    * @private
    */
    async _init() {
        const Groq = require('groq-sdk');
        this.client = new Groq({
            apiKey: this.config.apiKey,
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
        this.meteringAndBillingService = this.services.get('meteringService').meteringAndBillingService; // TODO DS: move to proper extensions
    }

    /**
    * Returns the default model ID for the Groq AI service
    * @returns {string} The default model ID 'llama-3.1-8b-instant'
    */
    get_default_model() {
        return 'llama-3.1-8b-instant';
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
                // They send: { "object": "list", data }
                const funny_wrapper = await this.client.models.list();
                return funny_wrapper.data;
            },
            /**
            * Completes a chat interaction using the Groq API
            * @param {Object} options - The completion options
            * @param {Array<Object>} options.messages - Array of message objects containing the conversation history
            * @param {string} [options.model] - The model ID to use for completion. Defaults to service's default model
            * @param {boolean} [options.stream] - Whether to stream the response
            * @returns {TypedValue|Object} Returns either a TypedValue with streaming response or completion object with usage stats
            */
            async complete({ messages, model, stream, tools, max_tokens, temperature }) {
                model = model ?? this.get_default_model();

                messages = await OpenAIUtil.process_input_messages(messages);
                for ( const message of messages ) {
                    // Curiously, DeepSeek has the exact same deviation
                    if ( message.tool_calls && Array.isArray(message.content) ) {
                        message.content = "";
                    }
                }

                const actor = Context.get('actor');

                const completion = await this.client.chat.completions.create({
                    messages,
                    model,
                    stream,
                    tools,
                    max_completion_tokens: max_tokens, // max_tokens has been deprecated
                    temperature,
                });

                const modelDetails = (await this.models_()).find(m => m.id === model);

                return OpenAIUtil.handle_completion_output({
                    deviations: {
                        index_usage_from_stream_chunk: chunk =>
                            chunk.x_groq?.usage,
                    },
                    usage_calculator: ({ usage }) => {
                        const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                        this.meteringAndBillingService.utilRecordUsageObject(trackedUsage, actor, `groq:${modelDetails.id}`);
                        // Still return legacy cost calculation for compatibility
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
    * Returns an array of available AI models with their specifications
    *
    * Each model object contains:
    * - id: Unique identifier for the model
    * - name: Human-readable name
    * - context: Maximum context window size in tokens
    * - cost: Pricing details including currency and token rates
    *
    * @returns {Array<Object>} Array of model specification objects
    */
    models_() {
        return [
            {
                id: 'gemma2-9b-it',
                name: 'Gemma 2 9B 8k',
                context: 8192,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 20,
                    output: 20,
                },
                max_tokens: 8192,
            },
            {
                id: 'gemma-7b-it',
                name: 'Gemma 7B 8k Instruct',
                context: 8192,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 7,
                    output: 7,
                },
            },
            {
                id: 'llama3-groq-70b-8192-tool-use-preview',
                name: 'Llama 3 Groq 70B Tool Use Preview 8k',
                context: 8192,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 89,
                    output: 89,
                },
            },
            {
                id: 'llama3-groq-8b-8192-tool-use-preview',
                name: 'Llama 3 Groq 8B Tool Use Preview 8k',
                context: 8192,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 19,
                    output: 19,
                },
            },
            {
                "id": "llama-3.1-70b-versatile",
                "name": "Llama 3.1 70B Versatile 128k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 59,
                    "output": 79,
                },
            },
            {
                // This was only available on their Discord, not
                // on the pricing page.
                "id": "llama-3.1-70b-specdec",
                "name": "Llama 3.1 8B Instant 128k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 59,
                    "output": 99,
                },
            },
            {
                "id": "llama-3.1-8b-instant",
                "name": "Llama 3.1 8B Instant 128k",
                "context": 131072,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 5,
                    "output": 8,
                },
                max_tokens: 131072,
            },
            {
                id: 'meta-llama/llama-guard-4-12b',
                name: 'Llama Guard 4 12B',
                context: 131072,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1000000,
                    input: 20,
                    output: 20,
                },
                max_tokens: 1024,
            },
            {
                id: 'meta-llama/llama-prompt-guard-2-86m',
                name: 'Prompt Guard 2 86M',
                context: 512,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1000000,
                    input: 4,
                    output: 4,
                },
                max_tokens: 512,
            },
            {
                "id": "llama-3.2-1b-preview",
                "name": "Llama 3.2 1B (Preview) 8k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 4,
                    "output": 4,
                },
            },
            {
                "id": "llama-3.2-3b-preview",
                "name": "Llama 3.2 3B (Preview) 8k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 6,
                    "output": 6,
                },
            },
            {
                id: 'llama-3.2-11b-vision-preview',
                name: 'Llama 3.2 11B Vision 8k (Preview)',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 18,
                    output: 18,
                },
            },
            {
                id: 'llama-3.2-90b-vision-preview',
                name: 'Llama 3.2 90B Vision 8k (Preview)',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 90,
                    output: 90,
                },
            },
            {
                "id": "llama3-70b-8192",
                "name": "Llama 3 70B 8k",
                "context": 8192,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 59,
                    "output": 79,
                },
            },
            {
                "id": "llama3-8b-8192",
                "name": "Llama 3 8B 8k",
                "context": 8192,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 5,
                    "output": 8,
                },
            },
            {
                "id": "mixtral-8x7b-32768",
                "name": "Mixtral 8x7B Instruct 32k",
                "context": 32768,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 24,
                    "output": 24,
                },
            },
            {
                "id": "llama-guard-3-8b",
                "name": "Llama Guard 3 8B 8k",
                "context": 8192,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 20,
                    "output": 20,
                },
            },
        ];
    }
}

module.exports = {
    GroqAIService,
};
