const BaseService = require("../../services/BaseService");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GeminiSquareHole = require("./lib/GeminiSquareHole");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const putility = require("@heyputer/putility");
const FunctionCalling = require("./lib/FunctionCalling");

// Constants
const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TEMPERATURE = 0.7;

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
                for (const model of models) {
                    model_names.push(model.id);
                    if (model.aliases) {
                        model_names.push(...model.aliases);
                    }
                }
                return model_names;
            },

            /**
             * Handles chat completions (streaming and non-streaming).
             * @param {Object} params
             * @param {Array} params.messages
             * @param {boolean} params.stream
             * @param {string} params.model
             * @param {Array} params.tools
             * @param {number} params.max_tokens
             * @param {number} params.temperature
             */
            async complete (params) {
                try {
                    const {
                        messages,
                        stream,
                        model = DEFAULT_MODEL,
                        tools = [],
                        max_tokens,
                        temperature = DEFAULT_TEMPERATURE
                    } = params;

                    const processedTools = FunctionCalling.make_gemini_tools(tools);
                    const genModel = this.createGenerativeModel(model, processedTools, temperature, max_tokens);

                    const processedMessages = await GeminiSquareHole.process_input_messages(messages);
                    const lastMessageParts = this.extractLastMessageParts(processedMessages);
                    const chat = genModel.startChat({ history: processedMessages });

                    const usage_calculator = this.createUsageCalculator(model);

                    if (stream) {
                        return await this.handleStreamingResponse(chat, lastMessageParts, usage_calculator);
                    } else {
                        return await this.handleSingleResponse(chat, lastMessageParts, usage_calculator);
                    }
                } catch (error) {
                    this.logger?.error('GeminiService: Error in complete()', error);
                    throw error;
                }
            }
        }
    }

    createGenerativeModel(model, tools, temperature, max_tokens) {
        const genAI = new GoogleGenerativeAI(this.config.apiKey);
        return genAI.getGenerativeModel({
            model,
            tools,
            generationConfig: {
                temperature,
                maxOutputTokens: max_tokens
            }
        });
    }

    extractLastMessageParts(messages) {
        const last_message = messages.pop();
        return last_message.parts.map(part =>
            typeof part === 'string' ? part :
            typeof part.text === 'string' ? part.text :
            part
        );
    }

    createUsageCalculator(model_id) {
        return GeminiSquareHole.create_usage_calculator({
            model_details: this.models_().then(models => models.find(m => m.id === model_id)),
        });
    }

    async handleStreamingResponse(chat, lastMessageParts, usage_calculator) {
        const genResult = await chat.sendMessageStream(lastMessageParts);
        const responseStream = genResult.stream;

        const usage_promise = new putility.libs.promise.TeePromise();

        return new TypedValue({ $: 'ai-chat-intermediate' }, {
            stream: true,
            init_chat_stream: GeminiSquareHole.create_chat_stream_handler({
                stream: responseStream,
                usage_promise,
            }),
            usage_promise: usage_promise.then(usageMetadata => usage_calculator({ usageMetadata })),
        });
    }

    async handleSingleResponse(chat, lastMessageParts, usage_calculator) {
        const genResult = await chat.sendMessage(lastMessageParts);

        const message = genResult.response.candidates[0];
        message.content = message.content.parts;
        message.role = 'assistant';

        return {
            message,
            usage: await usage_calculator(genResult.response)
        };
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
                max_tokens: 8192,
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
                max_tokens: 8192,
            },
        ];
    }
}

module.exports = { GeminiService };