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
const { default: Anthropic } = require("@anthropic-ai/sdk");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const FunctionCalling = require("./lib/FunctionCalling");
const Messages = require("./lib/Messages");
const { TeePromise } = require('@heyputer/putility').libs.promise;

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
            */
            async complete ({ messages, stream, model, tools, max_tokens, temperature}) {
                tools = FunctionCalling.make_claude_tools(tools);
                
                let system_prompts;
                [system_prompts, messages] = Messages.extract_and_remove_system_messages(messages);
                
                const sdk_params = {
                    model: model ?? this.get_default_model(),
                    max_tokens: Math.floor(max_tokens) ||
                        ((
                            model === 'claude-3-5-sonnet-20241022'
                            || model === 'claude-3-5-sonnet-20240620'
                        ) ? 8192 : 4096), //required
                    temperature: temperature || 0, // required
                    ...(system_prompts ? {
                        system: system_prompts.length > 1
                            ? JSON.stringify(system_prompts)
                            : JSON.stringify(system_prompts[0])
                    } : {}),
                    messages,
                    ...(tools ? { tools } : {}),
                };
                
                console.log('\x1B[26;1m ===== SDK PARAMETERS', require('util').inspect(sdk_params, undefined, Infinity));

                if ( stream ) {
                    let usage_promise = new TeePromise();

                    const init_chat_stream = async ({ chatStream }) => {
                        const completion = await this.anthropic.messages.stream(sdk_params);
                        const counts = { input_tokens: 0, output_tokens: 0 };

                        let message, contentBlock;
                        for await ( const event of completion ) {
                            const input_tokens =
                                (event?.usage ?? event?.message?.usage)?.input_tokens;
                            const output_tokens =
                                (event?.usage ?? event?.message?.usage)?.output_tokens;

                            if ( input_tokens ) counts.input_tokens += input_tokens;
                            if ( output_tokens ) counts.output_tokens += output_tokens;

                            if ( event.type === 'message_start' ) {
                                message = chatStream.message();
                                continue;
                            }
                            if ( event.type === 'message_stop' ) {
                                message.end();
                                message = null;
                                continue;
                            }

                            if ( event.type === 'content_block_start' ) {
                                if ( event.content_block.type === 'tool_use' ) {
                                    contentBlock = message.contentBlock({
                                        type: event.content_block.type,
                                        id: event.content_block.id,
                                        name: event.content_block.name,
                                    });
                                    continue;
                                }
                                contentBlock = message.contentBlock({
                                    type: event.content_block.type,
                                });
                                continue;
                            }

                            if ( event.type === 'content_block_stop' ) {
                                contentBlock.end();
                                contentBlock = null;
                                continue;
                            }

                            if ( event.type === 'content_block_delta' ) {
                                if ( event.delta.type === 'input_json_delta' ) {
                                    contentBlock.addPartialJSON(event.delta.partial_json);
                                    continue;
                                }
                                if ( event.delta.type === 'text_delta' ) {
                                    contentBlock.addText(event.delta.text);
                                    continue;
                                }
                            }
                        }
                        chatStream.end();
                        usage_promise.resolve(counts);
                    };

                    return new TypedValue({ $: 'ai-chat-intermediate' }, {
                        init_chat_stream,
                        stream: true,
                        usage_promise: usage_promise,
                    });
                }

                const msg = await this.anthropic.messages.create(sdk_params);
                return {
                    message: msg,
                    usage: msg.usage,
                    finish_reason: 'stop'
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
