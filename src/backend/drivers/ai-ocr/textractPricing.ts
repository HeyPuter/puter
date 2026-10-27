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

import { cachedRemoteCatalog } from '../ai-chat/utils/cachedRemoteCatalog.js';
import { readBoundedBody } from '../util/fileInput.js';

/** A region's Textract prices are tens of KB; anything far past that is not one. */
export const TEXTRACT_PRICE_LIST_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Most regions priced from the feed at once. Calls run in the configured region
 * and the regions of the deployment's buckets, so a handful is plenty; any
 * region past the cap is billed at the curated rate.
 */
export const TEXTRACT_PRICE_MAX_REGIONS = 8;

const PRICE_LIST_BASE_URL =
    'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonTextract/current';

// The region lands in the price list URL, so only plain AWS region codes pass.
const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d{1,2}$/;

// DetectDocumentText only: `<prefix>-SyncTextPagesProcessed`. Async and
// AnalyzeDocument variants, and prefixed promotional usage, don't match.
const USAGE_TYPE_PATTERN = /^[A-Z0-9]+-SyncTextPagesProcessed$/;

// USD per page as a plain decimal, e.g. "0.0015000000".
const USD_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const RANGE_PATTERN = /^\d+$/;
const UCENTS_PER_USD_DIGITS = 8;

export const isTextractPriceRegion = (region: string): boolean =>
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

/** Whether a product is the regular synchronous DetectDocumentText SKU. */
const isSyncTextProduct = (
    sku: string,
    product: unknown,
    region: string,
): boolean => {
    if (!isRecord(product) || product.sku !== sku) return false;
    if (product.productFamily !== 'API Request') return false;
    const attrs = product.attributes;
    if (!isRecord(attrs)) return false;
    if (attrs.servicecode !== 'AmazonTextract' || attrs.regionCode !== region)
        return false;
    if (attrs.apiType !== 'Sync' || attrs.entityType !== 'Text') return false;
    if ('electronStatus' in attrs) return false;
    if (
        typeof attrs.usagetype !== 'string' ||
        !USAGE_TYPE_PATTERN.test(attrs.usagetype)
    )
        return false;
    return (
        attrs.platopagedatatype === undefined ||
        attrs.platopagedatatype === 'SyncTextPagesProcessed'
    );
};

/**
 * The first-tier USD-per-page rate a term charges now, `null` when the term
 * isn't in effect yet, or undefined when its shape isn't one we can bill from.
 * Later volume tiers are checked for shape but never priced from: they depend
 * on the account's monthly volume, which a single call can't know.
 */
const termFirstTierRate = (
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
    const firstTiers: Record<string, unknown>[] = [];
    for (const [dimensionKey, dimension] of Object.entries(
        term.priceDimensions,
    )) {
        if (!isRecord(dimension) || dimension.rateCode !== dimensionKey)
            return undefined;
        if (!dimensionKey.startsWith(`${termKey}.`)) return undefined;
        if (dimension.unit !== 'Pages') return undefined;
        const price = dimension.pricePerUnit;
        if (!isRecord(price) || Object.keys(price).join() !== 'USD')
            return undefined;
        if (
            dimension.appliesTo !== undefined &&
            !(
                Array.isArray(dimension.appliesTo) &&
                dimension.appliesTo.length === 0
            )
        )
            return undefined;
        if (dimension.beginRange === '0') firstTiers.push(dimension);
    }
    if (firstTiers.length !== 1) return undefined;

    const tier = firstTiers[0]!;
    if (
        tier.endRange !== 'Inf' &&
        !(
            typeof tier.endRange === 'string' &&
            RANGE_PATTERN.test(tier.endRange) &&
            Number(tier.endRange) > 0
        )
    )
        return undefined;
    const usd = (tier.pricePerUnit as Record<string, unknown>).USD;
    if (typeof usd !== 'string') return undefined;
    const ucents = usdToUcents(usd);
    return ucents !== undefined && ucents > 0 ? ucents : undefined;
};

