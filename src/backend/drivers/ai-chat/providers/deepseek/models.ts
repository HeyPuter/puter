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
import { deepSeekPricing, type DeepSeekModelId } from './pricing.js';

const dynamicCosts = (modelId: DeepSeekModelId) => ({
    tokens: 1_000_000,
    get prompt_tokens() {
        return deepSeekPricing.costs(modelId).prompt;
    },
    get completion_tokens() {
        return deepSeekPricing.costs(modelId).completion;
    },
    get cached_tokens() {
        return deepSeekPricing.costs(modelId).cached;
    },
});

export const DEEPSEEK_MODELS: IChatModel[] = [
    {
        puterId: 'deepseek:deepseek/deepseek-flash',
        id: 'deepseek-flash',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        name: 'DeepSeek Flash',
        aliases: [
            'deepseek/deepseek-flash',
            'deepseek-v4-flash',
            'deepseek/deepseek-v4-flash',
            'deepseek:deepseek/deepseek-v4-flash',
            'deepseek-v4-flash-vision-exp',
            'deepseek/deepseek-v4-flash-vision-exp',
            'deepseek:deepseek/deepseek-v4-flash-vision-exp',
            'deepseek-chat',
            'deepseek/deepseek-chat',
            'deepseek:deepseek/deepseek-chat',
            'deepseek-reasoner',
            'deepseek/deepseek-reasoner',
            'deepseek:deepseek/deepseek-reasoner',
        ],
        context: 1_000_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        promptTokensIncludeCached: true,
        costs: dynamicCosts('deepseek-flash'),
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
        promptTokensIncludeCached: true,
        costs: dynamicCosts('deepseek-v4-pro'),
        max_tokens: 384_000,
    },
];
