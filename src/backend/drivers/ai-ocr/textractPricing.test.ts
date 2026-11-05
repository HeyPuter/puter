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

import { afterEach, describe, expect, it, vi } from 'vitest';
import usWest2 from './fixtures/textract-us-west-2.json';
import {
    fetchTextractPriceList,
    isTextractPriceRegion,
    parseTextractPriceList,
    TEXTRACT_PRICE_LIST_MAX_BYTES,
    textractRates,
} from './textractPricing.js';

// The fixture is AWS's public us-west-2 Textract price list trimmed to the
// DetectDocumentText SKU and two neighbours (async text, sync tables); all
// its terms took effect on 2024-10-01.
const NOW = Date.parse('2026-10-13T00:00:00Z');

const SYNC_TEXT_SKU = 'GDBP4PSVE9T6ZMUT';
const ASYNC_TEXT_SKU = 'ASZEG698D47WUZBY';
const FIRST_TIER = `${SYNC_TEXT_SKU}.JRTCKXETXF.SB2VSFF4TP`;
const SECOND_TIER = `${SYNC_TEXT_SKU}.JRTCKXETXF.VNJQCFJPS4`;
const PRICE_LIST_URL = (region: string) =>
    `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonTextract/current/${region}/index.json`;

// Tests reshape the fixture freely, so it's handled as untyped JSON.
type Doc = Record<string, any>;
const westCopy = (): Doc => structuredClone(usWest2);

const termOf = (doc: Doc, sku = SYNC_TEXT_SKU) =>
    Object.values(doc.terms.OnDemand[sku] as object)[0];
const dimensionOf = (doc: Doc, rateCode = FIRST_TIER) =>
    termOf(doc).priceDimensions[rateCode];

