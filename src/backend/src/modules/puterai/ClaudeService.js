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
const { whatis } = require("../../util/langutil");
const { PassThrough } = require("stream");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const FunctionCalling = require("./lib/FunctionCalling");
const { TeePromise } = require('@heyputer/putility').libs.promise;

const PUTER_PROMPT = `
    You are running on an open-source platform called Puter,
    as the Claude implementation for a driver interface
    called puter-chat-completion.
    
    The following JSON contains system messages from the
    user of the driver interface (typically an app on Puter):
`.replace('\n', ' ').trim();



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
            async complete ({ messages, stream, model, tools }) {
                const adapted_messages = [];

                tools = FunctionCalling.make_claude_tools(tools);
                
                const system_prompts = [];
                let previous_was_user = false;
                for ( const message of messages ) {
                    if ( typeof message.content === 'string' ) {
                        message.content = {
                            type: 'text',
                            text: message.content,
                        };
                    }
                    if ( whatis(message.content) !== 'array' ) {
                        message.content = [message.content];
                    }
                    if ( ! message.role ) message.role = 'user';
                    if ( message.role === 'user' && previous_was_user ) {
                        const last_msg = adapted_messages[adapted_messages.length-1];
                        last_msg.content.push(
                            ...(Array.isArray ? message.content : [message.content])
                        );
                        continue;
                    }
                    if ( message.role === 'system' ) {
                        system_prompts.push(...message.content);
                        continue;
                    }
                    adapted_messages.push(message);
                    if ( message.role === 'user' ) {
                        previous_was_user = true;
                    } else {
                        previous_was_user = false;
                    }
                }

                if ( stream ) {
                    let usage_promise = new TeePromise();

                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    (async () => {
                        const completion = await this.anthropic.messages.stream({
                            model: model ?? this.get_default_model(),
                            max_tokens: (model === 'claude-3-5-sonnet-20241022' || model === 'claude-3-5-sonnet-20240620') ? 8192 : 4096,
                            temperature: 0,
                            system: PUTER_PROMPT + JSON.stringify(system_prompts),
                            messages: adapted_messages,
                            ...(tools ? { tools } : {}),
                        });
                        const counts = { input_tokens: 0, output_tokens: 0 };

                        let content_block; // for when it's buffered ("tool use")
                        let buffer = '';

                        let state;
                        const STATES = {
                            ready: {
                                on_event: (event) => {
                                    if ( event.type === 'content_block_start' ) {
                                        if ( event.content_block.type === 'text' ) {
                                            state = STATES.message;
                                        } else if ( event.content_block.type === 'tool_use' ) {
                                            state = STATES.tool_use;
                                            content_block = event.content_block;
                                            buffer = '';
                                        }
                                    }
                                }
                            },
                            message: {
                                on_event: (event) => {
                                    if ( event.type === 'content_block_stop' ) {
                                        state = STATES.ready;
                                    }
                                    if (
                                        event.type !== 'content_block_delta' ||
                                        event.delta.type !== 'text_delta'
                                    ) return;
                                    const str = JSON.stringify({
                                        text: event.delta.text,
                                    });
                                    stream.write(str + '\n');
                                }
                            },
                            tool_use: {
                                on_event: (event) => {
                                    if ( event.type === 'content_block_stop' ) {
                                        state = STATES.ready;
                                        
                                        // Yeah... claude will send an empty string instead of
                                        // an empty object when there's no input. So we have to
                                        // check for that. Good job, Anthropic.
                                        if ( buffer === '' ) {
                                            buffer = '{}';
                                        }
                                        const str = JSON.stringify({
                                            tool_use: {
                                                ...content_block,
                                                input: JSON.parse(buffer),
                                            },
                                        });
                                        stream.write(str + '\n');
                                        buffer = '';
                                        return;
                                    }

                                    if (
                                        event.type !== 'content_block_delta' ||
                                        event.delta.type !== 'input_json_delta'
                                    ) return;

                                    buffer += event.delta.partial_json;
                                }
                            }
                        };
                        state = STATES.ready;

                        for await ( const event of completion ) {
                            const input_tokens =
                                (event?.usage ?? event?.message?.usage)?.input_tokens;
                            const output_tokens =
                                (event?.usage ?? event?.message?.usage)?.output_tokens;

                            if ( input_tokens ) counts.input_tokens += input_tokens;
                            if ( output_tokens ) counts.output_tokens += output_tokens;

                            state.on_event(event);

                            if (
                                event.type !== 'content_block_delta' ||
                                event.delta.type !== 'text_delta'
                            ) continue;
                            const str = JSON.stringify({
                                type: 'text',
                                text: event.delta.text,
                            });
                            stream.write(str + '\n');
                        }
                        stream.end();
                        usage_promise.resolve(counts);
                    })();

                    return new TypedValue({ $: 'ai-chat-intermediate' }, {
                        stream: true,
                        response: retval,
                        usage_promise: usage_promise,
                    });
                }

                const msg = await this.anthropic.messages.create({
                    model: model ?? this.get_default_model(),
                    max_tokens: (model === 'claude-3-5-sonnet-20241022' || model === 'claude-3-5-sonnet-20240620') ? 8192 : 4096,
                    temperature: 0,
                    system: PUTER_PROMPT + JSON.stringify(system_prompts),
                    messages: adapted_messages,
                    ...(tools ? { tools } : {}),
                });
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
                max_output: 8192,
                training_cutoff: '2024-04',
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
            },
        ];
    }
}

module.exports = {
    ClaudeService,
};
