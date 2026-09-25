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
    'hoonify',
]);

/**
 * Direct providers served ahead of every other direct provider, at any price.
 * Azure AI Foundry fronts OpenAI and xAI models at mirrored prices, so naming
 * it here keeps it first even if the two cost tables drift. The rank is
 * unconditional, not scoped to the vendors it fronts: any other provider that
 * ever publishes one of these model ids loses the bucket however cheaply it
 * quotes.
 */
const PREFERRED_PROVIDERS = new Set(['azure-openai', 'azure-openai-responses']);

// Lower rank is served first: preferred direct providers, then the other
// direct vendors, then the resellers with `openrouter` and `together-ai` at
// the very bottom, in that order.
const providerRank = (provider?: string): number => {
    if (provider === 'together-ai') return 4;
    if (provider === 'openrouter') return 3;
    if (provider && AGGREGATOR_PROVIDERS.has(provider)) return 2;
    if (provider && PREFERRED_PROVIDERS.has(provider)) return 0;
    return 1;
};

/**
 * Lookup form for a model id or alias: the model map is keyed case- and
 * whitespace-insensitively.
 */
export const normalizeModelKey = (key: string): string =>
    key.trim().toLowerCase();

/**
 * Every name a model answers to, in declaration order and without repeats.
 *
 * A catalog entry's `id` is already one of its names, so an `aliases` array
 * that also lists the id is redundant rather than wrong -- and catalogs do
 * that, because alias lists get written as "every spelling a caller might type"
 * and the id is one of those spellings. Deduplicating here means the flattened
 * list stays honest no matter how the catalog is written, instead of every
 * caller having to reason about it.
 */
export const modelLookupNames = (
    models: readonly Pick<IChatModel, 'id' | 'aliases'>[],
): string[] => [
    ...new Set(models.flatMap((m) => [m.id, ...(m.aliases ?? [])])),
];

/**
 * Whether a key asserts _which model this is_, rather than merely being another
 * way to name it.
 *
 * Catalogs mix both into `aliases`: machine ids (`anthropic/claude-sonnet-4`,
 * `claude-sonnet-4`) alongside human labels (`Anthropic: Claude Sonnet 4`).
 * Only the former may pull an entry into another provider's bucket — two
 * gateways agreeing on a display string is not evidence they serve the same
 * weights, and a label collision would otherwise silently reroute traffic.
 * Labels stay usable for lookup; they just don't merge anything.
 *
 * Vendor model ids never contain whitespace, and every display name in the
 * catalogs we consume does — that separation is the whole test.
 */
export const isIdentityKey = (key: string): boolean =>
    key.length > 0 && !/\s/.test(key);

/**
 * Orders the candidates that share a model bucket; the first one gets served.
 *
 * Preferred direct providers outrank the other direct vendors, and direct
 * vendors outrank resellers, regardless of quoted price. Resellers advertise a
 * floor price across their upstream routes, so on price alone they undercut the
 * vendor's list price and capture traffic for models we hold a direct
 * integration for. Within a rank, cheapest input cost wins and ties break by
 * shorter id — usually the official name over a qualified one.
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
