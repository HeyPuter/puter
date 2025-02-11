const BaseService = require("../../services/BaseService");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GeminiSquareHole = require("./lib/GeminiSquareHole");

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

            async complete ({ messages, stream, model, tools }) {
                const genAI = new GoogleGenerativeAI(this.config.apiKey);
                const genModel = genAI.getGenerativeModel({
                    model: model ?? 'gemini-2.0-flash',
                });

                messages = await GeminiSquareHole.process_input_messages(messages);

                // History is separate, so the last message gets special treatment.
                const last_message = messages.pop();
                console.log('last message?', last_message)
                const last_message_parts = last_message.parts.map(
                    part => typeof part === 'string' ? part : part.text
                );

                const chat = genModel.startChat({
                    history: messages,
                });
                
                const genResult = await chat.sendMessage(last_message_parts)

                debugger;
                const message = genResult.response.candidates[0];
                message.content = message.content.parts;
                message.role = 'assistant';

                const result = { message };
                return result;
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
        ];
    }
}

module.exports = { GeminiService };