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
export const DEEPSEEK_MODELS: IChatModel[] = [
    {
        puterId: 'deepseek:deepseek/deepseek-chat',
        id: 'deepseek-chat',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-07',
        release_date: '2024-12-26',
        name: 'DeepSeek Chat',
        aliases: ['deepseek/deepseek-chat'],
        context: 128000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 56,
            completion_tokens: 168,
            cached_tokens: 0,
        },
        max_tokens: 8000,
    },
    {
        puterId: 'deepseek:deepseek/deepseek-reasoner',
        id: 'deepseek-reasoner',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-07',
        release_date: '2025-01-20',
        name: 'DeepSeek Reasoner',
        aliases: ['deepseek/deepseek-reasoner'],
        context: 128000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 56,
            completion_tokens: 168,
            cached_tokens: 0,
        },
        max_tokens: 64000,
    },
];
