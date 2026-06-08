/**
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

// Models served through our Azure AI Foundry deployment. This is NOT just
// OpenAI — Azure AI also fronts xAI's Grok models — so the list lives in its
// own provider folder rather than sharing the OpenAI list.
//
// IMPORTANT: the `costs` below intentionally mirror the public list prices of
// the equivalent OpenAI / xAI models (see `../openai/models.ts` and
// `../xai/models.ts`). Azure is subsidised for us, so our actual spend is
// lower — but we bill users at the standard model price, which is the whole
// reason we route through Azure. Do NOT replace these with Azure's own rates.
//
// `id` is the Azure deployment name and is what we send upstream.
export const AZURE_MODELS: IChatModel[] = [
    // -- xAI Grok (via Azure AI Foundry) -----------------------------------
    {
        // Costs mirror xai grok-4-1-fast-non-reasoning.
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
        // Costs mirror xai grok-4-1-fast (alias grok-4-1-fast-reasoning).
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
    {
        // Costs mirror xai grok-4.3.
        puterId: 'azure:x-ai/grok-4.3',
        id: 'grok-4.3',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        release_date: '2026-05-01',
        name: 'Grok 4.3',
        aliases: ['x-ai/grok-4.3'],
        context: 1_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125,
            completion_tokens: 250,
            cached_tokens: 20,
        },
        max_tokens: 30_000,
    },
    {
        // Costs mirror xai grok-4.20 (grok-4.20-0309-non-reasoning).
        puterId: 'azure:x-ai/grok-4-20-non-reasoning',
        id: 'grok-4-20-non-reasoning',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-07',
        release_date: '2026-03-09',
        name: 'Grok 4.20 (Non-Reasoning)',
        aliases: ['x-ai/grok-4-20-non-reasoning'],
        context: 2_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125,
            completion_tokens: 250,
            cached_tokens: 20,
        },
        max_tokens: 30_000,
    },
    {
        // Costs mirror xai grok-4.20 (grok-4.20-0309-reasoning).
        puterId: 'azure:x-ai/grok-4-20-reasoning',
        id: 'grok-4-20-reasoning',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-07',
        release_date: '2026-03-09',
        name: 'Grok 4.20 (Reasoning)',
        aliases: ['x-ai/grok-4-20-reasoning'],
        context: 2_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125,
            completion_tokens: 250,
            cached_tokens: 20,
        },
        max_tokens: 30_000,
    },

    // -- OpenAI (via Azure AI Foundry) -------------------------------------
    {
        // Costs mirror openai gpt-5.
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
        // Costs mirror openai gpt-5-codex (same list price as gpt-5).
        puterId: 'azure:openai/gpt-5-codex',
        id: 'gpt-5-codex',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-09-30',
        release_date: '2025-08-07',
        aliases: ['openai/gpt-5-codex'],
        // Codex models are Responses-API only on Azure, same as OpenAI.
        responses_api_only: true,
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
        // Costs mirror openai gpt-5-nano.
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
        // Costs mirror openai gpt-5-mini.
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
    {
        // Costs mirror openai gpt-4o.
        puterId: 'azure:openai/gpt-4o',
        id: 'gpt-4o',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2023-09',
        release_date: '2024-05-13',
        aliases: ['openai/gpt-4o'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 250,
            cached_tokens: 125,
            completion_tokens: 1000,
        },
        context: 128_000,
        max_tokens: 16384,
    },
    {
        // Costs mirror openai gpt-5.1-codex-mini.
        puterId: 'azure:openai/gpt-5.1-codex-mini',
        id: 'gpt-5.1-codex-mini',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-09-30',
        release_date: '2025-11-13',
        aliases: ['openai/gpt-5.1-codex-mini'],
        responses_api_only: true,
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
    {
        // Costs mirror openai gpt-5.1.
        puterId: 'azure:openai/gpt-5.1',
        id: 'gpt-5.1',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-09-30',
        release_date: '2025-11-13',
        aliases: ['openai/gpt-5.1'],
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
        // Costs mirror openai gpt-5.1-codex.
        puterId: 'azure:openai/gpt-5.1-codex',
        id: 'gpt-5.1-codex',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-09-30',
        release_date: '2025-11-13',
        aliases: ['openai/gpt-5.1-codex'],
        responses_api_only: true,
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
        // Costs mirror openai gpt-5.2.
        puterId: 'azure:openai/gpt-5.2',
        id: 'gpt-5.2',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-08-31',
        release_date: '2025-12-11',
        aliases: ['openai/gpt-5.2'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 175,
            cached_tokens: 17.5,
            completion_tokens: 1400,
        },
        context: 128_000,
        max_tokens: 128000,
    },
    {
        // Costs mirror openai gpt-5.2-codex.
        puterId: 'azure:openai/gpt-5.2-codex',
        id: 'gpt-5.2-codex',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-08-31',
        release_date: '2025-12-11',
        aliases: ['openai/gpt-5.2-codex'],
        responses_api_only: true,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 175,
            cached_tokens: 18,
            completion_tokens: 1400,
        },
        context: 128_000,
        max_tokens: 128000,
    },
    {
        // Costs mirror openai gpt-5.4-nano.
        puterId: 'azure:openai/gpt-5.4-nano',
        id: 'gpt-5.4-nano',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-08-31',
        release_date: '2026-03-19',
        aliases: ['openai/gpt-5.4-nano'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 20,
            cached_tokens: 2,
            completion_tokens: 125,
        },
        context: 400_000,
        max_tokens: 128_000,
    },
    {
        // Costs mirror openai gpt-5.4-mini.
        puterId: 'azure:openai/gpt-5.4-mini',
        id: 'gpt-5.4-mini',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-08-31',
        aliases: ['openai/gpt-5.4-mini'],
        responses_api_only: true,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 75,
            cached_tokens: 7.5,
            completion_tokens: 450,
        },
        context: 400_000,
        max_tokens: 128_000,
    },
    {
        // Costs mirror openai gpt-5.3-codex.
        puterId: 'azure:openai/gpt-5.3-codex',
        id: 'gpt-5.3-codex',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-08-31',
        aliases: ['openai/gpt-5.3-codex'],
        responses_api_only: true,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 175,
            cached_tokens: 17.5,
            completion_tokens: 1400,
        },
        context: 128_000,
        max_tokens: 128000,
    },
    {
        // Costs mirror openai gpt-5.4.
        puterId: 'azure:openai/gpt-5.4',
        id: 'gpt-5.4',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-08-31',
        release_date: '2026-03-05',
        aliases: ['openai/gpt-5.4'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 250,
            cached_tokens: 25,
            completion_tokens: 1500,
        },
        context: 1_050_000,
        max_tokens: 1_050_000,
    },
];
