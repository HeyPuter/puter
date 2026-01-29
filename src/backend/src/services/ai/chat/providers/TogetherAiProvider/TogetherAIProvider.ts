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
import { Context } from '../../../../../util/context.js';
import { kv } from '../../../../../util/kvSingleton.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { IChatModel, IChatProvider, ICompleteArguments } from '../types.js';

const TOGETHER_AI_CHAT_COST_MAP = {
    prompt_tokens: 'input',
    completion_tokens: 'output',
};

export class TogetherAIProvider implements IChatProvider {
    #together: Together;

    #meteringService: MeteringService;

    #kvKey = 'togetherai:models';

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        this.#together = new Together({
            apiKey: config.apiKey,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel () {
        return 'togetherai:meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
    }

    async models () {
        let models: IChatModel[] | undefined = kv.get(this.#kvKey);
        if ( models ) return models;

        const apiModels = await this.#together.models.list();
        models = [];
        for ( const model of apiModels ) {
            if ( model.type === 'chat' || model.type === 'code' || model.type === 'language' || model.type === 'moderation' ) {
                models.push({
                    id: `togetherai:${model.id}`,
                    aliases: [model.id, `togetherai/${model.id}`, model.id.split('/').slice(1).join('/')],
                    name: model.display_name,
                    context: model.context_length,
                    description: model.display_name,
                    costs_currency: 'usd-cents',
                    input_cost_key: 'input',
                    output_cost_key: 'output',
                    costs: {
                        tokens: 1_000_000,
                        ...model.pricing,
                    },
                    max_tokens: model.context_length ?? 8000,
                });
            }
        }

        models.push({
            id: 'model-fallback-test-1',
            name: 'Model Fallback Test 1',
            context: 1000,
            costs_currency: 'usd-cents',
            input_cost_key: 'input',
            output_cost_key: 'output',
            costs: {
                tokens: 1_000_000,
                prompt_tokens: 10,
                completion_tokens: 10,
            },
            max_tokens: 1000,
        });
        kv.set(this.#kvKey, models, { EX: 5 * 60 });
        return models;
    }

    async list () {
        const models = await this.models();
        const modelIds: string[] = [];
        for ( const model of models ) {
            modelIds.push(model.id);
            if ( model.aliases ) {
                modelIds.push(...model.aliases);
            }
        }
        return modelIds;
    }

    async complete ({ messages, stream, model, tools, max_tokens, temperature }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        if ( model === 'model-fallback-test-1' ) {
            throw new Error('Model Fallback Test 1');
        }

        const actor = Context.get('actor');
        const models = await this.models();
        const modelUsed = models.find(m => [m.id, ...(m.aliases || [])].includes(model)) || models.find(m => m.id === this.getDefaultModel())!;
        const modelIdForParams = modelUsed.id.startsWith('togetherai:') ? modelUsed.id.slice('togetherai:'.length) : modelUsed.id;

        messages = await OpenAIUtil.process_input_messages(messages);

        const completion = await this.#together.chat.completions.create({
            model: modelIdForParams,
            messages,
            stream,
            ...(tools ? { tools } : {}),
            // TODO: make this better but togetherai doesn't handle max tokens properly at all
            ...(max_tokens ? { max_tokens: max_tokens - messages.reduce((acc, curr) => {
                return acc + (curr.type === 'text' ? curr.text.length / 2 : 200);
            }, 0) } : {}),
            ...(temperature ? { temperature } : {}),
            ...(stream ? { stream_options: { include_usage: true } } : {}),
        } as Together.Chat.Completions.CompletionCreateParamsNonStreaming);

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    const mappedKey  = TOGETHER_AI_CHAT_COST_MAP[k] || k;
                    return modelUsed.costs[mappedKey] ? [k, v * (modelUsed.costs[mappedKey] || 0)] : null;
                }).filter(Boolean) as [string, number][]);

                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `togetherai:${modelIdForParams}`, costsOverride);
                return trackedUsage;
            },
            stream,
            completion,
        });
    }

    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
