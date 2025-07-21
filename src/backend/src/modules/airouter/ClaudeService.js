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
const { default: Anthropic, toFile } = require("@anthropic-ai/sdk");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const { Context } = require("../../util/context");
const { TeePromise } = require('@heyputer/putility').libs.promise;


let
    obtain,
    ANTHROPIC_API_KEY,
    NORMALIZED_LLM_PARAMS, COMPLETION_WRITER, PROVIDER_NAME,
    ASYNC_RESPONSE, SYNC_RESPONSE
;

/**
* ClaudeService class extends BaseService to provide integration with Anthropic's Claude AI models.
* Implements the puter-chat-completion interface for handling AI chat interactions.
* Manages message streaming, token limits, model selection, and API communication with Claude.
* Supports system prompts, message adaptation, and usage tracking.
* @extends BaseService
*/
class ClaudeService extends BaseService {
    static MODULES = {
        Anthropic: require('@anthropic-ai/sdk'),
    }
    
    /**
     * @type {import('@anthropic-ai/sdk').Anthropic}
     */
    anthropic;
    
    async _construct () {
        const airouter = await import('@heyputer/airouter.js');
        ({
            obtain,
            ANTHROPIC_API_KEY,
            NORMALIZED_LLM_PARAMS, COMPLETION_WRITER, PROVIDER_NAME,
            ASYNC_RESPONSE, SYNC_RESPONSE
        } = airouter);

    }
    

    /**
    * Initializes the Claude service by creating an Anthropic client instance
    * and registering this service as a provider with the AI chat service.
    * @private
    * @returns {Promise<void>}
    */
    async _init () {
        this.anthropic = new Anthropic({
            apiKey: this.config.apiKey
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
    }


    /**
    * Returns the default model identifier for Claude API interactions
    * @returns {string} The default model ID 'claude-3-5-sonnet-latest'
    */
    get_default_model () {
        return 'claude-3-5-sonnet-latest';
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
            * Completes a chat interaction with the Claude AI model
            * @param {Object} options - The completion options
            * @param {Array} options.messages - Array of chat messages to process
            * @param {boolean} options.stream - Whether to stream the response
            * @param {string} [options.model] - The Claude model to use, defaults to service default
            * @returns {TypedValue|Object} Returns either a TypedValue with streaming response or a completion object
            * @this {ClaudeService}
            */
            async complete ({ messages, stream, model, tools, max_tokens, temperature}) {
                await this.handle_puter_paths_(messages);

                if ( stream ) {
                    let usage_promise = new TeePromise();

                    let streamOperation;
                    const init_chat_stream = async ({ chatStream: completionWriter }) => {
                        console.log('the completion writer?', completionWriter);
                        await obtain(ASYNC_RESPONSE, {
                            [PROVIDER_NAME]: 'anthropic',
                            [NORMALIZED_LLM_PARAMS]: {
                                messages, model, tools, max_tokens, temperature,
                            },
                            [COMPLETION_WRITER]: completionWriter,
                            [ANTHROPIC_API_KEY]: this.config.apiKey,
                        });
                        // streamOperation = await this.anthropicApiType.stream(this.anthropic, completionWriter, {
                        //     messages, model, tools, max_tokens, temperature,
                        // })
                        // await streamOperation.run();
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
                        [PROVIDER_NAME]: 'anthropic',
                        [NORMALIZED_LLM_PARAMS]: {
                            messages, model, tools, max_tokens, temperature,
                        },
                        [ANTHROPIC_API_KEY]: this.config.apiKey,
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
    * Retrieves available Claude AI models and their specifications
    * @returns {Promise<Array>} Array of model objects containing:
    *   - id: Model identifier
    *   - name: Display name
    *   - aliases: Alternative names for the model
    *   - context: Maximum context window size
    *   - cost: Pricing details (currency, token counts, input/output costs)
    *   - qualitative_speed: Relative speed rating
    *   - max_output: Maximum output tokens
    *   - training_cutoff: Training data cutoff date
    */
    async models_ () {
        return [
            {
                id: 'claude-opus-4-20250514',
                aliases: ['claude-opus-4', 'claude-opus-4-latest'],
                name: 'Claude Opus 4',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 1500,
                    output: 7500,
                },
                max_tokens: 32000,
            },
            {
                id: 'claude-sonnet-4-20250514',
                aliases: ['claude-sonnet-4', 'claude-sonnet-4-latest'],
                name: 'Claude Sonnet 4',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 64000,
            },
            {
                id: 'claude-3-7-sonnet-20250219',
                aliases: ['claude-3-7-sonnet-latest'],
                succeeded_by: 'claude-sonnet-4-20250514',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 8192,
            },
            {
                id: 'claude-3-5-sonnet-20241022',
                name: 'Claude 3.5 Sonnet',
                aliases: ['claude-3-5-sonnet-latest'],
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                qualitative_speed: 'fast',
                training_cutoff: '2024-04',
                max_tokens: 8192,
            },
            {
                id: 'claude-3-5-sonnet-20240620',
                succeeded_by: 'claude-3-5-sonnet-20241022',
                context: 200000, // might be wrong
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 8192,
            },
            {
                id: 'claude-3-haiku-20240307',
                // aliases: ['claude-3-haiku-latest'],
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 25,
                    output: 125,
                },
                qualitative_speed: 'fastest',
                max_tokens: 4096,
            },
        ];
    }
}

module.exports = {
    ClaudeService,
};
