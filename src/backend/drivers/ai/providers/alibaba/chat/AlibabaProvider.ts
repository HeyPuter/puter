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
import type { MeteringService } from '../../../../../services/metering/MeteringService.js';
import type { IChatModel } from '../../../interfaces/chat/types.js';
import { costsForRequest } from '../../../interfaces/chat/utils/pricing.js';
import { cachedRemoteCatalog } from '../../../shared/cachedRemoteCatalog.js';
import { fetchAlibabaCatalog } from './catalog.js';
import { sdkClientOptions } from '../../../interfaces/chat/utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
    type UsageSource,
} from '../../../protocols/openaiCompatible/OpenAICompatProvider.js';
import * as OpenAIUtil from '../../../protocols/openaiCompatible/OpenAIUtil.js';
import { ALIBABA_MODELS } from './models.js';

/** Model Studio bills a write to an explicit cache at 125% of the input rate. */
const CACHE_WRITE_RATE = 1.25;

export class AlibabaProvider extends OpenAICompatProvider {
    #apiBaseUrl: string;
    #apiKey: string;
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL:
                    config.apiBaseUrl ??
                    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
                ...sdkClientOptions(),
            }),
            requireTokenPrices: true,
            defaultModel: 'qwen-plus-latest',
            meteringPrefix: 'alibaba',
            defaultMaxTokens: 1000,
            passthrough: ['temperature'],
        });
        this.#apiBaseUrl = (
            config.apiBaseUrl ??
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
        )
            .replace(/\/(?:compatible-mode\/)?v1\/?$/, '')
            .replace(/\/$/, '');
        this.#apiKey = config.apiKey;
    }

    override async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    protected override meteredUsage(source: UsageSource, model: IChatModel) {
        const details = source.usage?.prompt_tokens_details as
            { cache_creation_input_tokens?: unknown } | undefined;
        const written = details?.cache_creation_input_tokens;
        if (typeof written !== 'number' || !(written > 0)) {
            return super.meteredUsage(source, model);
        }
        // Counted inside prompt_tokens, under Model Studio's own name.
        const usage = OpenAIUtil.splitCachedPrompt({
            ...source.usage,
            prompt_tokens_details: { ...details, cache_write_tokens: written },
        });
        // The input rate of the tier this prompt's length puts it on.
        const inputRate = costsForRequest(
            model,
            source.usage.prompt_tokens ?? 0,
        ).prompt_tokens;
        return {
            usage,
            ...(model.costs.cache_write_tokens === undefined &&
            Number.isFinite(inputRate)
                ? {
                      meterOptions: {
                          costOverrides: {
                              cache_write_tokens:
                                  written * inputRate * CACHE_WRITE_RATE,
                          },
                      },
                  }
                : {}),
        };
    }

    #catalog = cachedRemoteCatalog({
        name: 'Alibaba catalog',
        fallback: ALIBABA_MODELS,
        fetch: (signal, previous) =>
            fetchAlibabaCatalog(
                this.#apiBaseUrl,
                this.#apiKey,
                signal,
                previous,
            ),
    });
}
