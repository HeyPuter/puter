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

export const MOONSHOT_MODELS: IChatModel[] = [
    // ── Flagship ────────────────────────────────────────────────────
    {
        puterId: 'moonshot:moonshot/kimi-k2.6',
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        aliases: ['moonshot/kimi-k2.6', 'kimi-k26', 'kimi'],
        modalities: { input: ['text'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 95, // $0.95 per 1M
            completion_tokens: 400, // $4.00 per 1M
            cached_tokens: 16, // $0.16 per 1M
        },
        context: 262_144,
        max_tokens: 262_144,
        tool_call: true,
        knowledge: '2025-01',
    },

    // ── Kimi K2.5 ──────────────────────────────────────────────────
    {
        puterId: 'moonshot:moonshot/kimi-k2.5',
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        aliases: ['moonshot/kimi-k2.5', 'kimi-k25'],
        modalities: { input: ['text', 'image', 'video'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 60, // $0.60 per 1M
            completion_tokens: 300, // $3.00 per 1M
            cached_tokens: 10, // $0.10 per 1M
        },
        context: 262_144,
        max_tokens: 262_144,
        tool_call: true,
        knowledge: '2025-01',
    },

    // ── Moonshot V1 (Legacy) ───────────────────────────────────────
    {
        puterId: 'moonshot:moonshot/moonshot-v1-8k',
        id: 'moonshot-v1-8k',
        name: 'Moonshot V1 8K',
        aliases: ['moonshot/moonshot-v1-8k'],
        modalities: { input: ['text'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 20, // $0.20 per 1M
            completion_tokens: 200, // $2.00 per 1M
            cached_tokens: 0,
        },
        context: 8_192,
        max_tokens: 8_192,
        tool_call: true,
    },
    {
        puterId: 'moonshot:moonshot/moonshot-v1-32k',
        id: 'moonshot-v1-32k',
        name: 'Moonshot V1 32K',
        aliases: ['moonshot/moonshot-v1-32k'],
        modalities: { input: ['text'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 100, // $1.00 per 1M
            completion_tokens: 300, // $3.00 per 1M
            cached_tokens: 0,
        },
        context: 32_768,
        max_tokens: 32_768,
        tool_call: true,
    },
    {
        puterId: 'moonshot:moonshot/moonshot-v1-128k',
        id: 'moonshot-v1-128k',
        name: 'Moonshot V1 128K',
        aliases: ['moonshot/moonshot-v1-128k'],
        modalities: { input: ['text'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 200, // $2.00 per 1M
            completion_tokens: 500, // $5.00 per 1M
            cached_tokens: 0,
        },
        context: 131_072,
        max_tokens: 131_072,
        tool_call: true,
    },
    {
        puterId: 'moonshot:moonshot/moonshot-v1-auto',
        id: 'moonshot-v1-auto',
        name: 'Moonshot V1 Auto',
        aliases: ['moonshot/moonshot-v1-auto'],
        modalities: { input: ['text'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 100, // varies; use 32k pricing as middle ground
            completion_tokens: 300,
            cached_tokens: 0,
        },
        context: 131_072,
        max_tokens: 131_072,
        tool_call: true,
    },
    {
        puterId: 'moonshot:moonshot/moonshot-v1-8k-vision-preview',
        id: 'moonshot-v1-8k-vision-preview',
        name: 'Moonshot V1 8K Vision',
        aliases: ['moonshot/moonshot-v1-8k-vision-preview'],
        modalities: { input: ['text', 'image'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 20, // $0.20 per 1M
            completion_tokens: 200, // $2.00 per 1M
            cached_tokens: 0,
        },
        context: 8_192,
        max_tokens: 8_192,
        tool_call: true,
    },
    {
        puterId: 'moonshot:moonshot/moonshot-v1-32k-vision-preview',
        id: 'moonshot-v1-32k-vision-preview',
        name: 'Moonshot V1 32K Vision',
        aliases: ['moonshot/moonshot-v1-32k-vision-preview'],
        modalities: { input: ['text', 'image'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 100, // $1.00 per 1M
            completion_tokens: 300, // $3.00 per 1M
            cached_tokens: 0,
        },
        context: 32_768,
        max_tokens: 32_768,
        tool_call: true,
    },
    {
        puterId: 'moonshot:moonshot/moonshot-v1-128k-vision-preview',
        id: 'moonshot-v1-128k-vision-preview',
        name: 'Moonshot V1 128K Vision',
        aliases: ['moonshot/moonshot-v1-128k-vision-preview'],
        modalities: { input: ['text', 'image'], output: ['text'] },
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 200, // $2.00 per 1M
            completion_tokens: 500, // $5.00 per 1M
            cached_tokens: 0,
        },
        context: 131_072,
        max_tokens: 131_072,
        tool_call: true,
    },
];
