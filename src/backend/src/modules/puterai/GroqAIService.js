const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");

class GroqAIService extends BaseService {
    static MODULES = {
        Groq: require('groq-sdk'),
    }

    async _init () {
        const Groq = require('groq-sdk');
        this.client = new Groq({
            apiKey: this.config.apiKey,
        });
    }
    
    static IMPLEMENTS = {
        'puter-chat-completion': {
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

                const completion = await this.client.chat.completions.create({
                    messages,
                    model,
                    stream,
                });

                if ( stream ) {
                    const stream = new PassThrough();
                    const retval = new TypedValue({
                        $: 'stream',
                        content_type: 'application/x-ndjson',
                        chunked: true,
                    }, stream);
                    (async () => {
                        for await ( const chunk of completion ) {
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
                
                return completion.choices[0];
            }
        }
    };
}

module.exports = {
    GroqAIService,
};
