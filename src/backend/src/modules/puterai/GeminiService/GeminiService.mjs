// Preamble: Before this we used Gemini's SDK directly and as we found out
// its actually kind of terrible. So we use the openai sdk now
import BaseService from '../../../services/BaseService.js';
import openai from 'openai';
import OpenAIUtil from '../lib/OpenAIUtil.js';
import { Context } from '../../../util/context.js';
import { models } from './models.mjs';


export class GeminiService extends BaseService {
    /**
    * @type {import('../../services/MeteringService/MeteringService').MeteringService}
    */
    meteringService = undefined;

    defaultModel = 'gemini-2.5-flash';

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async models () {
                return await this.models();
            },
            async complete (...args) {
                return await this.complete(...args);
            },
            async list () {
                return await this.list();
            },
        },
    };

    async _init () {
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

    get_default_model () {
        return this.defaultModel;
    }

    async models () {
        return models;
    }
    async list () {
        const model_names = [];
        for ( const model of models ) {
            model_names.push(model.id);
            if ( model.aliases ) {
                model_names.push(...model.aliases);
            }
        }
        return model_names;
    }
    async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
        const actor = Context.get('actor');
        messages = await OpenAIUtil.process_input_messages(messages);

        // delete cache_control
        messages = messages.map(m => {
            delete m.cache_control;
            return m;
        });

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
            console.error('Gemini completion error: ', e);
            throw e;
        }
        
        const modelDetails =  (await this.models()).find(m => m.id === model);
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
