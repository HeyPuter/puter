const { default: Anthropic } = require("@anthropic-ai/sdk");
const BaseService = require("../../services/BaseService");
const { whatis } = require("../../util/langutil");
const { PassThrough } = require("stream");
const { TypedValue } = require("../../services/drivers/meta/Runtime");

const PUTER_PROMPT = `
    You are running on an open-source platform called Puter,
    as the xAI implementation for a driver interface
    called puter-chat-completion.
    
    The following JSON contains system messages from the
    user of the driver interface (typically an app on Puter):
`.replace('\n', ' ').trim();

class XAIService extends BaseService {
    static MODULES = {
        Anthropic: require('@anthropic-ai/sdk'),
    }

    get_system_prompt () {
        return PUTER_PROMPT;
    }

    adapt_model (model) {
        return model;
    }
    
    async _init () {
        this.anthropic = new Anthropic({
            apiKey: this.global_config.services.xai.apiKey,
            baseURL: 'https://api.x.ai'
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
                
                if ( stream ) {
                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    (async () => {
                        const completion = await this.anthropic.messages.stream({
                            model: model ?? this.get_default_model(),
                            max_tokens: 1000,
                            temperature: 0,
                            system: this.get_system_prompt() +
                                JSON.stringify(system_prompts),
                            messages: adapted_messages,
                        });
                        for await ( const event of completion ) {
                            if (
                                event.type !== 'content_block_delta' ||
                                event.delta.type !== 'text_delta'
                            ) continue;
                            const str = JSON.stringify({
                                text: event.delta.text,
                            });
                            stream.write(str + '\n');
                        }
                        stream.end();
                    })();

                    return retval;
                }

                const msg = await this.anthropic.messages.create({
                    model: model ?? this.get_default_model(),
                    max_tokens: 1000,
                    temperature: 0,
                    system: this.get_system_prompt() +
                        JSON.stringify(system_prompts),
                    messages: adapted_messages,
                });
                return {
                    message: msg,
                    finish_reason: 'stop'
                };
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
