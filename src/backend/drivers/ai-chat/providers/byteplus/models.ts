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

const bytePlusModel = (
    id: string,
    name: string,
    context: number,
    maxTokens: number,
    costs: IChatModel['costs'],
    opts: {
        input?: string[];
        extraAliases?: string[];
        openWeights?: boolean;
    } = {},
): IChatModel => ({
    puterId: `byteplus:byteplus/${id}`,
    id,
    name,
    aliases: [`byteplus/${id}`, ...(opts.extraAliases ?? [])],
    modalities: { input: opts.input ?? ['text'], output: ['text'] },
    open_weights: opts.openWeights ?? false,
    tool_call: true,
    context,
    max_tokens: maxTokens,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs,
});

// An undated series alias (e.g. `seed-1-6`) points at the newest snapshot of
// that series, mirroring how other providers alias their rolling names.
const series = (alias: string) => [alias, `byteplus/${alias}`];

const VISION = ['text', 'image', 'video'];

// Hardcoded from https://docs.byteplus.com/en/docs/ModelArk/1330310 (catalog)
// and https://docs.byteplus.com/en/docs/ModelArk/1544106 (pricing).
//
// Some models bill a higher rate for prompts above 128K tokens; the costs
// below are the base tier. seed-2-0-lite/mini-260428 also accept audio input
// at a much higher per-token rate ModelArk folds into prompt_tokens, so audio
// is deliberately left out of `modalities` to keep metering honest.
export const BYTEPLUS_MODELS: IChatModel[] = [
    bytePlusModel(
        'dola-seed-2-1-turbo-260628',
        'Dola Seed 2.1 Turbo',
        256 * K,
        256 * K,
        usdPerMToken(0.5, 2.5, 0.1),
        { input: VISION, extraAliases: series('dola-seed-2-1-turbo') },
    ),
    bytePlusModel(
        'seed-2-0-lite-260428',
        'Seed 2.0 Lite',
        256 * K,
        128 * K,
        usdPerMToken(0.25, 2, 0.05),
        { input: VISION, extraAliases: series('seed-2-0-lite') },
    ),
    bytePlusModel(
        'seed-2-0-mini-260428',
        'Seed 2.0 Mini',
        256 * K,
        128 * K,
        usdPerMToken(0.1, 0.4, 0.02),
        { input: VISION, extraAliases: series('seed-2-0-mini') },
    ),
    bytePlusModel(
        'seed-2-0-pro-260328',
        'Seed 2.0 Pro',
        256 * K,
        128 * K,
        usdPerMToken(0.5, 3, 0.1),
        { input: VISION, extraAliases: series('seed-2-0-pro') },
    ),
    bytePlusModel(
        'seed-2-0-code-preview-260328',
        'Seed 2.0 Code Preview',
        256 * K,
        128 * K,
        usdPerMToken(0.5, 3, 0.1),
        { input: VISION, extraAliases: series('seed-2-0-code-preview') },
    ),
    bytePlusModel(
        'glm-5-3-flash-260828',
        'GLM-5.3 Flash',
        1_024 * K,
        128 * K,
        usdPerMToken(0.15, 0.5, 0.03),
        { input: ['text', 'image'], extraAliases: series('glm-5-3-flash') },
    ),
    bytePlusModel(
        'glm-5-2-260617',
        'GLM-5.2',
        1_024 * K,
        128 * K,
        usdPerMToken(1.4, 4.4, 0.26),
        { extraAliases: series('glm-5-2') },
    ),
    // The bare `deepseek-v4-*` names belong to the first-party DeepSeek
    // provider, so these only carry the byteplus-prefixed aliases. V4.1 Flash
    // bills peak $0.30/$1.20 and off-peak $0.15/$0.60 per MTok; the peak rate
    // is encoded so off-peak use is never under-billed.
    bytePlusModel(
        'deepseek-v4-1-flash-260910',
        'DeepSeek V4.1 Flash',
        1_024 * K,
        384 * K,
        usdPerMToken(0.3, 1.2, 0.006),
        {
            input: ['text', 'image'],
            extraAliases: ['byteplus/deepseek-v4-1-flash'],
        },
    ),
    bytePlusModel(
        'deepseek-v4-pro-ga-260813',
        'DeepSeek V4 Pro (GA)',
        1_024 * K,
        384 * K,
        usdPerMToken(1.32, 3.96, 0.044),
        { extraAliases: ['byteplus/deepseek-v4-pro-ga'] },
    ),
    bytePlusModel(
        'deepseek-v4-flash-ga-260731',
        'DeepSeek V4 Flash (GA)',
        1_024 * K,
        384 * K,
        usdPerMToken(0.44, 1.32, 0.014),
        { extraAliases: ['byteplus/deepseek-v4-flash-ga'] },
    ),
    bytePlusModel(
        'deepseek-v4-pro-260425',
        'DeepSeek V4 Pro',
        1_024 * K,
        384 * K,
        usdPerMToken(1.32, 3.96, 0.044),
        { extraAliases: ['byteplus/deepseek-v4-pro'] },
    ),
    bytePlusModel(
        'deepseek-v4-flash-260425',
        'DeepSeek V4 Flash',
        1_024 * K,
        384 * K,
        usdPerMToken(0.44, 1.32, 0.014),
        { extraAliases: ['byteplus/deepseek-v4-flash'] },
    ),
];
