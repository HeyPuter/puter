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

/**
 * Offline unit tests for CloudflareImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs CloudflareImageProvider directly against the live wired
 * `MeteringService` so the recording side is exercised end-to-end. Cloudflare
 * has no SDK — the provider hits the REST API directly via global `fetch`,
 * which we stub. That's the real network egress point.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { CLOUDFLARE_IMAGE_GENERATION_MODELS } from './models.js';
import { CloudflareImageProvider } from './CloudflareImageProvider.js';

// Keep URL downloads offline; other input parsing stays real.
const { fetchImageBytesMock } = vi.hoisted(() => ({
    fetchImageBytesMock: vi.fn(),
}));

vi.mock('../../inputImage.js', async (orig) => ({
    ...(await orig<typeof import('../../inputImage.js')>()),
    fetchImageBytes: fetchImageBytesMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let fetchSpy: MockInstance<typeof fetch>;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let batchIncrementUsagesSpy: MockInstance<
    MeteringService['batchIncrementUsages']
>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (
    overrides: Partial<{
        apiToken: string;
        accountId: string;
        apiBaseUrl: string;
    }> = {},
) =>
    new CloudflareImageProvider(
        {
            apiToken: 'cf-test-token',
            accountId: 'acct-test',
            ...overrides,
        } as never,
        server.services.metering,
    );

beforeEach(() => {
    fetchImageBytesMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    batchIncrementUsagesSpy = vi.spyOn(
        server.services.metering,
        'batchIncrementUsages',
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

const okJsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });

// ── Construction ────────────────────────────────────────────────────

describe('CloudflareImageProvider construction', () => {
    it('does not call out at construction (lazy fetch)', () => {
        makeProvider();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('CloudflareImageProvider model catalog', () => {
    it('returns the @cf/black-forest-labs/flux-1-schnell default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            '@cf/black-forest-labs/flux-1-schnell',
        );
    });

    it('exposes the static CLOUDFLARE_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(CLOUDFLARE_IMAGE_GENERATION_MODELS);
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('CloudflareImageProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the network', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({ prompt: 'something', test_mode: true }),
        );

        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('CloudflareImageProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or empty', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.generate({ prompt: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('CloudflareImageProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting Cloudflare when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Request shape ──────────────────────────────────────────────────

describe('CloudflareImageProvider.generate request shape', () => {
    it('sends only fields supported by Schnell to its account-scoped endpoint', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({
                result: {
                    image: 'AAAA', // base64
                },
            }),
        );

        await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'a tiny red dot',
                imageSize: { w: 1024, h: 1024, kind: 'pixels' },
            } as never),
        );

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchSpy.mock.calls[0]!;
        expect(String(calledUrl)).toBe(
            'https://api.cloudflare.com/client/v4/accounts/acct-test/ai/run/@cf/black-forest-labs/flux-1-schnell',
        );
        expect(init?.method).toBe('POST');
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer cf-test-token');
        expect(headers['Content-Type']).toBe('application/json');
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ prompt: 'a tiny red dot', steps: 4 });
    });

    it('honours an apiBaseUrl override', async () => {
        const provider = makeProvider({
            apiBaseUrl: 'https://custom.cf.example/api/v4',
        });
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AA' } }),
        );

        await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
            } as never),
        );

        const [calledUrl] = fetchSpy.mock.calls[0]!;
        expect(String(calledUrl)).toMatch(
            /^https:\/\/custom\.cf\.example\/api\/v4\/accounts\/acct-test\/ai\/run\/@cf\//,
        );
    });

    it('uses multipart FormData when the model has requiresMultipart=true', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response(Buffer.from([1, 2, 3]).buffer, {
                status: 200,
                headers: { 'content-type': 'image/png' },
            }),
        );

        await withTestActor(() =>
            provider.generate({
                // flux-2-dev has requiresMultipart=true.
                model: '@cf/black-forest-labs/flux-2-dev',
                prompt: 'hi',
                imageSize: { w: 1024, h: 1024, kind: 'pixels' },
            } as never),
        );

        const [, init] = fetchSpy.mock.calls[0]!;
        expect(init?.body).toBeInstanceOf(FormData);
        const headers = init?.headers as Record<string, string>;
        // Multipart path must NOT set Content-Type — runtime sets the boundary.
        expect(headers['Content-Type']).toBeUndefined();
        const form = init?.body as FormData;
        expect(form.get('prompt')).toBe('hi');
        expect(form.get('width')).toBe('1024');
        expect(form.get('height')).toBe('1024');
    });

    it('clamps Schnell steps to [1,8]', async () => {
        const provider = makeProvider();

        // High clamp.
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AA' } }),
        );
        await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
                steps: 999,
            } as never),
        );
        expect(
            JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).steps,
        ).toBe(8);

        // Low clamp.
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AA' } }),
        );
        await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
                steps: 0,
            } as never),
        );
        expect(
            JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string).steps,
        ).toBe(1);
    });
});

// ── Output extraction ──────────────────────────────────────────────

describe('CloudflareImageProvider.generate output extraction', () => {
    it('returns a base64 data URL when the response is a binary image/*', async () => {
        const provider = makeProvider();
        const bytes = new Uint8Array([0xff, 0xd8, 0xff]); // jpeg-ish header
        fetchSpy.mockResolvedValueOnce(
            new Response(bytes.buffer, {
                status: 200,
                headers: { 'content-type': 'image/jpeg' },
            }),
        );

        const result = await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
            } as never),
        );

        expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);
        expect(result).toContain(Buffer.from(bytes).toString('base64'));
    });

    it('extracts a base64 image from a JSON envelope and prefixes the right MIME', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AAAA' } }),
        );

        const result = await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
                output_format: 'webp',
            } as never),
        );

        expect(result).toBe('data:image/jpeg;base64,AAAA');
    });

    it('passes through an http(s) URL or data URL straight from the JSON envelope', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: 'https://example.com/img.png' }),
        );

        const result = await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
            } as never),
        );

        expect(result).toBe('https://example.com/img.png');
    });

    it('throws 400 when JSON response carries success:false', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({
                success: false,
                errors: [{ message: 'rate limited' }],
            }),
        );

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: '@cf/black-forest-labs/flux-1-schnell',
                    prompt: 'hi',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 with the upstream error message on a non-2xx response', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: 'boom' }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: '@cf/black-forest-labs/flux-1-schnell',
                    prompt: 'hi',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when JSON response carries no usable image string', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(okJsonResponse({ result: {} }));

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: '@cf/black-forest-labs/flux-1-schnell',
                    prompt: 'hi',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Cost components & metering ─────────────────────────────────────

describe('CloudflareImageProvider.generate cost components', () => {
    it('tile-plus-step (FLUX.1 Schnell): bills tile_512×count + step×4', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AA' } }),
        );

        await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-1-schnell',
                prompt: 'hi',
                imageSize: { w: 1024, h: 1024, kind: 'pixels' }, // 2x2 tiles = 4
            } as never),
        );

        // schnell costs (microcents): tile_512=5280, step=10560 (defaultSteps=4).
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const byKey = Object.fromEntries(
            (
                entries as Array<{
                    usageType: string;
                    usageAmount: number;
                    costOverride: number;
                }>
            ).map((e) => [e.usageType.split(':').pop()!, e]),
        );
        expect(byKey.tile_512.usageAmount).toBe(4);
        expect(byKey.tile_512.costOverride).toBe(4 * 5280);
        expect(byKey.step.usageAmount).toBe(4);
        expect(byKey.step.costOverride).toBe(4 * 10560);
    });

    it('flux2-klein-9b-mp: splits cost into first_mp / subsequent_mp / input_image_mp', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response(Buffer.from([1, 2, 3]).buffer, {
                status: 200,
                headers: { 'content-type': 'image/png' },
            }),
        );

        await withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-2-klein-9b',
                prompt: 'hi',
                // 2 MP image to exercise both first_mp and subsequent_mp.
                imageSize: { w: 2000, h: 1000, kind: 'pixels' },
                image: 'data:image/png;base64,AAAA', // hasInputImage=true
            } as never),
        );

        // first_mp=1500000, subsequent_mp=200000, input_image_mp=200000.
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const types = (
            entries as Array<{ usageType: string; usageAmount: number }>
        ).map((e) => e.usageType);
        expect(types).toEqual(
            expect.arrayContaining([
                expect.stringContaining(':first_mp'),
                expect.stringContaining(':subsequent_mp'),
                expect.stringContaining(':input_image_mp'),
            ]),
        );
    });
});

// ── input_images (canonical image-to-image field) ──────────────────

describe('CloudflareImageProvider.generate input_images', () => {
    const klein9bWith = (extra: Record<string, unknown>) => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response(Buffer.from([1, 2, 3]).buffer, {
                status: 200,
                headers: { 'content-type': 'image/png' },
            }),
        );
        return withTestActor(() =>
            provider.generate({
                model: '@cf/black-forest-labs/flux-2-klein-9b',
                prompt: 'edit it',
                imageSize: { w: 2000, h: 1000, kind: 'pixels' },
                ...extra,
            } as never),
        );
    };

    const hasInputCostLine = () => {
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        return (entries as Array<{ usageType: string }>).some((e) =>
            e.usageType.endsWith(':input_image_mp'),
        );
    };

    it('maps a base64/data-URI input_images entry to the input image (cost line appears)', async () => {
        await klein9bWith({ input_images: ['data:image/png;base64,AAAA'] });
        expect(hasInputCostLine()).toBe(true);
    });

    it('maps a singular input_image to the input image', async () => {
        await klein9bWith({ input_image: 'data:image/png;base64,AAAA' });
        expect(hasInputCostLine()).toBe(true);
    });

    it('fetches an http(s) URL input via secureFetch and uses it as the input image', async () => {
        fetchImageBytesMock.mockResolvedValueOnce({
            bytes: Buffer.from('AAAA', 'base64'),
            mime: 'image/png',
        });
        await klein9bWith({ input_images: ['https://example.com/in.png'] });
        expect(fetchImageBytesMock).toHaveBeenCalledWith(
            'https://example.com/in.png',
        );
        expect(hasInputCostLine()).toBe(true);
    });

    it('throws 400 when more than one input image is supplied (before any fetch)', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({
                    model: '@cf/black-forest-labs/flux-2-klein-9b',
                    prompt: 'edit it',
                    imageSize: { w: 1024, h: 1024, kind: 'pixels' },
                    input_images: [
                        'data:image/png;base64,AAAA',
                        'data:image/png;base64,BBBB',
                    ],
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(fetchImageBytesMock).not.toHaveBeenCalled();
    });
});

describe('CloudflareImageProvider reference transport', () => {
    it('labels a FLUX.2 JPEG response with its actual MIME type', async () => {
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: '/9j/4A==' } }),
        );
        const result = await withTestActor(() =>
            makeProvider().generate({
                model: '@cf/black-forest-labs/flux-2-klein-4b',
                prompt: 'a landscape',
            }),
        );
        expect(result).toBe('data:image/jpeg;base64,/9j/4A==');
    });

    it('uploads decoded image bytes using the FLUX.2 multipart field', async () => {
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AAAA' } }),
        );
        await withTestActor(() =>
            makeProvider().generate({
                model: '@cf/black-forest-labs/flux-2-klein-4b',
                prompt: 'a landscape',
                input_images: ['data:image/png;base64,AQID'],
                steps: 40,
            }),
        );
        const form = fetchSpy.mock.calls[0][1]!.body as FormData;
        const input = form.get('input_image_0') as File;
        expect(input.type).toBe('image/png');
        expect([...new Uint8Array(await input.arrayBuffer())]).toEqual([
            1, 2, 3,
        ]);
        expect(form.has('image')).toBe(false);
        expect(form.has('steps')).toBe(false);
    });

    it('rejects image inputs on text-only models before a provider request', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: 'a landscape',
                    input_image: 'AAAA',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('Cloudflare legacy image option', () => {
    it.each([{ url: 'https://example.com/in.png' }, 123, ['AAAA']])(
        'rejects a non-string image %j as 400 before any upstream call',
        async (image) => {
            await expect(
                withTestActor(() =>
                    makeProvider().generate({
                        model: '@cf/black-forest-labs/flux-2-dev',
                        prompt: 'hi',
                        image,
                    } as never),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(hasCreditsSpy).not.toHaveBeenCalled();
        },
    );

    it('rejects an input that decodes to zero bytes instead of uploading it', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    model: '@cf/black-forest-labs/flux-2-dev',
                    prompt: 'hi',
                    input_images: ['data:image/png;base64,'],
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Invalid input image (empty or not base64)',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(hasCreditsSpy).not.toHaveBeenCalled();
    });
});

describe('Cloudflare size bounds', () => {
    it.each([
        { w: 4, h: 1 },
        { w: 1, h: 4 },
        { w: 32, h: 1 },
    ])('fits an aspect hint %j inside FLUX.2 side limits', async (ratio) => {
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AAAA' } }),
        );
        await withTestActor(() =>
            makeProvider().generate({
                model: '@cf/black-forest-labs/flux-2-klein-4b',
                prompt: 'hi',
                imageSize: { ...ratio, kind: 'aspect' },
            }),
        );
        const body = fetchSpy.mock.calls[0][1]!.body as FormData;
        for (const side of ['width', 'height']) {
            expect(Number(body.get(side))).toBeGreaterThanOrEqual(256);
            expect(Number(body.get(side))).toBeLessThanOrEqual(1920);
        }
    });
});

it.each([
    { model: '@cf/leonardo/lucid-origin', negative: false },
    { model: '@cf/leonardo/phoenix-1.0', negative: true },
])(
    'sends the supported JSON fields for $model',
    async ({ model, negative }) => {
        fetchSpy.mockResolvedValueOnce(
            okJsonResponse({ result: { image: 'AAAA' } }),
        );
        await withTestActor(() =>
            makeProvider().generate({
                model,
                prompt: 'hi',
                imageSize: { w: 1024, h: 768, kind: 'pixels' },
                steps: 12,
                seed: 42,
                guidance: 4,
                negative_prompt: 'blur',
            }),
        );
        expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
            prompt: 'hi',
            width: 1024,
            height: 768,
            num_steps: 12,
            seed: 42,
            guidance: 4,
            ...(negative ? { negative_prompt: 'blur' } : {}),
        });
    },
);

it('meters the bounded FLUX.2 dimensions sent upstream', async () => {
    fetchSpy.mockResolvedValueOnce(
        okJsonResponse({ result: { image: 'AAAA' } }),
    );
    await withTestActor(() =>
        makeProvider().generate({
            model: '@cf/black-forest-labs/flux-2-klein-4b',
            prompt: 'hi',
            imageSize: { w: 32, h: 1, kind: 'aspect' },
        }),
    );
    const body = fetchSpy.mock.calls[0][1]!.body as FormData;
    expect(body.get('width')).toBe('1920');
    expect(body.get('height')).toBe('256');
    expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual([
        expect.objectContaining({
            usageType: expect.stringContaining(':input_tile_512'),
            usageAmount: 4,
            costOverride: 23600,
        }),
        expect.objectContaining({
            usageType: expect.stringContaining(':output_tile_512'),
            usageAmount: 4,
            costOverride: 114800,
        }),
    ]);
});

describe('Cloudflare priced legacy models', () => {
    it('sends image and mask bytes to inpainting and preserves a published zero price', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
        await withTestActor(() => makeProvider().generate({
            model: '@cf/runwayml/stable-diffusion-v1-5-inpainting', prompt: 'A cup',
            input_images: ['data:image/png;base64,AQID'], maskImage: 'data:image/png;base64,BAUG',
            imageSize: { kind: 'pixels', w: 512, h: 512 },
        }));
        expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toMatchObject({ image: [1, 2, 3], mask: [4, 5, 6], num_steps: 20, width: 512, height: 512 });
        expect(hasCreditsSpy).toHaveBeenCalledWith(expect.anything(), 0);
    });

    it('rejects missing inpainting inputs before credit checks', async () => {
        await expect(withTestActor(() => makeProvider().generate({ model: '@cf/runwayml/stable-diffusion-v1-5-inpainting', prompt: 'A cup' }))).rejects.toMatchObject({ statusCode: 400 });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each(['@cf/bytedance/stable-diffusion-xl-lightning', '@cf/stabilityai/stable-diffusion-xl-base-1.0'])(
        'rejects an input image on %s, which Cloudflare serves text-to-image only', async (model) => {
            await expect(withTestActor(() => makeProvider().generate({
                model, prompt: 'A cup', input_image: 'data:image/png;base64,AQID',
            }))).rejects.toMatchObject({ statusCode: 400 });
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it('charges Lucid at the price returned by the model API', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
        await withTestActor(() => makeProvider().generate({ model: '@cf/leonardo/lucid-origin', prompt: 'A cup', imageSize: { kind: 'pixels', w: 512, h: 512 }, steps: 1 }));
        expect(hasCreditsSpy).toHaveBeenCalledWith(expect.anything(), 713200);
    });
});
