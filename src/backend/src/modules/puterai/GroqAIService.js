const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");
const { TeePromise } = require("../../util/promise");

class GroqAIService extends BaseService {
    static MODULES = {
        Groq: require('groq-sdk'),
    }

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

    get_default_model () {
        return 'llama-3.1-8b-instant';
    }
    
    static IMPLEMENTS = {
        'puter-chat-completion': {
            async models () {
                return await this.models_();
            },
            async list () {
                // They send: { "object": "list", data }
                const funny_wrapper = await this.client.models.list();
                return funny_wrapper.data;
            },
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