/**
 * Microcents per page for DetectDocumentText in one region's AWS price list:
 * the first volume tier of the single in-effect on-demand USD term on the
 * single regular synchronous text SKU. Undefined when that rate is missing,
 * malformed, or ambiguous. Throws when the document isn't a Textract price
 * list.
 */
export const parseTextractPriceList = (
    doc: unknown,
    region: string,
    now: number = Date.now(),
): number | undefined => {
    if (
        !isRecord(doc) ||
        doc.offerCode !== 'AmazonTextract' ||
        doc.formatVersion !== 'v1.0' ||
        !isRecord(doc.products) ||
        !isRecord(doc.terms) ||
        !isRecord(doc.terms.OnDemand)
    ) {
        throw new Error('Not an AWS Textract price list');
    }
    const onDemand = doc.terms.OnDemand;

    const found: Array<number | undefined> = [];
    for (const [sku, product] of Object.entries(doc.products)) {
        if (!isSyncTextProduct(sku, product, region)) continue;
        const terms = onDemand[sku];
        const rates: Array<number | undefined> = [];
        if (isRecord(terms)) {
            for (const [termKey, term] of Object.entries(terms)) {
                const rate = termFirstTierRate(sku, termKey, term, now);
                if (rate !== null) rates.push(rate);
            }
        }
        // A matching SKU with no usable term poisons the result rather than
        // letting a sibling SKU's rate stand alone.
        found.push(...(rates.length ? rates : [undefined]));
    }
    return found.length === 1 ? found[0] : undefined;
};

/** Fetches one region's public Textract price list and reads its rate. */
export const fetchTextractPriceList = async (
    region: string,
    signal: AbortSignal,
): Promise<number> => {
    if (!isTextractPriceRegion(region)) {
        throw new Error('Invalid AWS region for the Textract price list');
    }
    const response = await fetch(
        `${PRICE_LIST_BASE_URL}/${region}/index.json`,
        {
            signal,
            redirect: 'error',
            headers: { accept: 'application/json' },
        },
    );
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`AWS Textract price list returned ${response.status}`);
    }
    const body = await readBoundedBody(
        response,
        TEXTRACT_PRICE_LIST_MAX_BYTES,
        () => new Error('AWS Textract price list exceeds the size cap'),
    );
    const rate = parseTextractPriceList(
        JSON.parse(body.toString('utf8')),
        region,
    );
    if (rate === undefined) {
        throw new Error(
            `AWS Textract price list has no usable DetectDocumentText rate for ${region}`,
        );
    }
    return rate;
};

export interface TextractRates {
    /**
     * Microcents per page in a region: its last good feed rate, else the
     * curated one.
     */
    rate(region: string): Promise<number>;
    /** The rate {@link rate} last settled on for a region, without fetching. */
    peek(region: string): number;
}

/**
 * DetectDocumentText rates per region, each region's price list cached and
 * refreshed on its own. A region whose feed fails or omits the rate keeps its
 * last good value, or `fallback` until it has one.
 */
export const textractRates = (
    fallback: number,
    maxRegions: number = TEXTRACT_PRICE_MAX_REGIONS,
): TextractRates => {
    const catalogs = new Map<string, () => Promise<number>>();
    const latest = new Map<string, number>();

    const catalogFor = (region: string) => {
        const existing = catalogs.get(region);
        if (existing) return existing;
        if (!isTextractPriceRegion(region) || catalogs.size >= maxRegions)
            return undefined;
        const catalog = cachedRemoteCatalog<number>({
            name: `AWS Textract ${region} price list`,
            fallback,
            fetch: (signal) => fetchTextractPriceList(region, signal),
        });
        catalogs.set(region, catalog);
        return catalog;
    };

    return {
        async rate(region) {
            const catalog = catalogFor(region);
            if (!catalog) return fallback;
            const rate = await catalog();
            latest.set(region, rate);
            return rate;
        },
        peek: (region) => latest.get(region) ?? fallback,
    };
};
