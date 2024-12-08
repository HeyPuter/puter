// METADATA // {"ai-commented":{"service":"claude"}}
const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");
const { TeePromise } = require('@heyputer/putility').libs.promise;


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
    static MODULES = {
        Groq: require('groq-sdk'),
    }


    /**
    * Initializes the GroqAI service by setting up the Groq client and registering with the AI chat provider
    * @returns {Promise<void>}
    * @private
    */
    async _init () {
        const Groq = require('groq-sdk');
        this.client = new Groq({
            apiKey: this.config.apiKey,
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
    }


    /**
    * Returns the default model ID for the Groq AI service
    * @returns {string} The default model ID 'llama-3.1-8b-instant'
    */
    get_default_model () {
        return 'llama-3.1-8b-instant';
    }
    
    static IMPLEMENTS = {
        'puter-chat-completion': {
            /**
            * Defines the interface implementations for the puter-chat-completion service
            * Contains methods for listing models and handling chat completions
            * @property {Object} models - Returns available AI models
            * @property {Object} list - Lists raw model data from the Groq API
            * @property {Object} complete - Handles chat completion requests with optional streaming
            * @returns {Object} Interface implementation object
            */
            async models () {
                return await this.models_();
            },
            /**
            * Lists available AI models from the Groq API
            * @returns {Promise<Array>} Array of model objects from the API's data field
            * @description Unwraps and returns the model list from the Groq API response,
            * which comes wrapped in an object with {object: "list", data: [...]}
            */
            async list () {
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
            async complete ({ messages, model, stream }) {
                for ( let i = 0; i < messages.length; i++ ) {
                    const message = messages[i];
                    if ( ! message.role ) message.role = 'user';
                }

                model = model ?? this.get_default_model();

                const completion = await this.client.chat.completions.create({
                    messages,
                    model,
                    stream,
                });

                if ( stream ) {
                    const usage_promise = new TeePromise();

                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    (async () => {
                        for await ( const chunk of completion ) {
                            let usage = chunk?.x_groq?.usage ?? chunk.usage;
                            if ( usage ) {
                                usage_promise.resolve({
                                    input_tokens: usage.prompt_tokens,
                                    output_tokens: usage.completion_tokens,
                                });
                                continue;
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
                
                const ret = completion.choices[0];
                ret.usage = {
                    input_tokens: completion.usage.prompt_tokens,
                    output_tokens: completion.usage.completion_tokens,
                };
                return ret;
            }
        }
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
    models_ () {
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
                }
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
                }
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
                    "output": 79
                }
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
                    "output": 99
                }
            },
            {
                "id": "llama-3.1-8b-instant",
                "name": "Llama 3.1 8B Instant 128k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 5,
                    "output": 8
                }
            },
            {
                "id": "llama-3.2-1b-preview",
                "name": "Llama 3.2 1B (Preview) 8k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 4,
                    "output": 4
                }
            },
            {
                "id": "llama-3.2-3b-preview",
                "name": "Llama 3.2 3B (Preview) 8k",
                "context": 128000,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 6,
                    "output": 6
                }
            },
            {
                id: 'llama-3.2-11b-vision-preview',
                name: 'Llama 3.2 11B Vision 8k (Preview)',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 18,
                    output: 18,
                }
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
                    "output": 79
                }
            },
            {
                "id": "llama3-8b-8192",
                "name": "Llama 3 8B 8k",
                "context": 8192,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 5,
                    "output": 8
                }
            },
            {
                "id": "mixtral-8x7b-32768",
                "name": "Mixtral 8x7B Instruct 32k",
                "context": 32768,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 24,
                    "output": 24
                }
            },
            {
                "id": "llama-guard-3-8b",
                "name": "Llama Guard 3 8B 8k",
                "context": 8192,
                "cost": {
                    "currency": "usd-cents",
                    "tokens": 1000000,
                    "input": 20,
                    "output": 20
                }
            }
        ];
    }
}

module.exports = {
    GroqAIService,
};
