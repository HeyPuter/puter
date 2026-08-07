/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import type { IChatModel } from '../types.js';

/**
 * Providers that resell other vendors' models rather than serving their own.
 * Their catalogs duplicate models we already reach directly, so their entries
 * are kept only as fallback routes.
 */
export const AGGREGATOR_PROVIDERS = new Set([
    'together-ai',
    'openrouter',
    'infron',
    'neuralwatt',
]);

// Lower rank is served first. `together-ai` sits behind the other resellers —
// a pre-existing guarantee this ranking extends rather than replaces.
const providerRank = (provider?: string): number => {
    if (provider === 'together-ai') return 2;
    if (provider && AGGREGATOR_PROVIDERS.has(provider)) return 1;
    return 0;
};

/**
 * Orders the candidates that share a model bucket; the first one gets served.
 *
 * Direct vendors outrank resellers regardless of quoted price. Resellers
 * advertise a floor price across their upstream routes, so on price alone they
 * undercut the vendor's list price and capture traffic for models we hold a
 * direct integration for. Within a rank, cheapest input cost wins and ties
 * break by shorter id — usually the official name over a qualified one.
 */
export const compareModelPreference = (
    a: IChatModel,
    b: IChatModel,
): number => {
    const rankDiff = providerRank(a.provider) - providerRank(b.provider);
    if (rankDiff !== 0) return rankDiff;

    const aCost = a.costs[
        (a.input_cost_key as string) || 'input_tokens'
    ] as number;
    const bCost = b.costs[
        (b.input_cost_key as string) || 'input_tokens'
    ] as number;
    if (aCost === bCost) return a.id.length - b.id.length;
    return aCost - bCost;
};
