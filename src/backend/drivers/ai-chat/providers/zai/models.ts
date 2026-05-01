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

const CENTS_PER_USD = 100;
const MTOK = 1_000_000;
const K = 1_000;

const usdPerMToken = (
    inputUsd: number,
    outputUsd: number,
    cachedInputUsd = 0,
) => ({
    tokens: MTOK,
    prompt_tokens: inputUsd * CENTS_PER_USD,
    completion_tokens: outputUsd * CENTS_PER_USD,
    cached_tokens: cachedInputUsd * CENTS_PER_USD,
});

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

const visionModel = (
    id: string,
    name: string,
    context: number,
    maxTokens: number,
    costs: IChatModel['costs'],
): IChatModel => ({
    puterId: `z-ai:zai/${id}`,
    id,
    name,
    aliases: [`z-ai/${id}`, `zai/${id}`],
    modalities: { input: ['text', 'image', 'video', 'file'], output: ['text'] },
    open_weights: false,
    tool_call: true,
    context,
    max_tokens: maxTokens,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs,
});

// Hardcoded from https://docs.z.ai/api-reference/llm/chat-completion and
// https://docs.z.ai/guides/overview/pricing.
export const ZAI_MODELS: IChatModel[] = [
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
        'glm-4.7-flashx',
        'GLM-4.7-FlashX',
        200 * K,
        128 * K,
        usdPerMToken(0.07, 0.4, 0.01),
    ),
    textModel(
        'glm-4.7-flash',
        'GLM-4.7-Flash',
        200 * K,
        128 * K,
        usdPerMToken(0, 0, 0),
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
        'glm-4.5-x',
        'GLM-4.5-X',
        128 * K,
        96 * K,
        usdPerMToken(2.2, 8.9, 0.45),
    ),
    textModel(
        'glm-4.5-air',
        'GLM-4.5-Air',
        128 * K,
        96 * K,
        usdPerMToken(0.2, 1.1, 0.03),
    ),
    textModel(
        'glm-4.5-airx',
        'GLM-4.5-AirX',
        128 * K,
        96 * K,
        usdPerMToken(1.1, 4.5, 0.22),
    ),
    textModel(
        'glm-4.5-flash',
        'GLM-4.5-Flash',
        128 * K,
        96 * K,
        usdPerMToken(0, 0, 0),
    ),
    textModel(
        'glm-4-32b-0414-128k',
        'GLM-4-32B-0414-128K',
        128 * K,
        16 * K,
        usdPerMToken(0.1, 0.1, 0),
    ),
    visionModel(
        'glm-5v-turbo',
        'GLM-5V-Turbo',
        200 * K,
        128 * K,
        usdPerMToken(1.2, 4, 0.24),
    ),
    visionModel(
        'glm-4.6v',
        'GLM-4.6V',
        128 * K,
        32 * K,
        usdPerMToken(0.3, 0.9, 0.05),
    ),
    visionModel(
        'glm-4.6v-flashx',
        'GLM-4.6V-FlashX',
        128 * K,
        32 * K,
        usdPerMToken(0.04, 0.4, 0.004),
    ),
    visionModel(
        'glm-4.6v-flash',
        'GLM-4.6V-Flash',
        128 * K,
        32 * K,
        usdPerMToken(0, 0, 0),
    ),
    visionModel(
        'glm-4.5v',
        'GLM-4.5V',
        128 * K,
        16 * K,
        usdPerMToken(0.6, 1.8, 0.11),
    ),
    visionModel(
        'autoglm-phone-multilingual',
        'AutoGLM-Phone-Multilingual',
        4 * K,
        4 * K,
        usdPerMToken(0, 0, 0),
    ),
];
