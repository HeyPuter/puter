/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Together } from 'together-ai';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { kv } from '../../../../util/kvSingleton.js';
import { IChatModel, IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import {
    contextLengthRetryParams,
    isContextLengthError,
} from '../../utils/contextLimit.js';
import { modelLookupNames } from '../../utils/modelRouting.js';

const TOGETHER_AI_CHAT_COST_MAP: Record<string, string> = {
    prompt_tokens: 'input',
    completion_tokens: 'output',
};

export class TogetherAIProvider implements IChatProvider {
    #together: Together;

    #meteringService: MeteringService;

    #kvKey = 'togetherai:models';

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        // The SDK default is one minute, which long non-streaming
        // completions exceed; match the ten minutes the other providers get.
        this.#together = new Together({
            apiKey: config.apiKey,
            timeout: 10 * 60 * 1000,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return 'togetherai:meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
    }

    async models() {
        let models: IChatModel[] | undefined = kv.get(this.#kvKey);
        if (models) return models;

        const apiModels = await this.#together.models.list({
            query: { serverless: 'true' },
        });
        models = [];
        for (const model of apiModels) {
            if (
                model.type === 'chat' ||
                model.type === 'code' ||
                model.type === 'language' ||
                model.type === 'moderation'
            ) {
                models.push({
                    id: `togetherai:${model.id}`,
                    aliases: [
                        model.id,
                        `togetherai/${model.id}`,
                        model.id.split('/').slice(1).join('/'),
                    ],
                    name: model.display_name,
                    context: model.context_length,
                    description: model.display_name,
                    costs_currency: 'usd-cents',
                    input_cost_key: 'input',
                    output_cost_key: 'output',
                    costs: {
                        tokens: 1_000_000,
                        ...Object.fromEntries(
                            Object.entries(model.pricing ?? {}).map(
                                ([k, v]) => [k, (v as number) * 100],
                            ),
                        ),
                    },
                    // Together only reports a context length. The driver caps
                    // output at max_tokens minus an estimated input count, which
                    // runs low on whitespace-poor prompts — reserve headroom so
                    // the cap doesn't overshoot the context as often.
                    max_tokens: model.context_length
                        ? Math.floor(model.context_length * 0.95)
                        : 8000,
                });
            }
        }

        kv.set(this.#kvKey, models, { EX: 15 * 60 });
        return models;
    }

    async list() {
        return modelLookupNames(await this.models());
    }

    async complete({
        messages,
        stream,
        model,
        tools,
        max_tokens,
        temperature,
    }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        const models = await this.models();
        const modelLower = model.toLowerCase();
        const modelUsed =
            models.find((m) =>
                [m.id, ...(m.aliases || [])].some(
                    (id) => id.toLowerCase() === modelLower,
                ),
            ) || models.find((m) => m.id === this.getDefaultModel())!;
        const modelIdForParams = modelUsed.id.startsWith('togetherai:')
            ? modelUsed.id.slice('togetherai:'.length)
            : modelUsed.id;

        messages = await OpenAIUtil.process_input_messages(messages);

        const completionParams = {
            model: modelIdForParams,
            messages,
            stream,
            ...(tools ? { tools } : {}),
            ...(max_tokens !== undefined ? { max_tokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(stream ? { stream_options: { include_usage: true } } : {}),
        } as Together.Chat.Completions.CompletionCreateParamsNonStreaming;

        let completion;
        try {
            completion =
                await this.#together.chat.completions.create(completionParams);
        } catch (e: unknown) {
            // Together rejects an overlarge max_tokens outright rather than
            // truncating. Retry under the room the window leaves, still
            // bounded by the cap the credit gate set.
            if (!isContextLengthError(e)) throw e;
            const retryParams = contextLengthRetryParams(completionParams, {
                error: e,
                contextWindow: modelUsed.context,
            });
            if (!retryParams) throw e;
            completion =
                await this.#together.chat.completions.create(retryParams);
        }

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(
                    Object.entries(trackedUsage).map(([k, v]) => {
                        const mappedKey = TOGETHER_AI_CHAT_COST_MAP[k] || k;
                        return [k, v * modelUsed.costs[mappedKey]];
                    }),
                );

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    `togetherai:${modelIdForParams}`,
                    costsOverride,
                );
                return trackedUsage;
            },
            stream,
            completion,
        });
    }

    checkModeration(_text: string) {
        throw new Error('Method not implemented.');
    }
}