/** The fixture re-published for another region at a different first-tier price. */
const regionDoc = (region: string, usd: string): Doc => {
    const doc = westCopy();
    for (const product of Object.values(doc.products) as Doc[]) {
        product.attributes.regionCode = region;
    }
    dimensionOf(doc).pricePerUnit.USD = usd;
    return doc;
};

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('parseTextractPriceList on the published price list', () => {
    it('reads the first-tier DetectDocumentText rate as exact microcents per page', () => {
        // $1.50 per 1000 pages.
        expect(parseTextractPriceList(usWest2, 'us-west-2', NOW)).toBe(150000);
    });

    it('never prices from a discounted volume tier', () => {
        const doc = westCopy();
        dimensionOf(doc, SECOND_TIER).pricePerUnit.USD = '0.0000010000';
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(150000);
    });

    it('accepts a single unbounded first tier', () => {
        const doc = westCopy();
        delete termOf(doc).priceDimensions[SECOND_TIER];
        dimensionOf(doc).endRange = 'Inf';
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(150000);
    });

    it('only reads products for the exact region asked for', () => {
        expect(parseTextractPriceList(usWest2, 'us-east-1', NOW)).toBe(
            undefined,
        );
        expect(parseTextractPriceList(usWest2, 'us-west-2 ', NOW)).toBe(
            undefined,
        );
    });

    it('ignores the async text and AnalyzeDocument SKUs', () => {
        const doc = westCopy();
        delete doc.products[SYNC_TEXT_SKU];
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it.each([
        ['an async api type', (a: any) => (a.apiType = 'Async')],
        ['another entity type', (a: any) => (a.entityType = 'Tables')],
        ['another service', (a: any) => (a.servicecode = 'AmazonPolly')],
        [
            'a promotional usage type',
            (a: any) => (a.usagetype = 'USW2-promo-SyncTextPagesProcessed'),
        ],
        [
            'an async usage type',
            (a: any) => (a.usagetype = 'USW2-AsyncTextPagesProcessed'),
        ],
        [
            'a disagreeing page data type',
            (a: any) => (a.platopagedatatype = 'SyncTablesPagesProcessed'),
        ],
        ['an electronStatus', (a: any) => (a.electronStatus = 'Active')],
    ])('skips a product with %s', (_name, mutate) => {
        const doc = westCopy();
        mutate(doc.products[SYNC_TEXT_SKU].attributes);
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it('treats an explicit zero price as unusable rather than free', () => {
        const doc = westCopy();
        dimensionOf(doc).pricePerUnit.USD = '0.0000000000';
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it.each([
        [
            'a non-USD currency',
            (d: any) => (d.pricePerUnit = { EUR: '0.0015' }),
        ],
        [
            'an extra currency beside USD',
            (d: any) => (d.pricePerUnit.CNY = '0.01'),
        ],
        ['a non-page unit', (d: any) => (d.unit = 'Requests')],
        ['a zero end range', (d: any) => (d.endRange = '0')],
        ['a malformed end range', (d: any) => (d.endRange = '1M')],
        ['a missing end range', (d: any) => delete d.endRange],
        [
            'a scientific-notation price',
            (d: any) => (d.pricePerUnit.USD = '1.5e-3'),
        ],
        ['a negative price', (d: any) => (d.pricePerUnit.USD = '-0.0015')],
        ['a numeric price', (d: any) => (d.pricePerUnit.USD = 0.0015)],
        ['a mismatched rate code', (d: any) => (d.rateCode = 'OTHER.RATE')],
        ['a non-empty appliesTo', (d: any) => (d.appliesTo = ['X'])],
    ])('rejects a first tier with %s', (_name, mutate) => {
        const doc = westCopy();
        mutate(dimensionOf(doc));
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it.each([
        ['a non-page unit', (d: any) => (d.unit = 'Requests')],
        [
            'a non-USD currency',
            (d: any) => (d.pricePerUnit = { EUR: '0.0006' }),
        ],
        ['a mismatched rate code', (d: any) => (d.rateCode = 'OTHER.RATE')],
    ])('rejects the term when a later tier has %s', (_name, mutate) => {
        const doc = westCopy();
        mutate(dimensionOf(doc, SECOND_TIER));
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it('rejects a term with no first tier, or with two', () => {
        const missing = westCopy();
        delete termOf(missing).priceDimensions[FIRST_TIER];
        expect(parseTextractPriceList(missing, 'us-west-2', NOW)).toBe(
            undefined,
        );

        const doubled = westCopy();
        dimensionOf(doubled, SECOND_TIER).beginRange = '0';
        expect(parseTextractPriceList(doubled, 'us-west-2', NOW)).toBe(
            undefined,
        );
    });

    it('skips a term that has not taken effect yet', () => {
        const doc = westCopy();
        termOf(doc).effectiveDate = '2026-12-01T00:00:00Z';
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it('uses the in-effect term when a future price change is published beside it', () => {
        const doc = westCopy();
        const terms = doc.terms.OnDemand[SYNC_TEXT_SKU] as Record<string, any>;
        const future = structuredClone(termOf(doc));
        future.offerTermCode = 'FUTURETERM';
        future.effectiveDate = '2027-01-01T00:00:00Z';
        future.priceDimensions = Object.fromEntries(
            Object.values(future.priceDimensions as Record<string, any>).map(
                (dim, i) => {
                    const rateCode = `${SYNC_TEXT_SKU}.FUTURETERM.TIER${i}`;
                    return [
                        rateCode,
                        {
                            ...dim,
                            rateCode,
                            pricePerUnit: { USD: '0.0020000000' },
                        },
                    ];
                },
            ),
        );
        terms[`${SYNC_TEXT_SKU}.FUTURETERM`] = future;

        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(150000);
        // Once both are in effect the rate is ambiguous.
        expect(
            parseTextractPriceList(doc, 'us-west-2', Date.parse('2027-02-01')),
        ).toBe(undefined);
    });

    it.each([
        [
            'an unparseable effective date',
            (t: any) => (t.effectiveDate = 'soon'),
        ],
        [
            'term attributes',
            (t: any) => (t.termAttributes = { LeaseContractLength: '1yr' }),
        ],
        ['a mismatched SKU', (t: any) => (t.sku = ASYNC_TEXT_SKU)],
        ['a mismatched offer term code', (t: any) => (t.offerTermCode = 'X')],
    ])('rejects a term with %s', (_name, mutate) => {
        const doc = westCopy();
        mutate(termOf(doc));
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it('rejects two SKUs that both claim DetectDocumentText', () => {
        const doc = westCopy();
        const cloneSku = 'SYNCTEXTCLONE000';
        const clone = structuredClone(doc.products[SYNC_TEXT_SKU]);
        clone.sku = cloneSku;
        doc.products[cloneSku] = clone;
        const term = structuredClone(termOf(doc));
        term.sku = cloneSku;
        term.priceDimensions = Object.fromEntries(
            Object.entries(term.priceDimensions as Record<string, any>).map(
                ([key, dim]) => {
                    const rateCode = key.replace(SYNC_TEXT_SKU, cloneSku);
                    return [rateCode, { ...dim, rateCode }];
                },
            ),
        );
        doc.terms.OnDemand[cloneSku] = { [`${cloneSku}.JRTCKXETXF`]: term };
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it('rejects the rate when the product has no on-demand term', () => {
        const doc = westCopy();
        delete doc.terms.OnDemand[SYNC_TEXT_SKU];
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(undefined);
    });

    it('converts sub-microcent prices exactly', () => {
        const doc = westCopy();
        dimensionOf(doc).pricePerUnit.USD = '0.000000015';
        expect(parseTextractPriceList(doc, 'us-west-2', NOW)).toBe(1.5);
    });

    it.each([
        ['null', null],
        ['another service', { ...usWest2, offerCode: 'AmazonPolly' }],
        ['an unknown format', { ...usWest2, formatVersion: 'v2.0' }],
        ['missing on-demand terms', { ...usWest2, terms: {} }],
    ])('throws on %s', (_name, doc) => {
        expect(() => parseTextractPriceList(doc, 'us-west-2', NOW)).toThrow();
    });
});

describe('isTextractPriceRegion', () => {
    it('accepts plain AWS region codes only', () => {
        for (const region of ['us-west-2', 'eu-central-1', 'us-gov-west-1']) {
            expect(isTextractPriceRegion(region)).toBe(true);
        }
        for (const region of ['', 'US-WEST-2', '../us-west-2', 'us-west-2/x']) {
            expect(isTextractPriceRegion(region)).toBe(false);
        }
    });
});

describe('fetchTextractPriceList', () => {
    it('reads the region price list from the public AWS endpoint without following redirects', async () => {
        const fetchMock = vi.fn(async () => Response.json(usWest2));
        vi.stubGlobal('fetch', fetchMock);
        const signal = new AbortController().signal;

        await expect(fetchTextractPriceList('us-west-2', signal)).resolves.toBe(
            150000,
        );
        expect(fetchMock).toHaveBeenCalledWith(
            PRICE_LIST_URL('us-west-2'),
            expect.objectContaining({ signal, redirect: 'error' }),
        );
    });

    it('never requests an invalid region', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(
            fetchTextractPriceList('../../evil', new AbortController().signal),
        ).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an error status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('denied', { status: 403 })),
        );
        await expect(
            fetchTextractPriceList('us-west-2', new AbortController().signal),
        ).rejects.toThrow('403');
    });

    it('rejects a body over the size cap', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(' '.repeat(TEXTRACT_PRICE_LIST_MAX_BYTES + 1)),
            ),
        );
        await expect(
            fetchTextractPriceList('us-west-2', new AbortController().signal),
        ).rejects.toThrow('size cap');
    });

    it('rejects a body that is not JSON', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<html>')),
        );
        await expect(
            fetchTextractPriceList('us-west-2', new AbortController().signal),
        ).rejects.toThrow();
    });

    it('rejects a price list with no usable rate', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Response.json(usWest2)),
        );
        await expect(
            fetchTextractPriceList('us-east-1', new AbortController().signal),
        ).rejects.toThrow('no usable');
    });
});

describe('textractRates', () => {
    const CURATED = 150000;

    /** Serves each region's price list from `docs`, 404 for the rest. */
    const stubPriceLists = (docs: Record<string, unknown>) => {
        const fetchMock = vi.fn(async (url: string) => {
            const region = /\/current\/([^/]+)\/index\.json$/.exec(url)?.[1];
            const doc = region ? docs[region] : undefined;
            return doc
                ? Response.json(doc)
                : new Response('missing', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    };

    it('prices each region from its own price list', async () => {
        stubPriceLists({
            'us-west-2': usWest2,
            'eu-west-1': regionDoc('eu-west-1', '0.0020000000'),
        });
        const rates = textractRates(CURATED);

        expect(await rates.rate('us-west-2')).toBe(150000);
        expect(await rates.rate('eu-west-1')).toBe(200000);
        expect(rates.peek('us-west-2')).toBe(150000);
        expect(rates.peek('eu-west-1')).toBe(200000);
    });

    it('reports the curated rate for a region it has not loaded, without fetching', () => {
        const fetchMock = stubPriceLists({});
        expect(textractRates(CURATED).peek('us-west-2')).toBe(CURATED);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shares one fetch between concurrent callers and serves it until it expires', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const fetchMock = stubPriceLists({ 'us-west-2': usWest2 });
        const rates = textractRates(CURATED);

        expect(
            await Promise.all([
                rates.rate('us-west-2'),
                rates.rate('us-west-2'),
                rates.rate('us-west-2'),
            ]),
        ).toEqual([150000, 150000, 150000]);
        await rates.rate('us-west-2');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(16 * 60 * 1000);
        await rates.rate('us-west-2');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls back to the curated rate when a region has never loaded', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubPriceLists({});
        const rates = textractRates(CURATED);
        expect(await rates.rate('us-west-2')).toBe(CURATED);
        expect(rates.peek('us-west-2')).toBe(CURATED);
    });

    it('keeps a region on its last good rate when a refresh fails or loses the rate', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const docs: Record<string, unknown> = {
            'us-west-2': regionDoc('us-west-2', '0.0020000000'),
            'eu-west-1': regionDoc('eu-west-1', '0.0030000000'),
        };
        stubPriceLists(docs);
        const rates = textractRates(CURATED);
        expect(await rates.rate('us-west-2')).toBe(200000);
        expect(await rates.rate('eu-west-1')).toBe(300000);

        // One region's list drops the rate, the other's starts failing.
        const zeroed = regionDoc('us-west-2', '0.0000000000');
        docs['us-west-2'] = zeroed;
        delete docs['eu-west-1'];
        vi.advanceTimersByTime(16 * 60 * 1000);

        expect(await rates.rate('us-west-2')).toBe(200000);
        expect(await rates.rate('eu-west-1')).toBe(300000);
        expect(rates.peek('us-west-2')).toBe(200000);
    });

    it('returns a fixed number that a later refresh cannot change', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const docs: Record<string, unknown> = { 'us-west-2': usWest2 };
        stubPriceLists(docs);
        const rates = textractRates(CURATED);
        const captured = await rates.rate('us-west-2');

        docs['us-west-2'] = regionDoc('us-west-2', '0.0020000000');
        vi.advanceTimersByTime(16 * 60 * 1000);
        expect(await rates.rate('us-west-2')).toBe(200000);
        expect(captured).toBe(150000);
    });

    it('never fetches an invalid region and bounds how many regions it tracks', async () => {
        const fetchMock = stubPriceLists({
            'us-west-2': usWest2,
            'eu-west-1': regionDoc('eu-west-1', '0.0020000000'),
        });
        const rates = textractRates(CURATED, 1);

        expect(await rates.rate('../evil')).toBe(CURATED);
        expect(fetchMock).not.toHaveBeenCalled();

        expect(await rates.rate('us-west-2')).toBe(150000);
        // Past the cap a region is billed at the curated rate, unfetched.
        expect(await rates.rate('eu-west-1')).toBe(CURATED);
        expect(rates.peek('eu-west-1')).toBe(CURATED);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            PRICE_LIST_URL('us-west-2'),
            expect.anything(),
        );
    });
});
