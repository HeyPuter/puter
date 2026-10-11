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
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatModel } from '../../types.js';
import { cachedRemoteCatalog } from '../../utils/cachedRemoteCatalog.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';

export class TogetherAIProvider extends OpenAICompatProvider {
    #together: Together;

    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        // The SDK default timeout is one minute, which long non-streaming
        // completions exceed; match the ten minutes the other providers get.
        const together = new Together({
            apiKey: config.apiKey,
            ...(config.apiBaseUrl ? { baseURL: config.apiBaseUrl } : {}),
            ...sdkClientOptions(),
        });
        super(meteringService, {
            client: together,
            defaultModel: 'togetherai:meta-llama/Llama-3.3-70B-Instruct-Turbo',
            idPrefix: 'togetherai:',
            passthrough: ['temperature'],
            // Together rejects an overlarge max_tokens rather than truncating.
            retryOnContextLength: true,
        });
        this.#together = together;
    }

    override async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    #catalog = cachedRemoteCatalog({
        name: 'Together catalog',
        fallback: [] as IChatModel[],
        fetch: (signal) => this.#fetchModels(signal),
    });

    async #fetchModels(signal: AbortSignal): Promise<IChatModel[]> {
        const apiModels = await this.#together.models.list({
            query: { serverless: 'true' },
            signal,
        });
        const models: IChatModel[] = [];
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
                    // Together only reports a context length, so most of it
                    // stands in for an output limit. The driver also caps
                    // output at what the window leaves after an estimated
                    // prompt, which runs low on whitespace-poor prompts — the
                    // headroom keeps short prompts from overshooting it.
                    max_tokens: model.context_length
                        ? Math.floor(model.context_length * 0.95)
                        : 8000,
                });
            }
        }

        return models;
    }
}
