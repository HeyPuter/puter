const { PassThrough } = require('stream');
const APIError = require('../../api/APIError');
const BaseService = require('../../services/BaseService');
const { TypedValue } = require('../../services/drivers/meta/Runtime');
const { Context } = require('../../util/context');
const SmolUtil = require('../../util/smolutil');
const { nou } = require('../../util/langutil');

class OpenAICompletionService extends BaseService {
    static MODULES = {
        openai: require('openai'),
        tiktoken: require('tiktoken'),
    }
    async _init () {
        const sk_key =
            this.config?.openai?.secret_key ??
            this.global_config.openai?.secret_key;

        this.openai = new this.modules.openai.OpenAI({
            apiKey: sk_key
        });
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async list () {
                return [
                    'gpt-4o',
                    'gpt-4o-mini',
                ];
            },
            async complete ({ messages, test_mode, stream, model }) {
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
                    moderation: true,
                    stream,
                });
            }
        }
    };

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

    async complete (messages, { stream, moderation, model }) {
        // Validate messages
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }

        model = model ?? 'gpt-4o-mini';

        for ( let i = 0; i < messages.length; i++ ) {
            let msg = messages[i];
            if ( typeof msg === 'string' ) msg = { content: msg };
            if ( typeof msg !== 'object' ) {
                throw new Error('each message must be a string or an object');
            }
            if ( ! msg.role ) msg.role = 'user';
            if ( ! msg.content ) {
                throw new Error('each message must have a `content` property');
            }

            const texts = [];
            if ( typeof msg.content === 'string' ) texts.push(msg.content);
            else if ( typeof msg.content === 'object' ) {
                if ( Array.isArray(msg.content) ) {
                    texts.push(...msg.content.filter(o => (
                        ( ! o.type && o.hasOwnProperty('text') ) ||
                        o.type === 'text')).map(o => o.text));
                }
                else texts.push(msg.content.text);
            }

            if ( moderation ) {
                for ( const text of texts ) {
                    const moderation_result = await this.check_moderation(text);
                    if ( moderation_result.flagged ) {
                        throw new Error('message is not allowed');
                    }
                }
            }

            messages[i] = msg;
        }

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

            const content = SmolUtil.ensure_array(msg.content);

            for ( const o of content ) {
                if ( ! o.hasOwnProperty('image_url') ) continue;
                if ( o.type ) continue;
                o.type = 'image_url';
            }
        }

        console.log('DATA GOING IN', messages);

        // Count tokens
        let token_count = 0;
        {
            const enc = this.modules.tiktoken.encoding_for_model(model);
            const text = JSON.stringify(messages)
            const tokens = enc.encode(text);
            token_count += tokens.length;
        }

        // Subtract image urls
        for ( const msg of messages ) {
            // console.log('msg and content', msg, msg.content);
            if ( ! msg.content ) continue;
            if ( typeof msg.content !== 'object' ) continue;

            const content = SmolUtil.ensure_array(msg.content);

            for ( const o of content ) {
                // console.log('part of content', o);
                if ( o.type !== 'image_url' ) continue;
                const enc = this.modules.tiktoken.encoding_for_model(model);
                const text = o.image_url?.url ?? '';
                const tokens = enc.encode(text);
                token_count -= tokens.length;
            }
        }

        const max_tokens = 4096 - token_count;
        console.log('MAX TOKENS ???', max_tokens);

        if ( max_tokens <= 8 ) {
            throw APIError.create('max_tokens_exceeded', null, {
                input_tokens: token_count,
                max_tokens: 4096 - 8,
            });
        }

        const completion = await this.openai.chat.completions.create({
            user: user_private_uid,
            messages: messages,
            model: model,
            max_tokens,
            stream,
        });
        
        if ( stream ) {
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


        this.log.info('how many choices?: ' + completion.choices.length);

        // Record spending information
        const spending_meta = {};
        spending_meta.timestamp = Date.now();
        spending_meta.count_tokens_input = token_count;
        spending_meta.count_tokens_output = (() => {
            // count output tokens (overestimate)
            const enc = this.modules.tiktoken.encoding_for_model(model);
            const text = JSON.stringify(completion.choices);
            const tokens = enc.encode(text);
            return tokens.length;
        })();

        const svc_spending = Context.get('services').get('spending');
        svc_spending.record_spending('openai', 'chat-completion', spending_meta);

        const svc_counting = Context.get('services').get('counting');
        svc_counting.increment({
            service_name: 'openai:chat-completion',
            service_type: 'gpt',
            values: {
                model,
                input_tokens: token_count,
                output_tokens: spending_meta.count_tokens_output,
            }
        });

        const is_empty = completion.choices?.[0]?.message?.content?.trim() === '';
        if ( is_empty ) {
            // GPT refuses to generate an empty response if you ask it to,
            // so this will probably only happen on an error condition.
            throw new Error('an empty response was generated');
        }

        // We need to moderate the completion too
        if ( moderation ) {
            const text = completion.choices[0].message.content;
            const moderation_result = await this.check_moderation(text);
            if ( moderation_result.flagged ) {
                throw new Error('message is not allowed');
            }
        }
        
        return completion.choices[0];
    }
}

module.exports = {
    OpenAICompletionService,
};
