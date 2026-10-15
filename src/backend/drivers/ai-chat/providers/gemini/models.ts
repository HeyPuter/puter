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

import type {
    IChatModel,
    ModelCost,
    ModelPricingOverride,
    ReasoningEffort,
} from '../../types.js';

/** What a natively served model accepts beyond the shared request fields. */
export interface GeminiNativeOptions {
    reasoningEfforts: ReadonlySet<ReasoningEffort>;
    /** False where Google ignores temperature, so it isn't sent. */
    temperature: boolean;
}

const FLASH_NATIVE_OPTIONS: GeminiNativeOptions = {
    reasoningEfforts: new Set(['minimal', 'low', 'medium', 'high']),
    temperature: true,
};

/**
 * Served natively: the OpenAI-compatible endpoint omits these models' thinking
 * count from usage.
 */
export const GEMINI_NATIVE_MODELS: ReadonlyMap<string, GeminiNativeOptions> =
    new Map([
        [
            'gemini-4-argon',
            {
                reasoningEfforts: new Set(['low', 'medium', 'high']),
                temperature: false,
            },
        ],
        ['gemini-3.1-flash-lite', FLASH_NATIVE_OPTIONS],
        ['gemini-3-flash-preview', FLASH_NATIVE_OPTIONS],
    ]);

const DOUBLED_RATES = [
    'prompt_tokens',
    'completion_tokens',
    'thinking_tokens',
    'cached_tokens',
] as const;

/** Launch pricing whose token rates all double to list pricing at `startsAt`. */
const listPricingFrom = (
    startsAt: string,
    launch: ModelCost,
): ModelPricingOverride[] => [
    {
        startsAt,
        costs: Object.fromEntries(
            DOUBLED_RATES.map((key) => [key, launch[key] * 2]),
        ),
    },
];

// Gemini 3.6/3.8 Flash launch pricing.
const FLASH_LAUNCH_COSTS: ModelCost = {
    tokens: 1_000_000,
    prompt_tokens: 75,
    completion_tokens: 375,
    thinking_tokens: 375,
    cached_tokens: 7.5,
    // Gemini 3.x grounding is $14 / 1,000 requests
    grounding_requests: 1_400_000,
};
const FLASH_LIST_PRICING = listPricingFrom(
    '2027-01-01T00:00:00Z',
    FLASH_LAUNCH_COSTS,
);

const ARGON_LAUNCH_COSTS: ModelCost = {
    tokens: 1_000_000,
    prompt_tokens: 200,
    completion_tokens: 1000,
    thinking_tokens: 1000,
    cached_tokens: 10,
};

const ROBOTICS_LAUNCH_COSTS: ModelCost = {
    tokens: 1_000_000,
    prompt_tokens: 100,
    completion_tokens: 500,
    thinking_tokens: 500,
    cached_tokens: 10,
    grounding_requests: 1_400_000,
};

// Every rate rises for the whole request once the prompt, cached tokens
// included, exceeds 200,000 tokens.
const PRO_LONG_CONTEXT_PRICING: ModelPricingOverride[] = [
    {
        minPromptTokens: 200_000,
        costs: {
            prompt_tokens: 400,
            completion_tokens: 1800,
            thinking_tokens: 1800,
            cached_tokens: 40,
        },
    },
];

// Google's unary model metadata reports this cap; streaming keeps the catalog cap.
export const GEMINI_ARGON_NON_STREAM_MAX_TOKENS = 32_768;

export const GEMINI_MODELS: IChatModel[] = [
    {
        puterId: 'google:google/gemini-4-argon',
        id: 'gemini-4-argon',
        // The native adapter forwards only text and image parts.
        modalities: {
            input: ['text', 'image'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        release_date: '2026-10-13',
        name: 'Gemini 4 Argon',
        aliases: ['google/gemini-4-argon'],
        // One window shared by input, thinking and output.
        context: 1_048_576,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: ARGON_LAUNCH_COSTS,
        pricingOverrides: listPricingFrom(
            '2026-12-01T00:00:00Z',
            ARGON_LAUNCH_COSTS,
        ),
    },
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
        // Google serves this endpoint with gemini-3.6-flash and bills its rates.
        costs: FLASH_LAUNCH_COSTS,
        pricingOverrides: FLASH_LIST_PRICING,
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
        costs: FLASH_LAUNCH_COSTS,
        pricingOverrides: FLASH_LIST_PRICING,
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
        // Google serves this endpoint with gemini-3.8-flash and bills its rates.
        costs: FLASH_LAUNCH_COSTS,
        pricingOverrides: FLASH_LIST_PRICING,
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
        costs: FLASH_LAUNCH_COSTS,
        pricingOverrides: FLASH_LIST_PRICING,
    },
    {
        puterId: 'google:google/gemini-3.1-flash-lite',
        id: 'gemini-3.1-flash-lite',
        // The native driver has no audio or PDF part to forward.
        modalities: {
            input: ['text', 'image'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        release_date: '2026-05-07',
        name: 'Gemini 3.1 Flash-Lite',
        aliases: ['google/gemini-3.1-flash-lite'],
        context: 1_048_576,
        max_tokens: 65_536,
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
    },
    {
        puterId: 'google:google/gemini-3-flash-preview',
        id: 'gemini-3-flash-preview',
        // The native driver has no audio or PDF part to forward.
        modalities: {
            input: ['text', 'image'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        release_date: '2025-12-17',
        name: 'Gemini 3 Flash Preview',
        aliases: ['google/gemini-3-flash-preview'],
        context: 1_048_576,
        max_tokens: 65_536,
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
        max_tokens: 65_536,
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
        pricingOverrides: PRO_LONG_CONTEXT_PRICING,
        max_tokens: 65536,
    },
    {
        // Separate endpoint of 3.1 Pro tuned to prioritize caller-defined
        // tools; an alias would route to the base model instead.
        puterId: 'google:google/gemini-3.1-pro-preview-customtools',
        id: 'gemini-3.1-pro-preview-customtools',
        modalities: {
            input: ['text', 'image', 'video', 'audio', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-02-19',
        name: 'Gemini 3.1 Pro Preview (Custom Tools)',
        aliases: ['google/gemini-3.1-pro-preview-customtools'],
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
        pricingOverrides: PRO_LONG_CONTEXT_PRICING,
        max_tokens: 65536,
    },
    {
        puterId: 'google:google/gemini-robotics-er-2-preview',
        id: 'gemini-robotics-er-2-preview',
        modalities: {
            input: ['text', 'image', 'audio', 'video'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-01',
        release_date: '2026-07-30',
        name: 'Gemini Robotics ER 2 Preview',
        aliases: ['google/gemini-robotics-er-2-preview'],
        context: 131_072,
        max_tokens: 65_536,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: ROBOTICS_LAUNCH_COSTS,
        pricingOverrides: listPricingFrom(
            '2027-01-01T00:00:00Z',
            ROBOTICS_LAUNCH_COSTS,
        ),
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
