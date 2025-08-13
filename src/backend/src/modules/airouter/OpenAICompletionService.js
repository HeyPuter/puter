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
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { LLRead } = require('../../filesystem/ll_operations/ll_read');
const BaseService = require('../../services/BaseService');
const { Context } = require('../../util/context');
const { stream_to_buffer } = require('../../util/streamutil');
const OpenAIUtil = require('./lib/OpenAIUtil');

// We're capping at 5MB, which sucks, but Chat Completions doesn't suuport
// file inputs.
const MAX_FILE_SIZE = 5 * 1_000_000;

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
     * @type {import('openai').OpenAI}
     */
    openai;

    /**
    * Initializes the OpenAI service by setting up the API client with credentials
    * and registering this service as a chat provider.
    * 
    * @returns {Promise<void>} Resolves when initialization is complete
    * @private
    */
    async _init () {
        // Check for the new format under `services.openai.apiKey`
        let apiKey =
            this.config?.services?.openai?.apiKey ??
            this.global_config?.services?.openai?.apiKey;
    
        // Fallback to the old format for backward compatibility
        if (!apiKey) {
            apiKey =
                this.config?.openai?.secret_key ??
                this.global_config?.openai?.secret_key;
    
            // Log a warning to inform users about the deprecated format
            this.log.warn(
                'The `openai.secret_key` configuration format is deprecated. ' +
                'Please use `services.openai.apiKey` instead.'
            );
        }
    
        if (!apiKey) {
            throw new Error('OpenAI API key is missing in configuration.');
        }
    
        this.openai = new this.modules.openai.OpenAI({
            apiKey: apiKey
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
        return 'gpt-4.1-nano';
    }


    /**
    * Returns an array of available AI models with their pricing information.
    * Each model object includes an ID and cost details (currency, tokens, input/output rates).
    * @returns {Promise<Array<{id: string, cost: {currency: string, tokens: number, input: number, output: number}}>}
    */
    async models_ () {
        return [
            {
                id: 'gpt-5-2025-08-07',
                aliases: ['gpt-5'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 125,
                    output: 1000,
                },
                max_tokens: 128000,
            },
            {
                id: 'gpt-5-mini-2025-08-07',
                aliases: ['gpt-5-mini'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 25,
                    output: 200,
                },
                max_tokens: 128000,
            },
            {
                id: 'gpt-5-nano-2025-08-07',
                aliases: ['gpt-5-nano'],
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 5,
                    output: 40,
                },
                max_tokens: 128000,
            },
            {
                id: 'gpt-5-chat-latest',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 125,
                    output: 1000,
                },
                max_tokens: 128000,
            },
            {
                id: 'gpt-4o',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 250,
                    output: 1000,
                },
                max_tokens: 16384,
            },
            {
                id: 'gpt-4o-mini',
                max_tokens: 16384,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 15,
                    output: 60,
                },
                max_tokens: 16384,
            },
            {
                id: 'o1',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 1500,
                    output: 6000,
                },
                max_tokens: 100000,
            },
            {
                id: 'o1-mini',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1200,
                },
                max_tokens: 65536,
            },
            {
                id: 'o1-pro',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 15000,
                    output: 60000,
                },
                max_tokens: 100000,
            },
            {
                id: 'o3',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 1000,
                    output: 4000,
                },
                max_tokens: 100000,
            },
            {
                id: 'o3-mini',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 110,
                    output: 440,
                },
                max_tokens: 100000,
            },
            {
                id: 'o4-mini',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 110,
                    output: 440,
                },
                max_tokens: 100000,
            },
            {
                id: 'gpt-4.1',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 200,
                    output: 800,
                },
                max_tokens: 32768,
            },
            {
                id: 'gpt-4.1-mini',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 40,
                    output: 160,
                },
                max_tokens: 32768,
            },
            {
                id: 'gpt-4.1-nano',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 40,
                },
                max_tokens: 32768,
            },
            {
                id: 'gpt-4.5-preview',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 7500,
                    output: 15000,
                }
            }
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

            async complete ({ messages, test_mode, stream, model, tools, max_tokens, temperature }) {
                return await this.complete(messages, {
                    model: model,
                    tools,
                    moderation: true,
                    stream,
                    max_tokens,
                    temperature
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
    async complete (messages, {
        stream, moderation, model, tools,
        temperature, max_tokens,
    }) {
        // Validate messages
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }

        model = model ?? this.get_default_model();

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
        
        // Perform file uploads
        {
            const actor = Context.get('actor');
            const { user } = actor.type;
            
            const file_input_tasks = [];
            for ( const message of messages ) {
                // We can assume `message.content` is not undefined because
                // Messages.normalize_single_message ensures this.
                for ( const contentPart of message.content ) {
                    if ( ! contentPart.puter_path ) continue;
                    file_input_tasks.push({
                        node: await (new FSNodeParam(contentPart.puter_path)).consolidate({
                            req: { user },
                            getParam: () => contentPart.puter_path,
                        }),
                        contentPart,
                    });
                }
            }
            
            const promises = [];
            for ( const task of file_input_tasks ) promises.push((async () => {
                if ( await task.node.get('size') > MAX_FILE_SIZE ) {
                    delete task.contentPart.puter_path;
                    task.contentPart.type = 'text';
                    task.contentPart.text = `{error: input file exceeded maximum of ${MAX_FILE_SIZE} bytes; ` +
                        `the user did not write this message}`; // "poor man's system prompt"
                    return; // "continue"
                }
                
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode: task.node,
                });
                const require = this.require;
                const mime = require('mime-types');
                const mimeType = mime.contentType(await task.node.get('name'));
                
                const buffer = await stream_to_buffer(stream);
                const base64 = buffer.toString('base64');
                
                delete task.contentPart.puter_path;
                if ( mimeType.startsWith('image/') ) {
                    task.contentPart.type = 'image_url',
                    task.contentPart.image_url = {
                        url: `data:${mimeType};base64,${base64}`,
                    };
                } else if ( mimeType.startsWith('audio/') ) {
                    task.contentPart.type = 'input_audio',
                    task.contentPart.input_audio = {
                        data: `data:${mimeType};base64,${base64}`,
                        format: mimeType.split('/')[1],
                    }
                } else {
                    task.contentPart.type = 'text';
                    task.contentPart.text = `{error: input file has unsupported MIME type; ` +
                        `the user did not write this message}`; // "poor man's system prompt"
                }
            })());
            await Promise.all(promises);
        }
        
        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAIUtil.process_input_messages(messages);

        const completion = await this.openai.chat.completions.create({
            user: user_private_uid,
            messages: messages,
            model: model,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        });

        return OpenAIUtil.handle_completion_output({
            usage_calculator: OpenAIUtil.create_usage_calculator({
                model_details: (await this.models_()).find(m => m.id === model),
            }),
            stream, completion,
            moderate: moderation && this.check_moderation.bind(this),
        });
    }
}

module.exports = {
    OpenAICompletionService,
};
