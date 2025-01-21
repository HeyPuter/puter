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
const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");
const { TeePromise } = require('@heyputer/putility').libs.promise;


/**
* TogetherAIService class provides integration with Together AI's language models.
* Extends BaseService to implement chat completion functionality through the
* puter-chat-completion interface. Manages model listings, chat completions,
* and streaming responses while handling usage tracking and model fallback testing.
* @extends BaseService
*/
class TogetherAIService extends BaseService {
    static MODULES = {
        ['together-ai']: require('together-ai'),
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
    }


    /**
    * Initializes the TogetherAI service by setting up the API client and registering as a chat provider
    * @async
    * @returns {Promise<void>}
    * @private
    */
    async _init () {
        const require = this.require;
        const Together = require('together-ai');
        this.together = new Together({
            apiKey: this.config.apiKey
        });
        this.kvkey = this.modules.uuidv4();

        const svc_aiChat = this.services.get('ai-chat');
        console.log('registering provider', this.service_name);
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
    }


    /**
    * Returns the default model ID for the Together AI service
    * @returns {string} The ID of the default model (meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo)
    */
    get_default_model () {
        return 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
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
                let models = this.modules.kv.get(`${this.kvkey}:models`);
                if ( ! models ) models = await this.models_();
                return models.map(model => model.id);
            },
            /**
             * AI Chat completion method.
             * See AIChatService for more details.
             */
            async complete ({ messages, stream, model }) {
                if ( model === 'model-fallback-test-1' ) {
                    throw new Error('Model Fallback Test 1');
                }

                const completion = await this.together.chat.completions.create({
                    model: model ?? this.get_default_model(),
                    messages: messages,
                    stream,
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
                        for await ( const chunk of completion ) {
                            // DRY: same as openai
                            if ( chunk.usage ) {
                                usage_promise.resolve({
                                    input_tokens: chunk.usage.prompt_tokens,
                                    output_tokens: chunk.usage.completion_tokens,
                                });
                            }

                            if ( chunk.choices.length < 1 ) continue;
                            if ( chunk.choices[0].finish_reason ) {
                                stream.end();
                                break;
                            }
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
                }
                
                // return completion.choices[0];
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
    * Fetches and caches available AI models from Together API
    * @private
    * @returns {Promise<Array>} Array of model objects containing id, name, context length, 
    *                          description and pricing information
    * @remarks Models are cached for 5 minutes in KV store
    */
    async models_ () {
        let models = this.modules.kv.get(`${this.kvkey}:models`);
        if ( models ) return models;
        const api_models = await this.together.models.list();
        models = [];
        for ( const model of api_models ) {
            models.push({
                id: model.id,
                name: model.display_name,
                context: model.context_length,
                description: model.description,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: model.pricing.input,
                    output: model.pricing.output,
                },
            });
        }
        models.push({
            id: 'model-fallback-test-1',
            name: 'Model Fallback Test 1',
            context: 1000,
            cost: {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 10,
                output: 10,
            },
        });
        this.modules.kv.set(
            `${this.kvkey}:models`, models, { EX: 5*60 });
        return models;
    }
}

module.exports = {
    TogetherAIService,
};
