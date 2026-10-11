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

import axios from 'axios';
import { OpenAI } from 'openai';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatModel } from '../../types.js';
import { cachedRemoteCatalog } from '../../utils/cachedRemoteCatalog.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    OpenAICompatProvider,
    type UsageSource,
} from '../OpenAICompatProvider.js';

/** A local Ollama server's models, through its OpenAI-compatible API. */
export class OllamaChatProvider extends OpenAICompatProvider {
    #apiBaseUrl: string;

    constructor(
        config: { apiBaseUrl?: string } | undefined,
        meteringService: MeteringService,
    ) {
        // Ollama typically runs on HTTP, not HTTPS
        const apiBaseUrl = config?.apiBaseUrl || 'http://localhost:11434';
        super(meteringService, {
            client: new OpenAI({
                apiKey: 'ollama', // Ollama doesn't use an API key, it uses the "ollama" string
                baseURL: `${apiBaseUrl}/v1`,
                ...sdkClientOptions(),
            }),
            defaultModel: 'gpt-oss:20b',
            // Catalog ids are `ollama:ollama/<name>`; the server knows `<name>`.
            idPrefix: 'ollama:ollama/',
            passthrough: ['temperature'],
        });
        this.#apiBaseUrl = apiBaseUrl;
    }

    override async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    #catalog = cachedRemoteCatalog({
        name: 'Ollama catalog',
        fallback: [] as IChatModel[],
        fetch: (signal) => this.#fetchModels(signal),
    });

    async #fetchModels(signal: AbortSignal): Promise<IChatModel[]> {
        const resp = await axios.request({
            method: 'GET',
            url: `${this.#apiBaseUrl}/api/tags`,
            signal,
        });
        const models = resp.data.models || [];

        const coerced_models: IChatModel[] = [];
        for (const model of models) {
            // Ollama API returns models with 'name' property, not 'model'
            const modelName = model.name || model.model || 'unknown';
            coerced_models.push({
                id: `ollama:ollama/${modelName}`,
                name: `${modelName} (Ollama)`,
                max_tokens: model.size || model.max_context || 8192,
                costs_currency: 'usd-cents',
                costs: {
                    tokens: 1_000_000,
                    input_token: 0,
                    output_token: 0,
                },
            });
        }
        return coerced_models;
    }

    // Local inference is free.
    protected override meteredUsage(source: UsageSource) {
        const { usage } = source;
        return {
            usage: {
                prompt:
                    (usage.prompt_tokens ?? 1) -
                    (usage.prompt_tokens_details?.cached_tokens ?? 0),
                completion: usage.completion_tokens ?? 1,
                input_cache_read:
                    usage.prompt_tokens_details?.cached_tokens ?? 0,
            },
            meterOptions: {
                costOverrides: {
                    prompt: 0,
                    completion: 0,
                    input_cache_read: 0,
                },
            },
        };
    }
}
