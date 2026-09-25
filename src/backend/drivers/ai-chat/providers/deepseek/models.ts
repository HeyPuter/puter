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
export const DEEPSEEK_MODELS: IChatModel[] = [
    {
        puterId: 'deepseek:deepseek/deepseek-v4-flash',
        id: 'deepseek-v4-flash',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2026-04',
        release_date: '2026-04-24',
        name: 'DeepSeek Chat',
        aliases: [
            'deepseek/deepseek-v4-flash',
            'deepseek-chat',
            'deepseek/deepseek-chat',
            'deepseek/deepseek-reasoner',
            'deepseek:deepseek/deepseek-reasoner',
            'deepseek:deepseek/deepseek-chat',
        ],
        context: 1_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 14,
            completion_tokens: 28,
            cached_tokens: 0.28,
        },
        max_tokens: 384_000,
    },
    {
        // Priced identically to deepseek-v4-flash per DeepSeek's launch note
        // (https://api-docs.deepseek.com/news/news260821/) and the pricing
        // page, which lists the same rates for both models; images are
        // tokenized (up to 384 tokens each) and billed as input tokens.
        puterId: 'deepseek:deepseek/deepseek-v4-flash-vision-exp',
        id: 'deepseek-v4-flash-vision-exp',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        release_date: '2026-08-21',
        name: 'DeepSeek V4 Flash Vision (Experimental)',
        aliases: ['deepseek/deepseek-v4-flash-vision-exp'],
        context: 1_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 14,
            completion_tokens: 28,
            cached_tokens: 0.28,
        },
        max_tokens: 384_000,
    },
    {
        puterId: 'deepseek:deepseek/deepseek-v4-pro',
        id: 'deepseek-v4-pro',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2026-04',
        release_date: '2026-04-24',
        name: 'DeepSeek Chat',
        aliases: ['deepseek/deepseek-v4-pro'],
        context: 1_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 174,
            completion_tokens: 348,
            cached_tokens: 1.45,
        },
        max_tokens: 384_000,
    },
];
