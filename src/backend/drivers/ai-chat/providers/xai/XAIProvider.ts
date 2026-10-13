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

import { OpenAI } from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import type {
    IChatModel,
    IChatProvider,
    ICompleteArguments,
    IChatCompleteResult,
} from '../../types.js';
import { XAI_BASE_URL, XAI_CHAT_MODELS, fetchXaiCatalog } from './catalog.js';
import { cachedRemoteCatalog } from '../../utils/cachedRemoteCatalog.js';
import { meterChatUsage } from '../../utils/meterChatUsage.js';
import { modelLookupNames } from '../../utils/modelRouting.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';

export class XAIProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #catalog: () => Promise<IChatModel[]>;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: XAI_BASE_URL,
            ...sdkClientOptions(),
        });
        this.#meteringService = meteringService;
        this.#catalog = cachedRemoteCatalog({
            name: 'xAI catalog',
            fallback: XAI_CHAT_MODELS,
            fetch: (signal, previous) =>
                fetchXaiCatalog(config.apiKey, signal, previous),
        });
    }

    getDefaultModel() {
        return 'grok-4.5';
    }

    async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    async list() {
        return modelLookupNames(await this.models());
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string): string {
        return `xai:${modelId}`;
    }

    async complete(
        { messages, stream, model, tools, max_tokens }: ICompleteArguments,
        resolved?: IChatModel,
    ): Promise<IChatCompleteResult> {
        const actor = Context.get('actor');
        // The driver's snapshot is what its credit hold was priced against, so
        // a catalog refresh mid-request can't change what this call bills.
        const modelUsed = resolved ?? (await this.#resolveModel(model));
        messages = await OpenAIUtil.process_input_messages(messages);
        let completion;
        try {
            completion = await this.#openai.chat.completions.create(
                {
                    messages,
                    model: modelUsed.id,
                    ...(tools ? { tools } : {}),
                    ...(max_tokens !== undefined ? { max_tokens } : {}),
                    stream,
                    ...(stream
                        ? {
                              stream_options: { include_usage: true },
                          }
                        : {}),
                } as ChatCompletionCreateParams,
                { signal: Context.get('abortSignal') },
            );
        } catch (e) {
            if (!Context.get('abortSignal')?.aborted) {
                console.log('XAI AI process_input_messages error: ', e);
            }
            throw e;
        }

        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage, setUsageCosts }) => {
                // xAI reports cached reads inside `prompt_tokens`; bill them
                // only at the cached rate.
                const metered = OpenAIUtil.extractMeteredUsage(usage);
                const { costs } = meterChatUsage(
                    this.#meteringService,
                    actor,
                    this.meteringModelKey(modelUsed.id),
                    modelUsed,
                    OpenAIUtil.splitCachedPrompt(usage),
                );
                setUsageCosts(costs);
                return metered;
            },
            stream,
            completion,
        });
    }

    async #resolveModel(model: string): Promise<IChatModel> {
        const availableModels = await this.models();
        return (
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!
        );
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }
}
