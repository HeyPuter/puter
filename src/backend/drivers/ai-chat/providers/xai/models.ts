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

// Hardcoded from https://models.dev/api.json and live xAI /models
export const XAI_MODELS: IChatModel[] = [
    {
        puterId: 'x-ai:x-ai/grok-4.6',
        id: 'grok-4.6',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2026-02',
        release_date: '2026-08-12',
        name: 'Grok 4.6',
        aliases: ['x-ai/grok-4.6', 'grok-4.6-latest'],
        context: 500_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 200,
            completion_tokens: 600,
            cached_tokens: 50,
        },
        max_tokens: 500_000,
    },
    {
        puterId: 'x-ai:x-ai/grok-4.5',
        id: 'grok-4.5',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        release_date: '2026-07-08',
        name: 'Grok 4.5',
        aliases: ['x-ai/grok-4.5', 'grok-4.5-latest', 'grok-build-latest'],
        context: 500_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 200,
            completion_tokens: 600,
            cached_tokens: 30,
        },
        max_tokens: 500_000,
    },
    {
        puterId: 'x-ai:x-ai/grok-4.3',
        id: 'grok-4.3',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        release_date: '2026-05-01',
        name: 'Grok 4.3',
        aliases: ['x-ai/grok-4.3', 'grok-4.3-latest'],
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
        puterId: 'x-ai:x-ai/grok-4-20-reasoning',
        id: 'grok-4.20-0309-reasoning',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-07',
        release_date: '2026-03-09',
        name: 'Grok 4.20 (Reasoning)',
        aliases: [
            'x-ai/grok-4-20-reasoning',
            'grok-4-20-reasoning',
            'grok-4.20-reasoning',
            'grok-4.20',
            'grok-4.20-0309',
            'grok-4.20-reasoning-latest',
            'x-ai/grok-4.20-reasoning',
        ],
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
        puterId: 'x-ai:x-ai/grok-4-20-non-reasoning',
        id: 'grok-4.20-0309-non-reasoning',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2025-07',
        release_date: '2026-03-09',
        name: 'Grok 4.20 (Non-Reasoning)',
        aliases: [
            'x-ai/grok-4-20-non-reasoning',
            'grok-4-20-non-reasoning',
            'grok-4.20-non-reasoning',
            'grok-4.20-non-reasoning-latest',
            'x-ai/grok-4.20-non-reasoning',
        ],
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
        puterId: 'x-ai:x-ai/grok-4.20-multi-agent-0309',
        id: 'grok-4.20-multi-agent-0309',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: false,
        knowledge: '2025-07',
        release_date: '2026-03-09',
        name: 'Grok 4.20 Multi-Agent',
        aliases: [
            'x-ai/grok-4.20-multi-agent-0309',
            'grok-4.20-multi-agent',
            'grok-4.20-multi-agent-latest',
        ],
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
        puterId: 'x-ai:x-ai/grok-build-0.1',
        id: 'grok-build-0.1',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2023-10',
        release_date: '2026-04-16',
        name: 'Grok Build 0.1',
        aliases: [
            'x-ai/grok-build-0.1',
            'grok-code-fast-1',
            'grok-code-fast',
            'grok-code-fast-1-0825',
            'x-ai/grok-code-fast-1',
        ],
        context: 256_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 100,
            completion_tokens: 200,
            cached_tokens: 20,
        },
        max_tokens: 256_000,
    },
];
