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

// Hardcoded from https://models.dev/api.json
export const GEMINI_MODELS: IChatModel[] = [
    {
        puterId: 'google:google/gemini-2.0-flash',
        id: 'gemini-2.0-flash',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-06',
        release_date: '2024-12-11',
        name: 'Gemini 2.0 Flash',
        aliases: ['google/gemini-2.0-flash'],
        context: 131072,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 10,
            completion_tokens: 40,
            cached_tokens: 3,
        },
        max_tokens: 8192,
    },
    {
        puterId: 'google:google/gemini-2.0-flash-lite',
        id: 'gemini-2.0-flash-lite',
        modalities: {
            input: ['text', 'image', 'audio', 'video', 'pdf'],
            output: ['text'],
        },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-06',
        release_date: '2024-12-11',
        name: 'Gemini 2.0 Flash-Lite',
        aliases: ['google/gemini-2.0-flash-lite'],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 8,
            completion_tokens: 30,
        },
        max_tokens: 8192,
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
            completion_tokens: 250,
            cached_tokens: 3,
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
            cached_tokens: 1,
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
            cached_tokens: 13,
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
        aliases: ['google/gemini-3.1-pro-preview'],
        context: 1_048_576,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 200,
            completion_tokens: 1200,
            cached_tokens: 20,
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
            cached_tokens: 5,
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
            cached_tokens: 2.5,
        },
        max_tokens: 65536,
    },
];
