const { PassThrough } = require("stream");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { nou } = require("../../util/langutil");

class TogetherAIService extends BaseService {
    static MODULES = {
        ['together-ai']: require('together-ai'),
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
    }

    async _init () {
        const require = this.require;
        const Together = require('together-ai');
        this.together = new Together({
            apiKey: this.config.apiKey
        });
        this.kvkey = this.modules.uuidv4();
        debugger;
    }
    
    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async list () {
                let models = this.modules.kv.get(`${this.kvkey}:models`);
                if ( models ) return models;
                models = await this.together.models.list();
                this.modules.kv.set(
                    `${this.kvkey}:models`, models, { EX: 5*60 });
                return models;
            },
            async complete ({ messages, stream, model }) {
                console.log('model?', model);
                const completion = await this.together.chat.completions.create({
                    model: model ??
                        'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                    messages: messages,
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
    }
}

module.exports = {
    TogetherAIService,
};
