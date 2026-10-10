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

import type { IChatModel } from '../../types.js';
import { OPEN_AI_MODELS } from '../openai/models.js';
import { XAI_MODELS } from '../xai/models.js';

/**
 * An Azure deployment of a model we also serve direct. Every field but the
 * identity comes from the source entry, so prices, long-context tiers and
 * limits can't drift from it. `name` is the vendor-qualified name both catalogs
 * share (`openai/gpt-5.4`); extra fields override the source.
 */
const mirror = (
    source: readonly IChatModel[],
    name: string,
    azure: { id: string } & Partial<IChatModel>,
): IChatModel => {
    const model = source.find((m) => m.puterId?.endsWith(`:${name}`));
    if (!model) {
        throw new Error(`Azure model ${name} has no source entry to mirror`);
    }
    const { id: _id, puterId: _puterId, aliases: _aliases, ...shared } = model;
    return {
        puterId: `azure:${name}`,
        id: azure.id,
        ...shared,
        aliases: [name],
        ...azure,
    };
};

// Models served through our Azure AI Foundry deployment. This is NOT just
// OpenAI — Azure AI also fronts xAI's Grok models — so the list lives in its
// own provider folder rather than sharing the OpenAI list.
//
// IMPORTANT: we bill users at the public list price of the equivalent OpenAI /
// xAI model, which `mirror` copies from `../openai/models.ts` and
// `../xai/models.ts`. Azure is subsidised for us, so our actual spend is lower
// — but billing at the standard model price is the whole reason we route
// through Azure. Do NOT replace these with Azure's own rates.
//
// `id` is the Azure deployment name and is what we send upstream.
export const AZURE_MODELS: IChatModel[] = [
    // -- xAI Grok (via Azure AI Foundry) -----------------------------------
    {
        // Not in the direct xAI catalog any more; last xAI list price.
        puterId: 'azure:x-ai/grok-4-1-fast-non-reasoning',
        id: 'grok-4-1-fast-non-reasoning',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-07',
        release_date: '2025-11-19',
        name: 'Grok 4.1 Fast (Non-Reasoning)',
        aliases: ['x-ai/grok-4-1-fast-non-reasoning'],
        context: 2_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 20,
            completion_tokens: 50,
            cached_tokens: 5,
        },
        max_tokens: 2_000_000,
    },
    {
        // Not in the direct xAI catalog any more; last xAI list price.
        puterId: 'azure:x-ai/grok-4-1-fast-reasoning',
        id: 'grok-4-1-fast-reasoning',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-07',
        release_date: '2025-11-19',
        name: 'Grok 4.1 Fast (Reasoning)',
        aliases: ['x-ai/grok-4-1-fast-reasoning'],
        context: 2_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 20,
            completion_tokens: 50,
            cached_tokens: 5,
        },
        max_tokens: 2_000_000,
    },
    mirror(XAI_MODELS, 'x-ai/grok-4.3', { id: 'grok-4.3' }),
    mirror(XAI_MODELS, 'x-ai/grok-4-20-non-reasoning', {
        id: 'grok-4-20-non-reasoning',
    }),
    mirror(XAI_MODELS, 'x-ai/grok-4-20-reasoning', {
        id: 'grok-4-20-reasoning',
    }),

    // -- OpenAI (via Azure AI Foundry) -------------------------------------
    {
        // Not in the direct OpenAI catalog any more; last OpenAI list price.
        puterId: 'azure:openai/gpt-5',
        id: 'gpt-5',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-09-30',
        release_date: '2025-08-07',
        aliases: ['openai/gpt-5'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125,
            cached_tokens: 13,
            completion_tokens: 1000,
        },
        context: 128_000,
        max_tokens: 128000,
    },
    {
        // Not in the direct OpenAI catalog any more; last OpenAI list price.
        puterId: 'azure:openai/gpt-5-nano',
        id: 'gpt-5-nano',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-05-30',
        release_date: '2025-08-07',
        aliases: ['openai/gpt-5-nano'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 5,
            cached_tokens: 1,
            completion_tokens: 40,
        },
        context: 128_000,
        max_tokens: 128000,
    },
    {
        // Not in the direct OpenAI catalog any more; last OpenAI list price.
        puterId: 'azure:openai/gpt-5-mini',
        id: 'gpt-5-mini',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-05-30',
        release_date: '2025-08-07',
        aliases: ['openai/gpt-5-mini'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 25,
            cached_tokens: 3,
            completion_tokens: 200,
        },
        context: 128_000,
        max_tokens: 128000,
    },
    mirror(OPEN_AI_MODELS, 'openai/gpt-4o', { id: 'gpt-4o' }),
    mirror(OPEN_AI_MODELS, 'openai/gpt-5.1', { id: 'gpt-5.1' }),
    mirror(OPEN_AI_MODELS, 'openai/gpt-5.2', { id: 'gpt-5.2' }),
    mirror(OPEN_AI_MODELS, 'openai/gpt-5.4-nano', { id: 'gpt-5.4-nano' }),
    mirror(OPEN_AI_MODELS, 'openai/gpt-5.4-mini', { id: 'gpt-5.4-mini' }),
    mirror(OPEN_AI_MODELS, 'openai/gpt-5.3-codex', { id: 'gpt-5.3-codex' }),
    mirror(OPEN_AI_MODELS, 'openai/gpt-5.4', { id: 'gpt-5.4' }),
];
