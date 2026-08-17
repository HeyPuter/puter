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

const K = 1_000;

const textModel = (
    id: string,
    name: string,
    context: number,
    maxTokens: number,
    costs: IChatModel['costs'],
): IChatModel => ({
    puterId: `z-ai:z-ai/${id}`,
    id,
    name,
    aliases: [`z-ai/${id}`, `zai/${id}`],
    modalities: { input: ['text'], output: ['text'] },
    open_weights: false,
    tool_call: true,
    context,
    max_tokens: maxTokens,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs,
});

// Hardcoded from live Z.AI /models and https://docs.z.ai/guides/overview/pricing.
export const ZAI_MODELS: IChatModel[] = [
    textModel(
        'glm-5.3',
        'GLM-5.3',
        1_000 * K,
        128 * K,
        usdPerMToken(1.4, 4.4, 0.26),
    ),
    textModel(
        'glm-5.2',
        'GLM-5.2',
        1_000 * K,
        128 * K,
        usdPerMToken(1.4, 4.4, 0.26),
    ),
    textModel(
        'glm-5.1',
        'GLM-5.1',
        200 * K,
        128 * K,
        usdPerMToken(1.4, 4.4, 0.26),
    ),
    textModel('glm-5', 'GLM-5', 200 * K, 128 * K, usdPerMToken(1, 3.2, 0.2)),
    textModel(
        'glm-5-turbo',
        'GLM-5-Turbo',
        200 * K,
        128 * K,
        usdPerMToken(1.2, 4, 0.24),
    ),
    textModel(
        'glm-4.7',
        'GLM-4.7',
        200 * K,
        128 * K,
        usdPerMToken(0.6, 2.2, 0.11),
    ),
    textModel(
        'glm-4.6',
        'GLM-4.6',
        200 * K,
        128 * K,
        usdPerMToken(0.6, 2.2, 0.11),
    ),
    textModel(
        'glm-4.5',
        'GLM-4.5',
        128 * K,
        96 * K,
        usdPerMToken(0.6, 2.2, 0.11),
    ),
    textModel(
        'glm-4.5-air',
        'GLM-4.5-Air',
        128 * K,
        96 * K,
        usdPerMToken(0.2, 1.1, 0.03),
    ),
];
