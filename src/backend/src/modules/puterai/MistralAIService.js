const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");

const axios = require('axios');

class MistralAIService extends BaseService {
    static MODULES = {
        '@mistralai/mistralai': require('@mistralai/mistralai'),
    }
    _construct () {
        this.costs_ = {
            'mistral-large-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 200,
                output: 600,
            },
            'pixtral-large-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 200,
                output: 600,
            },
            'mistral-small-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 20,
                output: 60,
            },
            'codestral-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 20,
                output: 60,
            },
            'ministral-8b-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 10,
                output: 10,
            },
            'ministral-3b-latest': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 4,
                output: 4,
            },
            'pixtral-12b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 15,
                output: 15,
            },
            'mistral-nemo': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 15,
                output: 15,
            },
            'open-mistral-7b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 25,
                output: 25,
            },
            'open-mixtral-8x7b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 7,
                output: 7,
            },
            'open-mixtral-8x22b': {
                currency: 'usd-cents',
                tokens: 1_000_000,
                input: 2,
                output: 6,
            },
        };
    }
    async _init () {
        const require = this.require;
        const { Mistral } = require('@mistralai/mistralai');
        this.api_base_url = 'https://api.mistral.ai/v1';
        this.client = new Mistral({
            apiKey: this.config.apiKey,
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });

        // TODO: make this event-driven so it doesn't hold up boot
        await this.populate_models_();
    }
    async populate_models_ () {
        const resp = await axios({
            method: 'get',
            url: this.api_base_url + '/models',
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`
            }
        })

        const response_json = resp.data;
        const models = response_json.data;
        this.models_array_ = [];
        for ( const api_model of models ) {
            
            let cost = this.costs_[api_model.id];
            if ( ! cost ) for ( const alias of api_model.aliases ) {
                cost = this.costs_[alias];
                if ( cost ) break;
            }
            if ( ! cost ) continue;
            const model = {
                id: api_model.id,
                name: api_model.description,
                aliases: api_model.aliases,
                context: api_model.max_context_length,
                capabilities: api_model.capabilities,
                vision: api_model.capabilities.vision,
                cost,
            };

            this.models_array_.push(model);
        }
        // return resp.data;
    }
    get_default_model () {
        return 'mistral-large-latest';
    }
    static IMPLEMENTS = {
        'puter-chat-completion': {
            async models () {
                return this.models_array_;
            },
            async list () {
                return this.models_array_.map(m => m.id);
            },
            async complete ({ messages, stream, model }) {

                for ( let i = 0; i < messages.length; i++ ) {
                    const message = messages[i];
                    if ( ! message.role ) message.role = 'user';
                }

                if ( stream ) {
                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    const completion = await this.client.chat.stream({
                        model: model ?? this.get_default_model(),
                        messages,
                    });
                    (async () => {
                        for await ( let chunk of completion ) {
                            // just because Mistral wants to be different
                            chunk = chunk.data;

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
                    return retval;
                }

                const completion = await this.client.chat.complete({
                    model: model ?? this.get_default_model(),
                    messages,
                });
                // Expected case when mistralai/client-ts#23 is fixed
                const ret = completion.choices[0];
                ret.usage = {
                    input_tokens: completion.usage.promptTokens,
                    output_tokens: completion.usage.completionTokens,
                };
                return ret;
            }
        }
    }
}

module.exports = { MistralAIService };
