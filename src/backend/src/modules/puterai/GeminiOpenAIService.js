// Preamble: Before this we used Gemini's SDK directly and as we found out
// its actually kind of terrible

const BaseService = require("../../services/BaseService");
const openai = require('openai');
const OpenAIUtil = require('./lib/OpenAIUtil');
const { Context } = require('../../util/context');

class GeminiRefactoredService extends BaseService {
    /**
    * @type {import('../../services/MeteringService/MeteringService').MeteringService}
    */
    meteringService = undefined;

    async _init() {
        this.openai = new openai.OpenAI({
            apiKey: this.config.apiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
        this.meteringService = this.services.get('meteringService').meteringService;
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async models() {
                return await this.models_();
            },
            async complete({ messages, stream, model, tools, max_tokens, temperature }) {
                const actor = Context.get('actor');
                messages = await OpenAIUtil.process_input_messages(messages);

                // delete cache_control
                messages = messages.map(m => {
                    delete m.cache_control;
                    return m;
                })

                const sdk_params = {
                    messages: messages,
                    model: model,
                    ...(tools ? { tools } : {}),
                    ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
                    ...(temperature ? { temperature } : {}),
                    stream,
                    ...(stream ? {
                        stream_options: { include_usage: true },
                    } : {}),
                };

                let completion;
                try {
                    completion = await this.openai.chat.completions.create(sdk_params);
                } catch (e) {
                    console.error("WOMP! Gemini Error", e)
                }

                const modelDetails =  (await this.models_()).find(m => m.id === model);
                return OpenAIUtil.handle_completion_output({
                    usage_calculator: ({ usage }) => {
                        const trackedUsage = {
                            prompt_tokens: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                            completion_tokens: usage.completion_tokens ?? 0,
                            cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                        };

                        this.meteringService.utilRecordUsageObject(trackedUsage, actor, `gemini:${modelDetails.id}`);
                        const legacyCostCalculator = OpenAIUtil.create_usage_calculator({
                            model_details: modelDetails,
                        });

                        return legacyCostCalculator({ usage });
                    },
                    stream,
                    completion,
                });

            }
        }
    }



    async models_() {
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
            {
                id: 'gemini-2.0-flash-lite',
                name: 'Gemini 2.0 Flash-Lite',
                context: 1_048_576,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 8,
                    output: 32,
                },
                max_tokens: 8192,
            },
            {
                id: 'gemini-2.5-flash',
                name: 'Gemini 2.5 Flash',
                context: 1_048_576,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 12,
                    output: 48,
                },
                max_tokens: 65536,
            },
            {
                id: 'gemini-2.5-flash-lite',
                name: 'Gemini 2.5 Flash-Lite',
                context: 1_048_576,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 10,
                    output: 40,
                },
                max_tokens: 65536,
            },
            {
                id: 'gemini-2.5-pro',
                name: 'Gemini 2.5 Pro',
                context: 1_048_576,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 15,
                    output: 60,
                },
                max_tokens: 65536,
            },
            {
                id: 'gemini-3-pro-preview',
                name: 'Gemini 3 Pro',
                context: 1_048_576,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 25,
                    output: 100,
                },
                max_tokens: 65536,
            },
        ];
    }
}

module.exports = {
    GeminiRefactoredService
}