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
import { usdPerMToken } from '../../utils/pricing.js';

export const SALADCLOUD_ID_PREFIX = 'saladcloud:';
export const SALADCLOUD_DEFAULT_MODEL = 'saladcloud:qwen3.6-35b-a3b';

export const SALADCLOUD_MODELS: IChatModel[] = [
    {
        id: SALADCLOUD_DEFAULT_MODEL,
        name: 'Qwen3.6 35B-A3B (SaladCloud)',
        aliases: ['saladcloud/qwen3.6-35b-a3b'],
        description:
            'Open multimodal Qwen MoE for agentic tasks, reasoning, and code generation',
        context: 262_144,
        max_tokens: 262_144,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        // No discounted cache rate is published, so cached prompt tokens use
        // the regular input rate.
        costs: usdPerMToken(0.09, 0.6, 0.09),
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        reasoning: true,
        structured_output: true,
        release_date: '2026-04-17',
    },
    {
        id: 'saladcloud:qwen3.6-27b',
        name: 'Qwen3.6 27B (SaladCloud)',
        aliases: ['saladcloud/qwen3.6-27b'],
        description:
            'Open multimodal Qwen dense model balancing capability and speed',
        context: 262_144,
        max_tokens: 262_144,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: usdPerMToken(0.3, 1.2, 0.3),
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        reasoning: true,
        structured_output: true,
        release_date: '2026-04-22',
    },
    {
        // SaladCloud publishes no release date for this one and no other
        // catalog here carries it; the field is left off rather than guessed.
        id: 'saladcloud:qwen3.5-9b',
        name: 'Qwen3.5 9B (SaladCloud)',
        aliases: ['saladcloud/qwen3.5-9b'],
        description:
            'Open multimodal Qwen dense model tuned for low-latency, high-volume prompts',
        context: 262_144,
        max_tokens: 262_144,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: usdPerMToken(0.06, 0.09, 0.06),
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: true,
        tool_call: true,
        reasoning: true,
        structured_output: true,
    },
];

export const stripSaladCloudPrefix = (modelId: string): string =>
    modelId.startsWith(SALADCLOUD_ID_PREFIX)
        ? modelId.slice(SALADCLOUD_ID_PREFIX.length)
        : modelId;
