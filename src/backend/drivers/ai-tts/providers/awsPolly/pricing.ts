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

import { readBoundedBody } from '../../../util/fileInput.js';

/** A region's Polly prices are a few KB; anything far past that is not one. */
export const POLLY_PRICE_LIST_MAX_BYTES = 1024 * 1024;

const PRICE_LIST_BASE_URL =
    'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPolly/current';

// The region lands in the price list URL, so only plain AWS region codes pass.
const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d{1,2}$/;

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

// USD per character as a plain decimal, e.g. "0.0000160000".
const USD_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const UCENTS_PER_USD_DIGITS = 8;

/** Microcents per character, keyed by Polly engine id. */
export type PollyRates = Record<string, number>;

export const isPollyPriceRegion = (region: string): boolean =>
    REGION_PATTERN.test(region);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Exact decimal shift of a USD amount into microcents. */
const usdToUcents = (usd: string): number | undefined => {
    const match = USD_PATTERN.exec(usd);
    if (!match) return undefined;
    const fraction = match[2] ?? '';
    const whole = fraction.padEnd(UCENTS_PER_USD_DIGITS, '0');
    const ucents = Number(
        `${match[1]}${whole.slice(0, UCENTS_PER_USD_DIGITS)}.${whole.slice(UCENTS_PER_USD_DIGITS) || '0'}`,
    );
    return Number.isFinite(ucents) ? ucents : undefined;
};

/** The engine a product prices, or undefined when it isn't regular synthesis. */
const productEngine = (
    sku: string,
    product: unknown,
    region: string,
): string | undefined => {
    if (!isRecord(product) || product.sku !== sku) return undefined;
    if (
        typeof product.productFamily !== 'string' ||
        !PRODUCT_FAMILIES.has(product.productFamily)
    )
        return undefined;
    const attrs = product.attributes;
    if (!isRecord(attrs)) return undefined;
    if (attrs.servicecode !== 'AmazonPolly' || attrs.regionCode !== region)
        return undefined;
    if ('electronStatus' in attrs) return undefined;
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
 * The single flat on-demand rate a term charges now, `null` when the term isn't
 * in effect yet, or undefined when its shape isn't one we can bill from.
 */
const termRate = (
    sku: string,
    termKey: string,
    term: unknown,
    now: number,
): number | null | undefined => {
    if (!isRecord(term) || term.sku !== sku) return undefined;
    if (
        typeof term.offerTermCode !== 'string' ||
        termKey !== `${sku}.${term.offerTermCode}`
    )
        return undefined;
    if (
        term.termAttributes !== undefined &&
        (!isRecord(term.termAttributes) ||
            Object.keys(term.termAttributes).length > 0)
    )
        return undefined;
    const effective =
        typeof term.effectiveDate === 'string'
            ? Date.parse(term.effectiveDate)
            : NaN;
    if (!Number.isFinite(effective)) return undefined;
    if (effective > now) return null;

    if (!isRecord(term.priceDimensions)) return undefined;
    const dimensions = Object.entries(term.priceDimensions);
    if (dimensions.length !== 1) return undefined;
    const [dimensionKey, dimension] = dimensions[0]!;
    if (!isRecord(dimension) || dimension.rateCode !== dimensionKey)
        return undefined;
    if (!dimensionKey.startsWith(`${termKey}.`)) return undefined;
    if (dimension.unit !== 'Characters') return undefined;
    if (dimension.beginRange !== '0' || dimension.endRange !== 'Inf')
        return undefined;
    if (
        dimension.appliesTo !== undefined &&
        !(
            Array.isArray(dimension.appliesTo) &&
            dimension.appliesTo.length === 0
        )
    )
        return undefined;
    const price = dimension.pricePerUnit;
    if (!isRecord(price) || Object.keys(price).join() !== 'USD')
        return undefined;
    if (typeof price.USD !== 'string') return undefined;
    const ucents = usdToUcents(price.USD);
    return ucents !== undefined && ucents > 0 ? ucents : undefined;
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
    if (
        !isRecord(doc) ||
        doc.offerCode !== 'AmazonPolly' ||
        doc.formatVersion !== 'v1.0' ||
        !isRecord(doc.products) ||
        !isRecord(doc.terms) ||
        !isRecord(doc.terms.OnDemand)
    ) {
        throw new Error('Not an AWS Polly price list');
    }
    const onDemand = doc.terms.OnDemand;

    const candidates: Record<string, Array<number | undefined>> = {};
    for (const [sku, product] of Object.entries(doc.products)) {
        const engine = productEngine(sku, product, region);
        if (!engine) continue;
        const terms = onDemand[sku];
        const rates: Array<number | undefined> = [];
        if (isRecord(terms)) {
            for (const [termKey, term] of Object.entries(terms)) {
                const rate = termRate(sku, termKey, term, now);
                if (rate !== null) rates.push(rate);
            }
        }
        // A billable SKU with no usable term poisons its engine rather than
        // letting a sibling SKU's rate stand alone.
        (candidates[engine] ??= []).push(
            ...(rates.length ? rates : [undefined]),
        );
    }

    const rates: PollyRates = {};
    for (const [engine, found] of Object.entries(candidates)) {
        if (found.length === 1 && found[0] !== undefined) {
            rates[engine] = found[0];
        }
    }
    return rates;
};

/** Fetches and parses one region's public Polly price list. */
export const fetchPollyPriceList = async (
    region: string,
    signal: AbortSignal,
): Promise<PollyRates> => {
    if (!isPollyPriceRegion(region)) {
        throw new Error('Invalid AWS region for the Polly price list');
    }
    const response = await fetch(
        `${PRICE_LIST_BASE_URL}/${region}/index.json`,
        {
            signal,
            headers: { accept: 'application/json' },
        },
    );
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`AWS Polly price list returned ${response.status}`);
    }
    const body = await readBoundedBody(
        response,
        POLLY_PRICE_LIST_MAX_BYTES,
        () => new Error('AWS Polly price list exceeds the size cap'),
    );
    return parsePollyPriceList(JSON.parse(body.toString('utf8')), region);
};
