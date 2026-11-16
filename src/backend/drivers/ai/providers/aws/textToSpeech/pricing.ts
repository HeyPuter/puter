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

import { fetchAwsPriceList, onDemandRates } from '../priceList.js';

/** A region's Polly prices are a few KB; anything far past that is not one. */
const POLLY_PRICE_LIST_MAX_BYTES = 1024 * 1024;

// Regular synthesis only: `<prefix>-SynthesizeSpeech[Engine]-Characters`.
// Promotional variants (`USW2-ai-SynthesizeSpeech…`) don't match.
const USAGE_TYPE_PATTERN =
    /^[A-Z0-9]+-SynthesizeSpeech(Neural|LongForm|Generative)?-Characters$/;

const ENGINE_BY_USAGE_SUFFIX: Record<string, string> = {
    '': 'standard',
    Neural: 'neural',
    LongForm: 'long-form',
    Generative: 'generative',
};

const ENGINE_BY_ATTRIBUTE: Record<string, string> = {
    Standard: 'standard',
    Neural: 'neural',
    'Long-Form': 'long-form',
    Generative: 'generative',
};

const PRODUCT_FAMILIES = new Set(['AmazonPolly', 'Synthesize Speech']);

/** Microcents per character, keyed by Polly engine id. */
export type PollyRates = Record<string, number>;

/** The engine a product prices, or undefined when it isn't regular synthesis. */
const productEngine = (
    product: Record<string, unknown>,
    attrs: Record<string, unknown>,
): string | undefined => {
    if (
        typeof product.productFamily !== 'string' ||
        !PRODUCT_FAMILIES.has(product.productFamily)
    )
        return undefined;
    if (typeof attrs.usagetype !== 'string') return undefined;
    const usage = USAGE_TYPE_PATTERN.exec(attrs.usagetype);
    if (!usage) return undefined;
    const engine = ENGINE_BY_USAGE_SUFFIX[usage[1] ?? ''];
    if (
        typeof attrs.engine !== 'string' ||
        ENGINE_BY_ATTRIBUTE[attrs.engine] !== engine
    )
        return undefined;
    return engine;
};

/**
 * Per-engine rates from one region's AWS price list. An engine appears only
 * when exactly one well-formed, in-effect, flat USD-per-character rate prices
 * it; anything missing, malformed, or ambiguous is left out for the caller to
 * fill from its curated rates. Throws when the document isn't a Polly price
 * list.
 */
export const parsePollyPriceList = (
    doc: unknown,
    region: string,
    now: number = Date.now(),
): PollyRates => {
    const found = onDemandRates(doc, {
        service: 'Polly',
        region,
        unit: 'Characters',
        now,
        group: productEngine,
        // A flat rate: one tier covering every character.
        dimension: (dimensions) =>
            dimensions.length === 1 &&
            dimensions[0]!.beginRange === '0' &&
            dimensions[0]!.endRange === 'Inf'
                ? dimensions[0]
                : undefined,
    });
    const rates: PollyRates = {};
    for (const [engine, rate] of found) {
        if (rate !== undefined) rates[engine] = rate;
    }
    return rates;
};

/** Fetches and parses one region's public Polly price list. */
export const fetchPollyPriceList = async (
    region: string,
    signal: AbortSignal,
): Promise<PollyRates> => {
    const doc = await fetchAwsPriceList(
        'Polly',
        region,
        POLLY_PRICE_LIST_MAX_BYTES,
        signal,
    );
    if (doc === null) {
        throw new Error(`AWS publishes no Polly price list for ${region}`);
    }
    return parsePollyPriceList(doc, region);
};
