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

import { cachedRemoteCatalog } from '../../../shared/cachedRemoteCatalog.js';
import {
    fetchAwsPriceList,
    isAwsPriceRegion,
    onDemandRates,
    type AwsPriceDimension,
} from '../priceList.js';

/** A region's Textract prices are tens of KB; anything far past that is not one. */
const TEXTRACT_PRICE_LIST_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Most regions priced from the feed at once. Calls run in the configured region
 * and the regions of the deployment's buckets, so a handful is plenty; any
 * region past the cap is billed at the curated rate.
 */
export const TEXTRACT_PRICE_MAX_REGIONS = 8;

// DetectDocumentText only: `<prefix>-SyncTextPagesProcessed`. Async and
// AnalyzeDocument variants, and prefixed promotional usage, don't match.
const USAGE_TYPE_PATTERN = /^[A-Z0-9]+-SyncTextPagesProcessed$/;

const RANGE_PATTERN = /^\d+$/;

/** The one group this file prices: regular synchronous DetectDocumentText. */
const SYNC_TEXT = 'sync-text';

const syncTextGroup = (
    product: Record<string, unknown>,
    attrs: Record<string, unknown>,
): string | undefined =>
    product.productFamily === 'API Request' &&
    attrs.apiType === 'Sync' &&
    attrs.entityType === 'Text' &&
    typeof attrs.usagetype === 'string' &&
    USAGE_TYPE_PATTERN.test(attrs.usagetype) &&
    (attrs.platopagedatatype === undefined ||
        attrs.platopagedatatype === 'SyncTextPagesProcessed')
        ? SYNC_TEXT
        : undefined;

/**
 * A term's first volume tier. Later tiers depend on the account's monthly
 * volume, which a single call can't know, so they're never priced from.
 */
const firstTier = (
    dimensions: AwsPriceDimension[],
): AwsPriceDimension | undefined => {
    const firstTiers = dimensions.filter((d) => d.beginRange === '0');
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
    return tier;
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
): number | undefined =>
    onDemandRates(doc, {
        service: 'Textract',
        region,
        unit: 'Pages',
        now,
        group: syncTextGroup,
        dimension: firstTier,
    }).get(SYNC_TEXT);

/**
 * Fetches one region's public Textract price list and reads its rate. Null when
 * AWS publishes no list for the region, as for every region without Textract.
 */
export const fetchTextractPriceList = async (
    region: string,
    signal: AbortSignal,
): Promise<number | null> => {
    const doc = await fetchAwsPriceList(
        'Textract',
        region,
        TEXTRACT_PRICE_LIST_MAX_BYTES,
        signal,
    );
    if (doc === null) return null;
    const rate = parseTextractPriceList(doc, region);
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
     * curated one. Null when AWS publishes no price list for the region, which
     * means it doesn't run Textract there.
     */
    rate(region: string): Promise<number | null>;
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
    const catalogs = new Map<string, () => Promise<number | null>>();
    const latest = new Map<string, number | null>();

    const catalogFor = (region: string) => {
        const existing = catalogs.get(region);
        if (existing) return existing;
        if (!isAwsPriceRegion(region) || catalogs.size >= maxRegions)
            return undefined;
        const catalog = cachedRemoteCatalog<number | null>({
            name: `AWS Textract ${region} price list`,
            fallback,
            // The rate read here is the rate billed.
            blocking: true,
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
