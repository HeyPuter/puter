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

// Standard rates: https://docs.mistral.ai/inference/pricing
export const MISTRAL_MODELS: IChatModel[] = [
    {
        puterId: 'mistralai:mistralai/mistral-large-4',
        id: 'mistral-large-4',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        release_date: '2026-10-06',
        name: 'Mistral Large 4',
        aliases: [
            'mistral-large-4-0',
            'mistralai/mistral-large-4',
            'mistralai/mistral-large-4-0',
        ],
        context: 1_000_000,
        max_tokens: 1_000_000,
        description:
            'Public-preview multimodal model for reasoning, coding, and agentic workflows; open weights are forthcoming.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 136,
            cached_tokens: 14,
            completion_tokens: 418,
        },
    },
    {
        puterId: 'mistralai:mistralai/mistral-medium-2604',
        id: 'mistral-medium-2604',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2026-04',
        release_date: '2026-04-29',
        name: 'Mistral Medium 3.5',
        aliases: [
            'mistral-medium-3-5',
            'mistral-medium-3.5',
            'mistral-medium-3',
            'mistral-medium-latest',
            'mistral-medium',
            'mistralai/mistral-medium-3-5',
            'mistralai/mistral-medium-2604',
        ],
        context: 262_144,
        max_tokens: 262_144,
        description:
            'State-of-the-art multimodal model optimized for agentic and coding tasks.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 150,
            cached_tokens: 15,
            completion_tokens: 750,
        },
    },
    {
        puterId: 'mistralai:mistralai/mistral-large-2512',
        id: 'mistral-large-2512',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-12',
        release_date: '2025-12-02',
        name: 'Mistral Large 3',
        aliases: [
            'mistral-large-latest',
            'mistral-large',
            'mistralai/mistral-large-latest',
            'mistralai/mistral-large-2512',
        ],
        context: 262_144,
        max_tokens: 262_144,
        description:
            'State-of-the-art, open-weight, general-purpose multimodal model.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 50,
            cached_tokens: 5,
            completion_tokens: 150,
        },
    },
    {
        puterId: 'mistralai:mistralai/mistral-small-2603',
        id: 'mistral-small-2603',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-06',
        release_date: '2026-03-16',
        name: 'Mistral Small 4',
        aliases: [
            'mistral-small-latest',
            'mistral-small',
            'mistralai/mistral-small-latest',
            'mistralai/mistral-small-2603',
        ],
        context: 256_000,
        max_tokens: 256_000,
        description:
            'Hybrid open-weight model for instruct, reasoning, and coding tasks.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 15,
            cached_tokens: 1.5,
            completion_tokens: 60,
        },
    },
    {
        puterId: 'mistralai:mistralai/zai-glm-5-3',
        id: 'zai-glm-5-3',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        release_date: '2026-08-14',
        name: 'Z.ai GLM 5.3',
        aliases: ['zai-glm-5', 'zai-glm-latest'],
        context: 1_000_000,
        max_tokens: 131_072,
        description:
            'Third-party open-source model from Z.ai, hosted by Mistral for long-horizon coding and agentic workflows.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 140,
            cached_tokens: 14,
            completion_tokens: 440,
        },
    },
    {
        puterId: 'mistralai:mistralai/codestral-2508',
        id: 'codestral-2508',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-08',
        release_date: '2025-08-29',
        name: 'Codestral',
        aliases: [
            'codestral-latest',
            'mistral-code-latest',
            'mistralai/codestral-2508',
        ],
        context: 256_000,
        max_tokens: 256_000,
        description:
            'Cutting-edge language model for code completion, proficient in over 80 programming languages.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30,
            cached_tokens: 3,
            completion_tokens: 90,
        },
    },
    {
        puterId: 'mistralai:mistralai/ministral-14b-2512',
        id: 'ministral-14b-2512',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-12',
        release_date: '2025-12-16',
        name: 'Ministral 3 14B',
        aliases: ['ministral-14b-latest', 'mistralai/ministral-14b-2512'],
        context: 262_144,
        max_tokens: 262_144,
        description:
            'Best-in-class compact model with text and vision capabilities.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 20,
            cached_tokens: 2,
            completion_tokens: 20,
        },
    },
    {
        puterId: 'mistralai:mistralai/ministral-8b-2512',
        id: 'ministral-8b-2512',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-12',
        release_date: '2025-12-16',
        name: 'Ministral 3 8B',
        aliases: ['ministral-8b-latest', 'mistralai/ministral-8b-2512'],
        context: 262_144,
        max_tokens: 262_144,
        description:
            'Efficient compact model with text and vision capabilities.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 15,
            cached_tokens: 1.5,
            completion_tokens: 15,
        },
    },
    {
        puterId: 'mistralai:mistralai/ministral-3b-2512',
        id: 'ministral-3b-2512',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        knowledge: '2025-12',
        release_date: '2025-12-16',
        name: 'Ministral 3 3B',
        aliases: ['ministral-3b-latest', 'mistralai/ministral-3b-2512'],
        context: 131_072,
        max_tokens: 131_072,
        description: 'Tiny, efficient model with multimodal support.',
        provider: 'mistral',
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 10,
            cached_tokens: 1,
            completion_tokens: 10,
        },
    },
];
