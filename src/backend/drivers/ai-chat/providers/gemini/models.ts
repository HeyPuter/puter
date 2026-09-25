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

// Hardcoded from https://models.dev/api.json
export const GEMINI_MODELS: IChatModel[] = [
    {
        puterId: 'google:google/gemini-3.5-flash',
        id: 'gemini-3.5-flash',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-05-19',
        name: 'Gemini 3.5 Flash',
        aliases: [
            'google/gemini-3.5-flash',
            // Rolling alias; Gemini API changelog (2026-05-19): gemini-3.5-flash
            // "Now backs `gemini-flash-latest`". Hot-swapped by Google on new
            // releases; no later switch documented as of 2026-08-28.
            'gemini-flash-latest',
            'google/gemini-flash-latest',
        ],
        context: 1_048_576,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 150,
            completion_tokens: 900,
            thinking_tokens: 900,
            cached_tokens: 15,
            // Gemini 3.x grounding is $14 / 1,000 requests
            grounding_requests: 1_400_000,
        },
    },
    {
        puterId: 'google:google/gemini-3.5-flash-lite',
        id: 'gemini-3.5-flash-lite',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-07-21',
        name: 'Gemini 3.5 Flash-Lite',
        aliases: [
            'google/gemini-3.5-flash-lite',
            // Rolling alias that floats across Flash-Lite releases; pinned here
            // to the newest Flash-Lite in this catalog (GA 2026-07-21).
            'gemini-flash-lite-latest',
            'google/gemini-flash-lite-latest',
        ],
        context: 1_048_576,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30,
            completion_tokens: 250,
            thinking_tokens: 250,
            cached_tokens: 3,
            grounding_requests: 1_400_000,
        },
    },
    {
        puterId: 'google:google/gemini-3.6-flash',
        id: 'gemini-3.6-flash',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-07-21',
        name: 'Gemini 3.6 Flash',
        aliases: ['google/gemini-3.6-flash'],
        context: 1_048_576,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 150,
            completion_tokens: 750,
            thinking_tokens: 750,
            cached_tokens: 15,
            grounding_requests: 1_400_000,
        },
    },
    {
        puterId: 'google:google/gemini-3.7-flash',
        id: 'gemini-3.7-flash',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2026-03',
        release_date: '2026-08-13',
        name: 'Gemini 3.7 Flash',
        aliases: ['google/gemini-3.7-flash'],
        context: 1_048_576,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 75,
            completion_tokens: 375,
            thinking_tokens: 375,
            cached_tokens: 7.5,
            grounding_requests: 1_400_000,
        },
    },
    {
        puterId: 'google:google/gemini-3.8-flash',
        id: 'gemini-3.8-flash',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        release_date: '2026-09-02',
        name: 'Gemini 3.8 Flash',
        aliases: ['google/gemini-3.8-flash'],
        context: 1_048_576,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        // Launch pricing, listed as holding through 2026-12-31 and doubling
        // on 2027-01-01.
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 75,
            completion_tokens: 375,
            thinking_tokens: 375,
            cached_tokens: 7.5,
            grounding_requests: 1_400_000,
        },
    },
    {
        puterId: 'google:google/gemini-2.5-flash',
        id: 'gemini-2.5-flash',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2025-03-20',
        name: 'Gemini 2.5 Flash',
        aliases: ['google/gemini-2.5-flash'],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30,
            // Output is $2.50/M; thinking tokens bill at the same output rate
            completion_tokens: 250,
            thinking_tokens: 250,
            // Cache read is $0.03/M (10% of input)
            cached_tokens: 3,
            // Gemini 2.x grounding is $35 / 1,000 requests
            grounding_requests: 3_500_000,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'google:google/gemini-2.5-flash-lite',
        id: 'gemini-2.5-flash-lite',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2025-06-17',
        name: 'Gemini 2.5 Flash-Lite',
        aliases: ['google/gemini-2.5-flash-lite'],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 10,
            completion_tokens: 40,
            thinking_tokens: 40,
            cached_tokens: 1,
            // Gemini 2.x grounding is $35 / 1,000 requests
            grounding_requests: 3_500_000,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'google:google/gemini-2.5-pro',
        id: 'gemini-2.5-pro',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2025-03-20',
        name: 'Gemini 2.5 Pro',
        aliases: ['google/gemini-2.5-pro'],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125,
            completion_tokens: 1000,
            thinking_tokens: 1000,
            cached_tokens: 31,
            // Gemini 2.x grounding is $35 / 1,000 requests
            grounding_requests: 3_500_000,
        },
        max_tokens: 200_000,
    },
    {
        puterId: 'google:google/gemini-3.1-pro-preview',
        id: 'gemini-3.1-pro-preview',
        modalities: {
            input: ['text', 'image', 'video', 'audio', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-02-19',
        name: 'Gemini 3.1 Pro Preview',
        aliases: [
            'google/gemini-3.1-pro-preview',
            // Rolling alias that floats across Pro releases; pinned here to the
            // newest Pro in this catalog (Google last documented it switching to
            // gemini-3-pro-preview on 2026-01-21, superseded by 3.1 on 2026-02-19).
            'gemini-pro-latest',
            'google/gemini-pro-latest',
        ],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 200,
            completion_tokens: 1200,
            thinking_tokens: 1200,
            cached_tokens: 20,
            grounding_requests: 1_400_000,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'google:google/gemini-3-flash-preview',
        id: 'gemini-3-flash-preview',
        modalities: {
            input: ['text', 'image', 'video', 'audio', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2025-12-17',
        name: 'Gemini 3 Flash',
        aliases: ['google/gemini-3-flash-preview'],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 50,
            completion_tokens: 300,
            thinking_tokens: 300,
            cached_tokens: 5,
            grounding_requests: 1_400_000,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'google:google/gemini-3.1-flash-lite',
        id: 'gemini-3.1-flash-lite',
        modalities: {
            input: ['text', 'image', 'video', 'audio', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-03-18',
        name: 'Gemini 3.1 Flash-Lite',
        aliases: [
            'google/gemini-3.1-flash-lite',
            'gemini-3.1-flash-lite-preview',
            'google/gemini-3.1-flash-lite-preview',
        ],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 25,
            completion_tokens: 150,
            thinking_tokens: 150,
            cached_tokens: 2.5,
            grounding_requests: 1_400_000,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'google:google/gemma-4-31b-it',
        id: 'gemma-4-31b-it',
        modalities: {
            input: ['text', 'image'],
            output: ['text'],
        },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-04-02',
        name: 'Gemma 4 31B',
        aliases: ['google/gemma-4-31b-it'],
        context: 262_144,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        // Gemma 4 on the Gemini API is free of charge (free tier only; the
        // official pricing page lists no paid tier for Gemma models).
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 0,
            completion_tokens: 0,
            thinking_tokens: 0,
            cached_tokens: 0,
        },
        max_tokens: 8_192,
    },
    {
        puterId: 'google:google/gemma-4-26b-a4b-it',
        id: 'gemma-4-26b-a4b-it',
        modalities: {
            input: ['text', 'image'],
            output: ['text'],
        },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-04-02',
        name: 'Gemma 4 26B A4B',
        aliases: ['google/gemma-4-26b-a4b-it'],
        context: 262_144,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        // Gemma 4 on the Gemini API is free of charge (free tier only; the
        // official pricing page lists no paid tier for Gemma models).
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 0,
            completion_tokens: 0,
            thinking_tokens: 0,
            cached_tokens: 0,
        },
        max_tokens: 8_192,
    },
];
