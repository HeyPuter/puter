const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");

class MistralAIService extends BaseService {
    static MODULES = {
        '@mistralai/mistralai': require('@mistralai/mistralai'),
    }
    async _init () {
        const require = this.require;
        const { Mistral } = require('@mistralai/mistralai');
        this.client = new Mistral({
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
                        model: model ?? 'mistral-large-latest',
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

                try {
                    const completion = await this.client.chat.complete({
                        model: model ?? 'mistral-large-latest',
                        messages,
                    });
                    // Expected case when mistralai/client-ts#23 is fixed
                    return completion.choices[0];
                } catch (e) {
                    if ( ! e?.rawValue?.choices[0] ) {
                        throw e;
                    }
                    // The SDK attempts to validate APIs response and throws
                    // an exception, even if the response was successful
                    // https://github.com/mistralai/client-ts/issues/23
                    return e.rawValue.choices[0];
                }
            }
        }
    }
}

module.exports = { MistralAIService };
