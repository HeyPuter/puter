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
import pollyUsWest2 from './textToSpeech/fixtures/us-west-2.json';
import textractUsWest2 from './ocr/fixtures/textract-us-west-2.json';
import {
    fetchAwsPriceList,
    isAwsPriceRegion,
    onDemandRates,
    type OnDemandRateQuery,
} from './priceList.js';

// The fixtures' terms take effect on 2026-05-01.
const NOW = Date.parse('2026-10-13T00:00:00Z');

// Groups every product by its usage type and bills from a single flat tier.
const byUsageType: OnDemandRateQuery = {
    service: 'Polly',
    region: 'us-west-2',
    unit: 'Characters',
    now: NOW,
    group: (_product, attrs) =>
        typeof attrs.usagetype === 'string' ? attrs.usagetype : undefined,
    dimension: (dimensions) =>
        dimensions.length === 1 ? dimensions[0] : undefined,
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isAwsPriceRegion', () => {
    it('accepts plain AWS region codes only', () => {
        for (const region of ['us-west-2', 'ap-southeast-5', 'us-gov-west-1']) {
            expect(isAwsPriceRegion(region)).toBe(true);
        }
        for (const region of ['', 'US-WEST-2', '../us-west-2', 'us-west-2/x']) {
            expect(isAwsPriceRegion(region)).toBe(false);
        }
    });
});

describe('onDemandRates', () => {
    it('prices each group from its one in-effect term', () => {
        const rates = onDemandRates(pollyUsWest2, byUsageType);
        expect(rates.get('USW2-SynthesizeSpeech-Characters')).toBe(400);
        expect(rates.get('USW2-SynthesizeSpeechNeural-Characters')).toBe(1600);
    });

    it('leaves a group unpriced when two SKUs price it', () => {
        const rates = onDemandRates(pollyUsWest2, {
            ...byUsageType,
            group: () => 'all',
        });
        expect(rates.has('all')).toBe(true);
        expect(rates.get('all')).toBe(undefined);
    });

    it('only reads products in the service and region asked for', () => {
        expect(
            onDemandRates(pollyUsWest2, { ...byUsageType, region: 'us-east-1' })
                .size,
        ).toBe(0);
    });

    it('only reads dimensions priced in the unit asked for', () => {
        const rates = onDemandRates(pollyUsWest2, {
            ...byUsageType,
            unit: 'Pages',
        });
        expect([...rates.values()].every((rate) => rate === undefined)).toBe(
            true,
        );
    });

    it("throws on another service's price list", () => {
        expect(() => onDemandRates(textractUsWest2, byUsageType)).toThrow(
            'Not an AWS Polly price list',
        );
    });
});

describe('fetchAwsPriceList', () => {
    const fetchList = (region = 'us-west-2', maxBytes = 1024 * 1024) =>
        fetchAwsPriceList(
            'Textract',
            region,
            maxBytes,
            new AbortController().signal,
        );

    it("reads the service's region price list without following redirects", async () => {
        const fetchMock = vi.fn(async () => Response.json({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchList()).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonTextract/current/us-west-2/index.json',
            expect.objectContaining({ redirect: 'error' }),
        );
    });

    it('never requests an invalid region', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchList('../../evil')).rejects.toThrow('Invalid');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads a missing price list as null', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('NoSuchKey', { status: 404 })),
        );
        await expect(fetchList()).resolves.toBe(null);
    });

    it('rejects an error status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('denied', { status: 403 })),
        );
        await expect(fetchList()).rejects.toThrow('403');
    });

    it('rejects a body over the size cap', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(' '.repeat(65))),
        );
        await expect(fetchList('us-west-2', 64)).rejects.toThrow('size cap');
    });

    it('rejects a body that is not JSON', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<html>')),
        );
        await expect(fetchList()).rejects.toThrow();
    });
});
