// Preamble: Before this we used Gemini's SDK directly and as we found out
// its actually kind of terrible. So we use the openai sdk now
import openai, { OpenAI } from 'openai';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { handle_completion_output, process_input_messages } from '../../../utils/OpenAIUtil.js';
import { IChatProvider, ICompleteArguments } from '../types.js';
import { GEMINI_MODELS } from './models.js';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';

export class GeminiChatProvider implements IChatProvider {

    meteringService: MeteringService;
    openai: OpenAI;

    defaultModel = 'gemini-2.5-flash';

    constructor ( meteringService: MeteringService, config: { apiKey: string })
    {
        this.meteringService = meteringService;
        this.openai = new openai.OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });
    }

    getDefaultModel () {
        return this.defaultModel;
    }

    async models () {
        return GEMINI_MODELS;
    }
    async list () {
        return (await this.models()).map(m => [m.id, ... (m.aliases || [])]).flat();
    }

    async complete ({ messages, stream, model, tools, max_tokens, temperature }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        messages = await process_input_messages(messages);

        // delete cache_control
        messages = messages.map(m => {
            delete m.cache_control;
            return m;
        });

        const modelUsed = (await this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (await this.models()).find(m => m.id === this.getDefaultModel())!;
        const sdk_params: ChatCompletionCreateParams = {
            messages: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        } as ChatCompletionCreateParams;

        let completion;
        try {
            completion = await this.openai.chat.completions.create(sdk_params);
        } catch (e) {
            console.error('Gemini completion error: ', e);
            throw e;
        }

        return handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };

                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));
                this.meteringService.utilRecordUsageObject(trackedUsage, actor, `gemini:${modelUsed?.id}`, costsOverrideFromModel);

                return trackedUsage;
            },
            stream,
            completion,
        });

    }

    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('No moderation logic.');
    }
}
