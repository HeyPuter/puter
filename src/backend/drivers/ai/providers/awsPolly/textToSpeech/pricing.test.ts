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
import usEast1 from './fixtures/us-east-1.json';
import usWest2 from './fixtures/us-west-2.json';
import {
    fetchPollyPriceList,
    isPollyPriceRegion,
    parsePollyPriceList,
    POLLY_PRICE_LIST_MAX_BYTES,
} from './pricing.js';

// The fixtures are AWS's public price lists for the region, trimmed only of
// the attribute index; all their terms take effect on 2026-05-01.
const NOW = Date.parse('2026-10-13T00:00:00Z');

const STANDARD_SKU = 'XZARWA3E77CTTW3A';
const NEURAL_SKU = '9NHBTCP8TY24SED9';
const GENERATIVE_SKU = 'VZ4D3PNAPQ5WMXJ8';
const PROMO_GENERATIVE_SKU = '72CUXERTVPEGPMWC';

// Tests reshape the fixture freely, so it's handled as untyped JSON.
type Doc = Record<string, any>;
const westCopy = (): Doc => structuredClone(usWest2);

/** The one price dimension of a SKU's one on-demand term. */
const dimensionOf = (doc: Doc, sku: string) => {
    const term = Object.values(doc.terms.OnDemand[sku] as object)[0];
    return Object.values(term.priceDimensions as object)[0];
};
const termOf = (doc: Doc, sku: string) =>
    Object.values(doc.terms.OnDemand[sku] as object)[0];

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('parsePollyPriceList on the published price lists', () => {
    it('converts USD per character into exact microcents per engine', () => {
        expect(parsePollyPriceList(usWest2, 'us-west-2', NOW)).toEqual({
            standard: 400,
            neural: 1600,
            generative: 3000,
        });
        expect(parsePollyPriceList(usEast1, 'us-east-1', NOW)).toEqual({
            standard: 400,
            neural: 1600,
            'long-form': 10000,
            generative: 3000,
        });
    });

    it('ignores the zero-priced promotional generative offer', () => {
        // Without the regular SKU only the `ai-` zero offer is left.
        const doc = westCopy();
        delete (doc.products as Record<string, unknown>)[GENERATIVE_SKU];
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'generative',
        );
    });

    it('rejects a regular-looking SKU that carries an electronStatus', () => {
        const doc = westCopy();
        const promo = doc.products[PROMO_GENERATIVE_SKU];
        promo.attributes.usagetype =
            'USW2-SynthesizeSpeechGenerative-Characters';
        dimensionOf(doc, PROMO_GENERATIVE_SKU).pricePerUnit.USD =
            '0.0000100000';
        // The genuine SKU still prices generative; the flagged one is skipped.
        expect(parsePollyPriceList(doc, 'us-west-2', NOW).generative).toBe(
            3000,
        );
    });

    it('treats a regular SKU priced at zero as unusable rather than free', () => {
        const doc = westCopy();
        dimensionOf(doc, NEURAL_SKU).pricePerUnit.USD = '0.0000000000';
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('only reads products for the exact region asked for', () => {
        expect(parsePollyPriceList(usWest2, 'us-east-1', NOW)).toEqual({});
        expect(parsePollyPriceList(usWest2, 'us-west-2 ', NOW)).toEqual({});

        const doc = westCopy();
        doc.products[NEURAL_SKU].attributes.regionCode = 'us-west-1';
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('requires the usage type and engine attribute to agree', () => {
        const doc = westCopy();
        doc.products[NEURAL_SKU].attributes.engine = 'Generative';
        const rates = parsePollyPriceList(doc, 'us-west-2', NOW);
        expect(rates).not.toHaveProperty('neural');
        expect(rates.generative).toBe(3000);
    });

    it('skips other Polly usage families such as speech marks', () => {
        const doc = westCopy();
        doc.products[NEURAL_SKU].attributes.usagetype =
            'USW2-SynthesizeSpeechNeuralMarks-Characters';
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('skips a term that has not taken effect yet', () => {
        const doc = westCopy();
        termOf(doc, NEURAL_SKU).effectiveDate = '2026-12-01T00:00:00Z';
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('uses the in-effect term when a future price change is published beside it', () => {
        const doc = westCopy();
        const terms = doc.terms.OnDemand[NEURAL_SKU] as Record<string, any>;
        const future = structuredClone(Object.values(terms)[0]);
        future.offerTermCode = 'FUTURETERM';
        future.effectiveDate = '2027-01-01T00:00:00Z';
        const [oldKey, dim] = Object.entries(future.priceDimensions)[0] as [
            string,
            any,
        ];
        delete future.priceDimensions[oldKey];
        dim.rateCode = `${NEURAL_SKU}.FUTURETERM.6YS6EN2CT7`;
        dim.pricePerUnit.USD = '0.0000200000';
        future.priceDimensions[dim.rateCode] = dim;
        terms[`${NEURAL_SKU}.FUTURETERM`] = future;

        expect(parsePollyPriceList(doc, 'us-west-2', NOW).neural).toBe(1600);
        expect(
            parsePollyPriceList(doc, 'us-west-2', Date.parse('2027-02-01')),
        ).not.toHaveProperty('neural');
    });

    it.each([
        [
            'a non-USD currency',
            (d: any) => (d.pricePerUnit = { EUR: '0.000016' }),
        ],
        [
            'an extra currency beside USD',
            (d: any) => (d.pricePerUnit.CNY = '0.0001'),
        ],
        ['a non-character unit', (d: any) => (d.unit = 'Requests')],
        [
            'a tier that starts above zero',
            (d: any) => (d.beginRange = '1000000'),
        ],
        ['a capped tier', (d: any) => (d.endRange = '1000000')],
        [
            'a scientific-notation price',
            (d: any) => (d.pricePerUnit.USD = '1.6e-5'),
        ],
        ['a negative price', (d: any) => (d.pricePerUnit.USD = '-0.000016')],
        ['a numeric price', (d: any) => (d.pricePerUnit.USD = 0.000016)],
        ['a mismatched rate code', (d: any) => (d.rateCode = 'OTHER.RATE')],
        ['a non-empty appliesTo', (d: any) => (d.appliesTo = ['X'])],
    ])('falls back on %s', (_name, mutate) => {
        const doc = westCopy();
        mutate(dimensionOf(doc, NEURAL_SKU));
        const rates = parsePollyPriceList(doc, 'us-west-2', NOW);
        expect(rates).not.toHaveProperty('neural');
        expect(rates.standard).toBe(400);
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
        ['a mismatched SKU', (t: any) => (t.sku = STANDARD_SKU)],
    ])('falls back on a term with %s', (_name, mutate) => {
        const doc = westCopy();
        mutate(termOf(doc, NEURAL_SKU));
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('falls back when a term prices more than one tier', () => {
        const doc = westCopy();
        const term = termOf(doc, NEURAL_SKU);
        const first = dimensionOf(doc, NEURAL_SKU);
        first.endRange = '1000000';
        const second = { ...first, beginRange: '1000000', endRange: 'Inf' };
        second.rateCode = `${NEURAL_SKU}.JRTCKXETXF.SECONDTIER`;
        second.pricePerUnit = { USD: '0.0000080000' };
        term.priceDimensions[second.rateCode] = second;
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('falls back when two SKUs price the same engine', () => {
        const doc = westCopy();
        const clone = structuredClone(doc.products[NEURAL_SKU]);
        clone.sku = 'NEURALCLONE00000';
        doc.products[clone.sku] = clone;
        const term = structuredClone(termOf(doc, NEURAL_SKU));
        term.sku = clone.sku;
        const dim = Object.values(term.priceDimensions)[0] as any;
        term.priceDimensions = {
            [`${clone.sku}.JRTCKXETXF.6YS6EN2CT7`]: {
                ...dim,
                rateCode: `${clone.sku}.JRTCKXETXF.6YS6EN2CT7`,
                pricePerUnit: { USD: '0.0000170000' },
            },
        };
        doc.terms.OnDemand[clone.sku] = {
            [`${clone.sku}.JRTCKXETXF`]: term,
        };
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('falls back when a product has no on-demand term', () => {
        const doc = westCopy();
        delete doc.terms.OnDemand[NEURAL_SKU];
        expect(parsePollyPriceList(doc, 'us-west-2', NOW)).not.toHaveProperty(
            'neural',
        );
    });

    it('converts sub-microcent prices exactly', () => {
        const doc = westCopy();
        dimensionOf(doc, NEURAL_SKU).pricePerUnit.USD = '0.000016125';
        expect(parsePollyPriceList(doc, 'us-west-2', NOW).neural).toBe(1612.5);
    });

    it.each([
        ['null', null],
        ['another service', { ...usWest2, offerCode: 'AmazonTextract' }],
        ['an unknown format', { ...usWest2, formatVersion: 'v2.0' }],
        ['missing on-demand terms', { ...usWest2, terms: {} }],
    ])('throws on %s', (_name, doc) => {
        expect(() => parsePollyPriceList(doc, 'us-west-2', NOW)).toThrow();
    });
});

describe('isPollyPriceRegion', () => {
    it('accepts plain AWS region codes only', () => {
        for (const region of ['us-west-2', 'ap-southeast-5', 'us-gov-west-1']) {
            expect(isPollyPriceRegion(region)).toBe(true);
        }
        for (const region of ['', 'US-WEST-2', '../us-west-2', 'us-west-2/x']) {
            expect(isPollyPriceRegion(region)).toBe(false);
        }
    });
});

describe('fetchPollyPriceList', () => {
    it('reads the region price list from the public AWS endpoint', async () => {
        const fetchMock = vi.fn(async () => Response.json(usWest2));
        vi.stubGlobal('fetch', fetchMock);
        const signal = new AbortController().signal;

        await expect(fetchPollyPriceList('us-west-2', signal)).resolves.toEqual(
            {
                standard: 400,
                neural: 1600,
                generative: 3000,
            },
        );
        expect(fetchMock).toHaveBeenCalledWith(
            'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPolly/current/us-west-2/index.json',
            expect.objectContaining({ signal }),
        );
    });

    it('never requests an invalid region', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(
            fetchPollyPriceList('../../evil', new AbortController().signal),
        ).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an error status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('denied', { status: 403 })),
        );
        await expect(
            fetchPollyPriceList('us-west-2', new AbortController().signal),
        ).rejects.toThrow('403');
    });

    it('rejects a body over the size cap', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(' '.repeat(POLLY_PRICE_LIST_MAX_BYTES + 1)),
            ),
        );
        await expect(
            fetchPollyPriceList('us-west-2', new AbortController().signal),
        ).rejects.toThrow('size cap');
    });

    it('rejects a body that is not JSON', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<html>')),
        );
        await expect(
            fetchPollyPriceList('us-west-2', new AbortController().signal),
        ).rejects.toThrow();
    });
});
