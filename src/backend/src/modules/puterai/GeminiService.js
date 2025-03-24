const BaseService = require("../../services/BaseService");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GeminiSquareHole = require("./lib/GeminiSquareHole");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const putility = require("@heyputer/putility");
const FunctionCalling = require("./lib/FunctionCalling");

class GeminiService extends BaseService {
    async _init () {
        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
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

            async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
                tools = FunctionCalling.make_gemini_tools(tools);

                const genAI = new GoogleGenerativeAI(this.config.apiKey);
                const genModel = genAI.getGenerativeModel({
                    model: model ?? 'gemini-2.0-flash',
                    tools,
                    generationConfig: {
                        temperature: temperature,                   // Set temperature (0.0 to 1.0). Defaults to 0.7
                        maxOutputTokens: max_tokens,       // Note: it's maxOutputTokens, not max_tokens
                      }
                });

                messages = await GeminiSquareHole.process_input_messages(messages);

                // History is separate, so the last message gets special treatment.
                const last_message = messages.pop();
                const last_message_parts = last_message.parts.map(
                    part => typeof part === 'string' ? part :
                            typeof part.text === 'string' ? part.text :
                            part
                );

                const chat = genModel.startChat({
                    history: messages,
                });
                
                const usage_calculator = GeminiSquareHole.create_usage_calculator({
                    model_details: (await this.models_()).find(m => m.id === model),
                });
                    
                if ( stream ) {
                    const genResult = await chat.sendMessageStream(last_message_parts)
                    const stream = genResult.stream;

                    const usage_promise = new putility.libs.promise.TeePromise();
                    return new TypedValue({ $: 'ai-chat-intermediate' }, {
                        stream: true,
                        init_chat_stream:
                            GeminiSquareHole.create_chat_stream_handler({
                                stream, usage_promise,
                            }),
                        usage_promise: usage_promise.then(usageMetadata => {
                            return usage_calculator({ usageMetadata });
                        }),
                    })
                } else {
                    const genResult = await chat.sendMessage(last_message_parts)

                    const message = genResult.response.candidates[0];
                    message.content = message.content.parts;
                    message.role = 'assistant';

                    const result = { message };
                    result.usage = usage_calculator(genResult.response);
                    return result;
                }
            }
        }
    }

    async models_ () {
        return [
            {
                id: 'gemini-1.5-flash',
                name: 'Gemini 1.5 Flash',
                context: 131072,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 7.5,
                    output: 30,
                },
            },
            {
                id: 'gemini-2.0-flash',
                name: 'Gemini 2.0 Flash',
                context: 131072,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 40,
                },
            },
        ];
    }
}

module.exports = { GeminiService };