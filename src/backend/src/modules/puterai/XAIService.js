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
    
    async _init () {
        this.anthropic = new Anthropic({
            apiKey: this.config.apiKey,
            baseURL: 'https://api.x.ai'
        });
    }
    
    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async list () {
                return [
                    'grok-beta',
                ];
            },
            async complete ({ messages, stream, model }) {
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
                            model: model ?? 'grok-beta',
                            max_tokens: 1000,
                            temperature: 0,
                            system: PUTER_PROMPT + JSON.stringify(system_prompts),
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
                    model: model ?? 'grok-beta',
                    max_tokens: 1000,
                    temperature: 0,
                    system: PUTER_PROMPT + JSON.stringify(system_prompts),
                    messages: adapted_messages,
                });
                return {
                    message: msg,
                    finish_reason: 'stop'
                };
            }
        }
    }
}

module.exports = {
    XAIService,
};
