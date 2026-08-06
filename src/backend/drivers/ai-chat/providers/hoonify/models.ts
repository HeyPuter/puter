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

/**
 * IChatModel plus the exact-case model id Hoonify expects on the wire. The
 * driver lowercases catalog ids when it builds its routing map, so the provider
 * keeps the original casing separately.
 */
export type HoonifyChatModel = IChatModel & { wireId: string };

/**
 * Hoonify is a multi-vendor gateway registered as an aggregator: any alias that
 * collides with a first-party provider's id or alias drops the whole model from
 * the routing map. Vendor-scoped aliases are therefore only included where no
 * first-party provider claims the name — the canonical `hoonify:` id must
 * always survive.
 */
const hoonifyModel = (
    wireId: string,
    name: string,
    context: number,
    maxTokens: number,
    costs: IChatModel['costs'],
    extraAliases: string[] = [],
): HoonifyChatModel => ({
    id: `hoonify:${wireId.toLowerCase()}`,
    wireId,
    name: `${name} (Hoonify)`,
    aliases: [`hoonify/${wireId.toLowerCase()}`, ...extraAliases],
    // Per https://hoonify.ai/docs/api/models all models are currently
    // text-in + text-out.
    modalities: { input: ['text'], output: ['text'] },
    open_weights: true,
    tool_call: true,
    context,
    max_tokens: maxTokens,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs,
});

// Hardcoded from https://hoonify.ai/catalog?mode=inference — the API's
// `GET /v1/models` carries no prices, so the catalog stays static rather
// than dynamic to guarantee metering never bills below list. Models
// without published pricing are omitted for the same reason.
export const HOONIFY_MODELS: HoonifyChatModel[] = [
    hoonifyModel(
        'zai-org/GLM-5.2',
        'GLM-5.2',
        1_000 * K,
        128 * K,
        usdPerMToken(1.4, 4.4, 0.18),
        ['zai-org/glm-5.2'],
    ),
    hoonifyModel(
        'google/gemma-4-31B-it',
        'Gemma 4 31B Instruct',
        262_144,
        32_768,
        usdPerMToken(0.12, 0.38, 0.09),
        ['google/gemma-4-31b-it'],
    ),
    // No vendor-scoped alias: `qwen/qwen3.6-27b` is already an Alibaba
    // alias for the same open model, and colliding would drop this entry.
    hoonifyModel(
        'Qwen/Qwen3.6-27B',
        'Qwen3.6 27B',
        262_144,
        65_536,
        usdPerMToken(0.32, 3.2, 0.15),
    ),
];
