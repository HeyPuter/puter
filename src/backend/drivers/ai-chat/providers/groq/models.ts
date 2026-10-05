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

// Hardcoded from https://models.dev/api.json (Groq chat/text models)
export const GROQ_MODELS: IChatModel[] = [
    {
        puterId: 'groq:openai/gpt-oss-120b',
        id: 'openai/gpt-oss-120b',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        release_date: '2025-08-05',
        name: 'GPT OSS 120B',
        context: 131072,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 15,
            completion_tokens: 60,
            cached_tokens: 8,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'groq:openai/gpt-oss-20b',
        id: 'openai/gpt-oss-20b',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        release_date: '2025-08-05',
        name: 'GPT OSS 20B',
        context: 131072,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 7.5,
            completion_tokens: 30,
            cached_tokens: 3.75,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'groq:openai/gpt-oss-safeguard-20b',
        id: 'openai/gpt-oss-safeguard-20b',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        release_date: '2025-10-29',
        name: 'GPT OSS Safeguard 20B',
        context: 131072,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 7.5,
            completion_tokens: 30,
            cached_tokens: 0,
        },
        max_tokens: 65536,
    },
    {
        puterId: 'groq:qwen/qwen3.8-27b',
        id: 'qwen/qwen3.8-27b',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        release_date: '2026-08-14',
        name: 'Qwen3.8 27B',
        context: 131072,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 80,
            completion_tokens: 400,
            cached_tokens: 0,
        },
        max_tokens: 16384,
    },
    {
        puterId: 'groq:meta-llama/llama-prompt-guard-2-22m',
        id: 'meta-llama/llama-prompt-guard-2-22m',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: false,
        release_date: '2025-05-29',
        name: 'Llama Prompt Guard 2 22M',
        context: 512,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 3,
            completion_tokens: 3,
            cached_tokens: 0,
        },
        max_tokens: 512,
    },
    {
        puterId: 'groq:meta-llama/llama-prompt-guard-2-86m',
        id: 'meta-llama/llama-prompt-guard-2-86m',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: false,
        release_date: '2025-05-29',
        name: 'Llama Prompt Guard 2 86M',
        context: 512,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 4,
            completion_tokens: 4,
            cached_tokens: 0,
        },
        max_tokens: 512,
    },
    {
        puterId: 'groq:allam-2-7b',
        id: 'allam-2-7b',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: false,
        release_date: '2025-01-23',
        name: 'ALLaM 2 7B',
        context: 4096,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
        },
        max_tokens: 4096,
    },
];
