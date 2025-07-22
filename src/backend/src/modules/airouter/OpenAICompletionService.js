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
const { TeePromise } = require('@heyputer/putility/src/libs/promise');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { LLRead } = require('../../filesystem/ll_operations/ll_read');
const BaseService = require('../../services/BaseService');
const { Context } = require('../../util/context');
const { TypedValue } = require('../../services/drivers/meta/Runtime');
let
    obtain,
    OPENAI_CLIENT, SYNC_RESPONSE, PROVIDER_NAME, NORMALIZED_LLM_PARAMS,
    ASYNC_RESPONSE, USAGE_WRITER, COMPLETION_WRITER;

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
    
    async _construct () {
        ({
            obtain,
            OPENAI_CLIENT, SYNC_RESPONSE, PROVIDER_NAME, NORMALIZED_LLM_PARAMS,
            ASYNC_RESPONSE, USAGE_WRITER, COMPLETION_WRITER
        } = require('@heyputer/airouter.js'));
    }

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
        const { models } = await import('@heyputer/airouter.js');
        return models.openai;
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
        
        await this.handle_puter_paths_(messages);
        
        if ( stream ) {
            let usage_promise = new TeePromise();

            let streamOperation;
            const init_chat_stream = async ({ chatStream: completionWriter }) => {
                await obtain(ASYNC_RESPONSE, {
                    [PROVIDER_NAME]: 'openai',
                    [NORMALIZED_LLM_PARAMS]: {
                        messages, model, tools, max_tokens, temperature,
                    },
                    [COMPLETION_WRITER]: completionWriter,
                    [OPENAI_CLIENT]: this.openai,
                    [USAGE_WRITER]: usage_promise,
                })
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
                [PROVIDER_NAME]: 'openai',
                [NORMALIZED_LLM_PARAMS]: {
                    messages, model, tools, max_tokens, temperature,
                },
                [OPENAI_CLIENT]: this.openai,
            });
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
                    async getSize () {
                        return await node.get('size')
                    },
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
}

module.exports = {
    OpenAICompletionService,
};
