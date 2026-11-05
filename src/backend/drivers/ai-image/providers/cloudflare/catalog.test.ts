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

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';
import {
    CATALOG_TTL_MS,
    cachedRemoteCatalog,
} from '../../../ai-chat/utils/cachedRemoteCatalog.js';
import { fetchCloudflareImageCatalog } from './catalog.js';
import modelSearchFixture from './fixtures/model-search.json';
import {
    CLOUDFLARE_IMAGE_GENERATION_MODELS,
    type CloudflareImageModel,
} from './models.js';

// The fixture is a live `/ai/models/search?per_page=100` response trimmed to
// the curated image models plus one non-image model, keeping only `price`.

const config = {
    apiToken: 'cf-secret-token',
    accountId: 'acct-secret',
    apiBaseUrl: 'https://api.cloudflare.com/client/v4',
};
const PHOENIX = '@cf/leonardo/phoenix-1.0';
const LUCID = '@cf/leonardo/lucid-origin';
const SDXL = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const FLUX_2_DEV = '@cf/black-forest-labs/flux-2-dev';

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        ...init,
    });

type Entry = { name: string; properties?: unknown[] };

/**
 * The live fixture with `name`'s price property replaced (or removed when
 * `prices` is undefined).
 */
const withPrice = (
    name: string,
    prices?: unknown,
): typeof modelSearchFixture => {
    const body = structuredClone(modelSearchFixture);
    const entry = body.result.find((model) => model.name === name)! as Entry;
    entry.properties =
        prices === undefined ? [] : [{ property_id: 'price', value: prices }];
    return body;
};

const page = (result: Entry[], resultInfo?: Record<string, unknown>) => ({
    success: true,
    result,
    errors: [],
    messages: [],
    ...(resultInfo ? { result_info: resultInfo } : {}),
});

const priced = (name: string, prices: unknown[]): Entry => ({
    name,
    properties: [{ property_id: 'price', value: prices }],
});

const fetchCatalog = (previous?: CloudflareImageModel[]) =>
    fetchCloudflareImageCatalog(config, new AbortController().signal, previous);

const costsOf = (models: CloudflareImageModel[], id: string) =>
    models.find((model) => model.id === id)?.costs;

/**
 * Curated models with Phoenix at a previously fetched rate, standing in for the
 * last good catalog.
 */
const lastGood = CLOUDFLARE_IMAGE_GENERATION_MODELS.map((model) =>
    model.id === PHOENIX
        ? { ...model, costs: { tile_512: 600000, step: 12000 } }
        : model,
);

