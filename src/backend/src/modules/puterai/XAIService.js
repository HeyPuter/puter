/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { whatis, nou } = require("../../util/langutil");
const { PassThrough } = require("stream");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { TeePromise } = require('@heyputer/putility').libs.promise;

const PUTER_PROMPT = `
    You are running on an open-source platform called Puter,
    as the xAI implementation for a driver interface
    called puter-chat-completion.
    
    The following JSON contains system messages from the
    user of the driver interface (typically an app on Puter):
`.replace('\n', ' ').trim();


/**
* XAIService class - Provides integration with X.AI's API for chat completions
* Extends BaseService to implement the puter-chat-completion interface.
* Handles model management, message adaptation, streaming responses,
* and usage tracking for X.AI's language models like Grok.
* @extends BaseService
*/
class XAIService extends BaseService {
    static MODULES = {
        openai: require('openai'),
    }


    /**
    * Gets the system prompt used for AI interactions
    * @returns {string} The base system prompt that identifies the AI as running on Puter
    */
    get_system_prompt () {
        return PUTER_PROMPT;
    }

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
            apiKey: this.global_config.services.xai.apiKey,
            baseURL: "https://api.x.ai/v1",
        });

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
            async complete ({ messages, stream, model }) {
                model = this.adapt_model(model);
                const adapted_messages = [];
                
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
                    }
                }

                adapted_messages.unshift({
                    role: 'system',
                    content: this.get_system_prompt() +
                        JSON.stringify(system_prompts),
                })

                const completion = await this.openai.chat.completions.create({
                    messages: adapted_messages,
                    model: model ?? this.get_default_model(),
                    max_tokens: 1000,
                    stream,
                    ...(stream ? {
                        stream_options: { include_usage: true },
                    } : {}),
                });
                
                if ( stream ) {
                    let usage_promise = new TeePromise();

                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    (async () => {
                        let last_usage = null;
                        for await ( const chunk of completion ) {
                            if ( chunk.usage ) last_usage = chunk.usage;
                            // if (
                            //     event.type !== 'content_block_delta' ||
                            //     event.delta.type !== 'text_delta'
                            // ) continue;
                            // const str = JSON.stringify({
                            //     text: event.delta.text,
                            // });
                            // stream.write(str + '\n');
                            if ( chunk.choices.length < 1 ) continue;
                            if ( nou(chunk.choices[0].delta.content) ) continue;
                            const str = JSON.stringify({
                                text: chunk.choices[0].delta.content
                            });
                            stream.write(str + '\n');
                        }
                        usage_promise.resolve({
                            input_tokens: last_usage.prompt_tokens,
                            output_tokens: last_usage.completion_tokens,
                        });
                        stream.end();
                    })();

                    return new TypedValue({ $: 'ai-chat-intermediate' }, {
                        stream: true,
                        response: retval,
                        usage_promise: usage_promise,
                    });
                }

                const ret = completion.choices[0];
                ret.usage = {
                    input_tokens: completion.usage.prompt_tokens,
                    output_tokens: completion.usage.completion_tokens,
                };
                return ret;
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
        return [
            {
                id: 'grok-beta',
                name: 'Grok Beta',
                context: 131072,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 500,
                    output: 1500,
                },
            },
            {
                id: 'grok-vision-beta',
                name: 'Grok Vision Beta',
                context: 8192,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 500,
                    output: 1500,
                    image: 1000,
                },
            }
        ];
    }
}

module.exports = {
    XAIService,
};
