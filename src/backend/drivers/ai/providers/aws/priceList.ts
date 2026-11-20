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
import { usdToUcents } from '../../shared/catalogPrice.js';

/**
 * An AWS service whose public price list we bill from; its offer code is
 * `Amazon<service>`.
 */
export type AwsPriceListService = 'Polly' | 'Textract';

const PRICE_LIST_BASE_URL =
    'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws';

// The region lands in the price list URL, so only plain AWS region codes pass.
const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d{1,2}$/;

export const isAwsPriceRegion = (region: string): boolean =>
    REGION_PATTERN.test(region);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** One price dimension of an on-demand term, checked down to its USD price. */
export interface AwsPriceDimension {
    beginRange: unknown;
    endRange: unknown;
    usd: unknown;
}

export interface OnDemandRateQuery {
    service: AwsPriceListService;
    region: string;
    /** The unit every dimension must be priced in, e.g. `Characters`. */
    unit: string;
    now: number;
    /** The group a product's rate belongs to, or undefined to skip the product. */
    group(
        product: Record<string, unknown>,
        attributes: Record<string, unknown>,
    ): string | undefined;
    /**
     * The dimension a term bills from, or undefined when its tiers can't be
     * billed from.
     */
    dimension(dimensions: AwsPriceDimension[]): AwsPriceDimension | undefined;
}

/**
 * The dimensions of one on-demand term, `null` when the term isn't in effect
 * yet, or undefined when its shape isn't one we can bill from.
 */
const termDimensions = (
    sku: string,
    termKey: string,
    term: unknown,
    unit: string,
    now: number,
): AwsPriceDimension[] | null | undefined => {
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
    const dimensions: AwsPriceDimension[] = [];
    for (const [dimensionKey, dimension] of Object.entries(
        term.priceDimensions,
    )) {
        if (!isRecord(dimension) || dimension.rateCode !== dimensionKey)
            return undefined;
        if (!dimensionKey.startsWith(`${termKey}.`)) return undefined;
        if (dimension.unit !== unit) return undefined;
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
        dimensions.push({
            beginRange: dimension.beginRange,
            endRange: dimension.endRange,
            usd: price.USD,
        });
    }
    return dimensions;
};

/** Microcents for a positive USD price, undefined for anything else. */
const positiveUcents = (usd: unknown): number | undefined => {
    if (typeof usd !== 'string') return undefined;
    const ucents = usdToUcents(usd);
    return ucents !== undefined && ucents > 0 ? ucents : undefined;
};

/**
 * Microcents per unit for each group of one region's on-demand products. A
 * group's rate is undefined unless exactly one well-formed, in-effect term
 * prices it. Throws when the document isn't the service's price list.
 */
export const onDemandRates = (
    doc: unknown,
    query: OnDemandRateQuery,
): Map<string, number | undefined> => {
    const { service, region, unit, now } = query;
    const offerCode = `Amazon${service}`;
    if (
        !isRecord(doc) ||
        doc.offerCode !== offerCode ||
        doc.formatVersion !== 'v1.0' ||
        !isRecord(doc.products) ||
        !isRecord(doc.terms) ||
        !isRecord(doc.terms.OnDemand)
    ) {
        throw new Error(`Not an AWS ${service} price list`);
    }
    const onDemand = doc.terms.OnDemand;

    const candidates = new Map<string, Array<number | undefined>>();
    for (const [sku, product] of Object.entries(doc.products)) {
        if (!isRecord(product) || product.sku !== sku) continue;
        const attrs = product.attributes;
        if (!isRecord(attrs)) continue;
        if (attrs.servicecode !== offerCode || attrs.regionCode !== region)
            continue;
        if ('electronStatus' in attrs) continue;
        const group = query.group(product, attrs);
        if (group === undefined) continue;

        const terms = onDemand[sku];
        const rates: Array<number | undefined> = [];
        if (isRecord(terms)) {
            for (const [termKey, term] of Object.entries(terms)) {
                const dimensions = termDimensions(
                    sku,
                    termKey,
                    term,
                    unit,
                    now,
                );
                if (dimensions === null) continue;
                const dimension = dimensions && query.dimension(dimensions);
                rates.push(dimension && positiveUcents(dimension.usd));
            }
        }
        // A matching SKU with no usable term poisons its group rather than
        // letting a sibling SKU's rate stand alone.
        let found = candidates.get(group);
        if (!found) candidates.set(group, (found = []));
        found.push(...(rates.length ? rates : [undefined]));
    }

    const rates = new Map<string, number | undefined>();
    for (const [group, found] of candidates) {
        rates.set(group, found.length === 1 ? found[0] : undefined);
    }
    return rates;
};

/**
 * Fetches one region's public price list for a service as parsed JSON. Null
 * when AWS publishes no list for the region.
 */
export const fetchAwsPriceList = async (
    service: AwsPriceListService,
    region: string,
    maxBytes: number,
    signal: AbortSignal,
): Promise<unknown> => {
    if (!isAwsPriceRegion(region)) {
        throw new Error(`Invalid AWS region for the ${service} price list`);
    }
    const response = await fetch(
        `${PRICE_LIST_BASE_URL}/Amazon${service}/current/${region}/index.json`,
        {
            signal,
            redirect: 'error',
            headers: { accept: 'application/json' },
        },
    );
    if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) return null;
        throw new Error(
            `AWS ${service} price list returned ${response.status}`,
        );
    }
    const body = await readBoundedBody(
        response,
        maxBytes,
        () => new Error(`AWS ${service} price list exceeds the size cap`),
    );
    return JSON.parse(body.toString('utf8'));
};