describe('fetchCloudflareImageCatalog', () => {
    it('reprices the five supported models from the live response and keeps unpriced FLUX entries', async () => {
        fetchSpy.mockResolvedValueOnce(json(modelSearchFixture));
        const previous = CLOUDFLARE_IMAGE_GENERATION_MODELS.map((model) => ({
            ...model,
            costs: Object.fromEntries(
                Object.keys(model.costs).map((key) => [key, 1]),
            ),
        }));
        const models = await fetchCatalog(previous);

        expect(costsOf(models, PHOENIX)).toEqual({
            tile_512: 583000,
            step: 11000,
        });
        // 0.000132 USD is 13200 microcents exactly, not 13200.000000000002.
        expect(costsOf(models, LUCID)).toEqual({
            tile_512: 700000,
            step: 13200,
        });
        for (const id of [
            '@cf/bytedance/stable-diffusion-xl-lightning',
            SDXL,
            '@cf/runwayml/stable-diffusion-v1-5-inpainting',
        ])
            expect(costsOf(models, id)).toEqual({ step: 0 });
        for (const id of [
            '@cf/black-forest-labs/flux-1-schnell',
            FLUX_2_DEV,
            '@cf/black-forest-labs/flux-2-klein-4b',
            '@cf/black-forest-labs/flux-2-klein-9b',
        ])
            expect(costsOf(models, id)).toBe(costsOf(previous, id));
        // A short page ends the listing even though total_count is larger.
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(String(fetchSpy.mock.calls[0]![0])).toBe(
            'https://api.cloudflare.com/client/v4/accounts/acct-secret/ai/models/search?per_page=100&page=1',
        );
    });

    it('keeps the last good rates for a model omitted or left unpriced', async () => {
        const omitted = structuredClone(modelSearchFixture);
        omitted.result = omitted.result.filter(
            (model) => model.name !== PHOENIX,
        );
        fetchSpy
            .mockResolvedValueOnce(json(omitted))
            .mockResolvedValueOnce(json(withPrice(PHOENIX)));

        expect(costsOf(await fetchCatalog(lastGood), PHOENIX)).toEqual({
            tile_512: 600000,
            step: 12000,
        });
        expect(costsOf(await fetchCatalog(lastGood), PHOENIX)).toEqual({
            tile_512: 600000,
            step: 12000,
        });
    });

    it('accepts a published zero and identical duplicate units', async () => {
        fetchSpy.mockResolvedValueOnce(
            json(
                withPrice(PHOENIX, [
                    { unit: 'per 512 by 512 tile', price: 0, currency: 'USD' },
                    { unit: 'per step', price: 0.0001, currency: 'USD' },
                    { unit: 'per step', price: 0.0001, currency: 'USD' },
                ]),
            ),
        );
        expect(costsOf(await fetchCatalog(lastGood), PHOENIX)).toEqual({
            tile_512: 0,
            step: 10000,
        });
    });

    it.each([
        [
            'a non-USD currency',
            [
                { unit: 'per 512 by 512 tile', price: 0.005, currency: 'EUR' },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
            ],
        ],
        [
            'a missing currency',
            [
                { unit: 'per 512 by 512 tile', price: 0.005 },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
            ],
        ],
        [
            'a negative price',
            [
                { unit: 'per 512 by 512 tile', price: -0.005, currency: 'USD' },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
            ],
        ],
        [
            'a string price',
            [
                {
                    unit: 'per 512 by 512 tile',
                    price: '0.005',
                    currency: 'USD',
                },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
            ],
        ],
        [
            'a price that overflows microcents',
            [
                { unit: 'per 512 by 512 tile', price: 1e308, currency: 'USD' },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
            ],
        ],
        [
            'conflicting prices for one unit',
            [
                { unit: 'per 512 by 512 tile', price: 0.005, currency: 'USD' },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
                { unit: 'per step', price: 0.0002, currency: 'USD' },
            ],
        ],
        [
            'a missing unit',
            [{ unit: 'per step', price: 0.0001, currency: 'USD' }],
        ],
        [
            'an unknown extra unit',
            [
                { unit: 'per 512 by 512 tile', price: 0.005, currency: 'USD' },
                { unit: 'per step', price: 0.0001, currency: 'USD' },
                { unit: 'per output image', price: 0.01, currency: 'USD' },
            ],
        ],
        [
            'a non-array value',
            { unit: 'per step', price: 0.0001, currency: 'USD' },
        ],
        ['an empty list', []],
    ])('keeps the last good rates for %s', async (_case, prices) => {
        fetchSpy.mockResolvedValueOnce(json(withPrice(PHOENIX, prices)));
        expect(costsOf(await fetchCatalog(lastGood), PHOENIX)).toEqual({
            tile_512: 600000,
            step: 12000,
        });
    });

    it('keeps a step-only model when the response adds a tile price it cannot bill', async () => {
        const previous = CLOUDFLARE_IMAGE_GENERATION_MODELS.map((model) =>
            model.id === SDXL ? { ...model, costs: { step: 7 } } : model,
        );
        fetchSpy.mockResolvedValueOnce(
            json(
                withPrice(SDXL, [
                    {
                        unit: 'per 512 by 512 tile',
                        price: 0.005,
                        currency: 'USD',
                    },
                    { unit: 'per step', price: 0, currency: 'USD' },
                ]),
            ),
        );
        expect(costsOf(await fetchCatalog(previous), SDXL)).toEqual({
            step: 7,
        });
    });

    it('keeps curated rates when a model is listed twice or carries two price properties', async () => {
        const twice = structuredClone(modelSearchFixture);
        twice.result.push(
            priced(PHOENIX, [
                { unit: 'per 512 by 512 tile', price: 0.009, currency: 'USD' },
                { unit: 'per step', price: 0.0002, currency: 'USD' },
            ]) as never,
        );
        const twoProps = structuredClone(modelSearchFixture);
        (
            twoProps.result.find((model) => model.name === PHOENIX) as Entry
        ).properties!.push({
            property_id: 'price',
            value: [
                { unit: 'per 512 by 512 tile', price: 0.009, currency: 'USD' },
                { unit: 'per step', price: 0.0002, currency: 'USD' },
            ],
        });
        fetchSpy
            .mockResolvedValueOnce(json(twice))
            .mockResolvedValueOnce(json(twoProps));

        expect(costsOf(await fetchCatalog(lastGood), PHOENIX)).toEqual({
            tile_512: 600000,
            step: 12000,
        });
        expect(costsOf(await fetchCatalog(lastGood), PHOENIX)).toEqual({
            tile_512: 600000,
            step: 12000,
        });
    });

    it('ignores prices for billing schemes it does not reprice', async () => {
        fetchSpy.mockResolvedValueOnce(
            json(
                withPrice(FLUX_2_DEV, [
                    {
                        unit: 'per 512 by 512 tile',
                        price: 0.0001,
                        currency: 'USD',
                    },
                    { unit: 'per step', price: 0.0001, currency: 'USD' },
                ]),
            ),
        );
        expect(costsOf(await fetchCatalog(), FLUX_2_DEV)).toEqual({
            input_tile_512_per_step: 21000,
            output_tile_512_per_step: 41000,
        });
    });

    it('follows total_pages across pages', async () => {
        fetchSpy
            .mockResolvedValueOnce(
                json(
                    page(
                        [
                            priced(PHOENIX, [
                                {
                                    unit: 'per 512 by 512 tile',
                                    price: 0.006,
                                    currency: 'USD',
                                },
                                {
                                    unit: 'per step',
                                    price: 0.00012,
                                    currency: 'USD',
                                },
                            ]),
                        ],
                        { page: 1, per_page: 100, count: 1, total_pages: 2 },
                    ),
                ),
            )
            .mockResolvedValueOnce(
                json(
                    page(
                        [
                            priced(LUCID, [
                                {
                                    unit: 'per 512 by 512 tile',
                                    price: 0.008,
                                    currency: 'USD',
                                },
                                {
                                    unit: 'per step',
                                    price: 0.00014,
                                    currency: 'USD',
                                },
                            ]),
                        ],
                        { page: 2, per_page: 100, count: 1, total_pages: 2 },
                    ),
                ),
            );
        const models = await fetchCatalog();

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(String(fetchSpy.mock.calls[1]![0])).toMatch(/[?&]page=2$/);
        expect(costsOf(models, PHOENIX)).toEqual({
            tile_512: 600000,
            step: 12000,
        });
        expect(costsOf(models, LUCID)).toEqual({
            tile_512: 800000,
            step: 14000,
        });
    });

    it('requests the next page after a full page without result_info', async () => {
        const filler = Array.from({ length: 100 }, (_, i) => ({
            name: `@cf/filler/${i}`,
        }));
        fetchSpy
            .mockResolvedValueOnce(json(page(filler)))
            .mockResolvedValueOnce(
                json(
                    page([
                        priced(SDXL, [
                            {
                                unit: 'per step',
                                price: 0.00001,
                                currency: 'USD',
                            },
                        ]),
                    ]),
                ),
            );

        expect(costsOf(await fetchCatalog(), SDXL)).toEqual({ step: 1000 });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('rejects a listing that still has pages after the bounded number', async () => {
        // Page 1 prices Phoenix; an unread page could list it again, which
        // would have kept the last good rate, so nothing here is published.
        fetchSpy.mockImplementation(async (url) => {
            const n = Number(new URL(String(url)).searchParams.get('page'));
            return json(
                page(
                    n === 1
                        ? [
                              priced(PHOENIX, [
                                  {
                                      unit: 'per 512 by 512 tile',
                                      price: 0.01,
                                      currency: 'USD',
                                  },
                                  {
                                      unit: 'per step',
                                      price: 0.0002,
                                      currency: 'USD',
                                  },
                              ]),
                          ]
                        : [{ name: `@cf/filler/${n}` }],
                    { page: n, total_pages: 1000 },
                ),
            );
        });
        await expect(fetchCatalog(lastGood)).rejects.toThrow(
            /exceeded 10 pages/,
        );
        expect(fetchSpy).toHaveBeenCalledTimes(10);
    });

    it('keeps serving the last good catalog when a refresh hits the page cap', async () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const catalog = cachedRemoteCatalog({
                name: 'Cloudflare image pricing',
                fallback: CLOUDFLARE_IMAGE_GENERATION_MODELS,
                fetch: (signal, previous) =>
                    fetchCloudflareImageCatalog(config, signal, previous),
            });
            fetchSpy.mockResolvedValueOnce(
                json(
                    withPrice(PHOENIX, [
                        {
                            unit: 'per 512 by 512 tile',
                            price: 0.006,
                            currency: 'USD',
                        },
                        { unit: 'per step', price: 0.00012, currency: 'USD' },
                    ]),
                ),
            );
            expect(costsOf(await catalog(), PHOENIX)).toEqual({
                tile_512: 600000,
                step: 12000,
            });

            fetchSpy.mockImplementation(async (url) => {
                const n = Number(new URL(String(url)).searchParams.get('page'));
                return json(
                    page(
                        [
                            priced(PHOENIX, [
                                {
                                    unit: 'per 512 by 512 tile',
                                    price: 0.01,
                                    currency: 'USD',
                                },
                                {
                                    unit: 'per step',
                                    price: 0.0002,
                                    currency: 'USD',
                                },
                            ]),
                        ],
                        { page: n, total_pages: 1000 },
                    ),
                );
            });
            vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
            expect(costsOf(await catalog(), PHOENIX)).toEqual({
                tile_512: 600000,
                step: 12000,
            });
            expect(fetchSpy).toHaveBeenCalledTimes(11);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        ['an HTTP error', () => new Response('denied', { status: 403 })],
        [
            'success:false',
            () =>
                json({
                    success: false,
                    result: [],
                    errors: [{ message: 'bad' }],
                }),
        ],
        ['a non-array result', () => json({ success: true, result: {} })],
        ['an empty listing', () => json(page([]))],
        [
            'a mismatched page number',
            () => json(page([{ name: SDXL }], { page: 2 })),
        ],
        ['malformed JSON', () => new Response('{not json')],
        [
            'a declared oversized body',
            () =>
                new Response('{}', {
                    headers: { 'content-length': String(3 * 1024 * 1024) },
                }),
        ],
        [
            'a streamed oversized body',
            () =>
                new Response(
                    JSON.stringify({
                        success: true,
                        result: [],
                        pad: 'x'.repeat(3 * 1024 * 1024),
                    }),
                ),
        ],
    ])(
        'rejects %s without exposing the account or token',
        async (_case, respond) => {
            fetchSpy.mockResolvedValueOnce(respond());
            const error = await fetchCatalog().catch((e: Error) => e);
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).not.toMatch(
                /acct-secret|cf-secret-token/,
            );
        },
    );

    it('does not mutate the previous catalog it reprices', async () => {
        const pristine = structuredClone(CLOUDFLARE_IMAGE_GENERATION_MODELS);
        fetchSpy.mockResolvedValueOnce(
            json(
                withPrice(PHOENIX, [
                    {
                        unit: 'per 512 by 512 tile',
                        price: 0.01,
                        currency: 'USD',
                    },
                    { unit: 'per step', price: 0.0002, currency: 'USD' },
                ]),
            ),
        );
        await fetchCatalog();
        expect(CLOUDFLARE_IMAGE_GENERATION_MODELS).toEqual(pristine);
    });
});
