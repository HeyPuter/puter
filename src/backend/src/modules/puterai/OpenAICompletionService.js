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
const { PassThrough } = require('stream');
const BaseService = require('../../services/BaseService');
const { TypedValue } = require('../../services/drivers/meta/Runtime');
const { Context } = require('../../util/context');
const smol = require('@heyputer/putility').libs.smol;
const { nou } = require('../../util/langutil');
const { TeePromise } = require('@heyputer/putility').libs.promise;


/**
* OpenAICompletionService class provides an interface to OpenAI's chat completion API.
* Extends BaseService to handle chat completions, message moderation, token counting,
* and streaming responses. Implements the puter-chat-completion interface and manages
* OpenAI API interactions with support for multiple models including GPT-4 variants.
* Handles usage tracking, spending records, and content moderation.
*/
class OpenAICompletionService extends BaseService {
    static MODULES = {
        openai: require('openai'),
        tiktoken: require('tiktoken'),
    }
    /**
    * Initializes the OpenAI service by setting up the API client with credentials
    * and registering this service as a chat provider.
    * 
    * @returns {Promise<void>} Resolves when initialization is complete
    * @private
    */
    async _init () {
        const sk_key =
            this.config?.openai?.secret_key ??
            this.global_config.openai?.secret_key;

        this.openai = new this.modules.openai.OpenAI({
            apiKey: sk_key
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
    }


    /**
    * Gets the default model identifier for OpenAI completions
    * @returns {string} The default model ID 'gpt-4o-mini'
    */
    get_default_model () {
        return 'gpt-4o-mini';
    }


    /**
    * Returns an array of available AI models with their pricing information.
    * Each model object includes an ID and cost details (currency, tokens, input/output rates).
    * @returns {Promise<Array<{id: string, cost: {currency: string, tokens: number, input: number, output: number}}>}
    */
    async models_ () {
        return [
            {
                id: 'gpt-4o',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 250,
                    output: 500,
                }
            },
            {
                id: 'gpt-4o-mini',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 15,
                    output: 30,
                }
            },
            // {
            //     id: 'o1-preview',
            //     cost: {
            //         currency: 'usd-cents',
            //         tokens: 1_000_000,
            //         input: 1500,
            //         output: 6000,
            //     },
            // }
            {
                id: 'o1-mini',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1200,
                }
            },
        ];
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
            async complete ({ messages, test_mode, stream, model, tools }) {

                // for now this code (also in AIChatService.js) needs to be
                // duplicated because this hasn't been moved to be under
                // the centralised controller yet
                const svc_event = this.services.get('event');
                const event = {
                    allow: true,
                    intended_service: 'openai',
                    parameters: { messages }
                };
                await svc_event.emit('ai.prompt.validate', event);
                if ( ! event.allow ) {
                    test_mode = true;
                }
                
                if ( test_mode ) {
                    const { LoremIpsum } = require('lorem-ipsum');
                    const li = new LoremIpsum({
                        sentencesPerParagraph: {
                            max: 8,
                            min: 4
                        },
                        wordsPerSentence: {
                            max: 20,
                            min: 12
                        },
                    });
                    return {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": li.generateParagraphs(
                                Math.floor(Math.random() * 3) + 1
                            ),
                        },
                        "logprobs": null,
                        "finish_reason": "stop"
                    }
                }

                return await this.complete(messages, {
                    model: model,
                    tools,
                    moderation: true,
                    stream,
                });
            }
        }
    };


    /**
    * Checks text content against OpenAI's moderation API for inappropriate content
    * @param {string} text - The text content to check for moderation
    * @returns {Promise<Object>} Object containing flagged status and detailed results
    * @property {boolean} flagged - Whether the content was flagged as inappropriate
    * @property {Object} results - Raw moderation results from OpenAI API
    */
    async check_moderation (text) {
        // create moderation
        const results = await this.openai.moderations.create({
            input: text,
        });

        let flagged = false;

        for ( const result of results?.results ?? [] ) {
            if ( result.flagged ) {
                flagged = true;
                break;
            }
        }

        return {
            flagged,
            results,
        };
    }


    /**
    * Completes a chat conversation using OpenAI's API
    * @param {Array} messages - Array of message objects or strings representing the conversation
    * @param {Object} options - Configuration options
    * @param {boolean} options.stream - Whether to stream the response
    * @param {boolean} options.moderation - Whether to perform content moderation
    * @param {string} options.model - The model to use for completion
    * @returns {Promise<Object>} The completion response containing message and usage info
    * @throws {Error} If messages are invalid or content is flagged by moderation
    */
    async complete (messages, { stream, moderation, model, tools }) {
        // Validate messages
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }

        model = model ?? this.get_default_model();

        messages.unshift({
            role: 'system',
            content: 'You are running inside a Puter app.',
        })
        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

        const user_private_uid = Context.get('actor')?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for an OpenAI request',
                alarm: true,
                trace: true,
            });
        }

        this.log.info('PRIVATE UID FOR USER ' + user_private_uid)

        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        for ( const msg of messages ) {
            if ( ! msg.content ) continue;
            if ( typeof msg.content !== 'object' ) continue;

            const content = msg.content;

            for ( const o of content ) {
                if ( ! o.hasOwnProperty('image_url') ) continue;
                if ( o.type ) continue;
                o.type = 'image_url';
            }
        }

        const completion = await this.openai.chat.completions.create({
            user: user_private_uid,
            messages: messages,
            model: model,
            ...(tools ? { tools } : {}),
            // max_tokens,
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        });

        if ( stream ) {
            let usage_promise = new TeePromise();
        
            const entire = [];
            const stream = new PassThrough();
            const retval = new TypedValue({
                $: 'stream',
                content_type: 'application/x-ndjson',
                chunked: true,
            }, stream);
            (async () => {
                for await ( const chunk of completion ) {
                    entire.push(chunk);
                    if ( chunk.usage ) {
                        usage_promise.resolve({
                            input_tokens: chunk.usage.prompt_tokens,
                            output_tokens: chunk.usage.completion_tokens,
                        });
                        continue;
                    }
                    if ( chunk.choices.length < 1 ) continue;
                    if ( nou(chunk.choices[0].delta.content) ) continue;
                    const str = JSON.stringify({
                        text: chunk.choices[0].delta.content
                    });
                    stream.write(str + '\n');
                }
                stream.end();
            })();
            
            return new TypedValue({ $: 'ai-chat-intermediate' }, {
                stream: true,
                response: retval,
                usage_promise: usage_promise,
            });
            return retval;
        }


        this.log.info('how many choices?: ' + completion.choices.length);

        const is_empty = completion.choices?.[0]?.message?.content?.trim() === '';
        if ( is_empty ) {
            // GPT refuses to generate an empty response if you ask it to,
            // so this will probably only happen on an error condition.
            throw new Error('an empty response was generated');
        }

        // We need to moderate the completion too
        const mod_text = completion.choices[0].message.content;
        if ( moderation && mod_text !== null ) {
            const moderation_result = await this.check_moderation(mod_text);
            if ( moderation_result.flagged ) {
                throw new Error('message is not allowed');
            }
        }
        
        const ret = completion.choices[0];
        ret.usage = {
            input_tokens: completion.usage.prompt_tokens,
            output_tokens: completion.usage.completion_tokens,
        };
        return ret;
    }
}

module.exports = {
    OpenAICompletionService,
};
