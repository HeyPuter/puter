const { default: Anthropic } = require("@anthropic-ai/sdk");
const BaseService = require("../../services/BaseService");
const { whatis, nou } = require("../../util/langutil");
const { PassThrough } = require("stream");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { TeePromise } = require("../../util/promise");

const PUTER_PROMPT = `
    You are running on an open-source platform called Puter,
    as the xAI implementation for a driver interface
    called puter-chat-completion.
    
    The following JSON contains system messages from the
    user of the driver interface (typically an app on Puter):
`.replace('\n', ' ').trim();

class XAIService extends BaseService {
    static MODULES = {
        openai: require('openai'),
    }

    get_system_prompt () {
        return PUTER_PROMPT;
    }

    adapt_model (model) {
        return model;
    }
    
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

    get_default_model () {
        return 'grok-beta';
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async models () {
                return await this.models_();
            },
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
