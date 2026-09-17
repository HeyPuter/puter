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
 * Offline unit tests for TogetherImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs TogetherImageProvider directly against the live wired
 * `MeteringService` so the recording side is exercised end-to-end. The Together
 * SDK is mocked at the module boundary — that's the real network egress point.
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
import { TogetherImageProvider } from './TogetherImageProvider.js';
import { TOGETHER_IMAGE_GENERATION_MODELS } from './models.js';

// ── Together SDK mock ───────────────────────────────────────────────

const { generateMock, togetherCtor } = vi.hoisted(() => ({
    generateMock: vi.fn(),
    togetherCtor: vi.fn(),
}));

vi.mock('together-ai', () => {
    const TogetherCtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        togetherCtor(opts);
        this.images = { generate: generateMock };
        // Boot-time noise from sibling chat provider — keep happy.
        this.chat = { completions: { create: vi.fn() } };
        this.models = { list: vi.fn() };
    });
    return { Together: TogetherCtor, default: TogetherCtor };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () =>
    new TogetherImageProvider({ apiKey: 'test-key' }, server.services.metering);

beforeEach(() => {
    generateMock.mockReset();
    togetherCtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('TogetherImageProvider construction', () => {
    it('constructs the Together SDK with the configured api key', () => {
        makeProvider();
        expect(togetherCtor).toHaveBeenCalledTimes(1);
        expect(togetherCtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new TogetherImageProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('TogetherImageProvider model catalog', () => {
    it('returns the togetherai-prefixed default model id', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            'togetherai:black-forest-labs/FLUX.2-dev',
        );
    });

    it('exposes the static TOGETHER_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(TOGETHER_IMAGE_GENERATION_MODELS);
    });

    it('gives every catalog entry the bare shorthand alias older entries carry', () => {
        for (const model of TOGETHER_IMAGE_GENERATION_MODELS) {
            const shorthand = model.id.replace('togetherai:', '').split('/').at(-1)!;
            expect(model.aliases, model.id).toContain(shorthand);
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('TogetherImageProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({
                prompt: 'something',
                test_mode: true,
            }),
        );

        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('TogetherImageProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or empty', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: '' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: undefined as unknown as string }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('TogetherImageProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting Together when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi' }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        expect(generateMock).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Pricing branches ───────────────────────────────────────────────

describe('TogetherImageProvider.generate pricing units', () => {
    const sampleResponse = { data: [{ url: 'https://t.ai/img/1' }] };

    it('per-MP: bills width*height/1e6 megapixels at the model 1MP rate', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        // Qwen-Image is per-MP @ 0.58 cents/MP.
        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'hello',
                imageSize: { w: 1024, h: 1024, kind: 'pixels' },
            }),
        );

        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);

        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('togetherai:Qwen/Qwen-Image:1MP');
        const expectedMP = (1024 * 1024) / 1_000_000;
        expect(amount).toBeCloseTo(expectedMP);
        expect(cost).toBeCloseTo(0.58 * expectedMP * 1_000_000);
    });

    it('per-image: bills exactly one image at the model per-image rate', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        // Wan2.6-image is per-image @ 3 cents.
        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Wan-AI/Wan2.6-image',
                prompt: 'hi',
            }),
        );

        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('togetherai:Wan-AI/Wan2.6-image:per-image');
        expect(amount).toBe(1);
        expect(cost).toBe(3 * 1_000_000);
    });

    it('per-tier: picks the tier matching `quality` and resolves the resolution map', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        // gemini-3-pro-image is per-tier @ 1K=13.4, 4K=24.
        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:google/gemini-3-pro-image',
                prompt: 'hi',
                imageSize: { w: 1, h: 1, kind: 'aspect' },
                quality: '4K',
            }),
        );

        // Cost branch: tier '4K' = 24 cents.
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('togetherai:google/gemini-3-pro-image:4K');
        expect(amount).toBe(1);
        expect(cost).toBe(24 * 1_000_000);

        // resolution_map should have rewritten 1:1 + 4K to 4096x4096.
        const sentArgs = generateMock.mock.calls[0]![0];
        expect(sentArgs.width).toBe(4096);
        expect(sentArgs.height).toBe(4096);
    });
});

// ── Request shape ──────────────────────────────────────────────────

describe('TogetherImageProvider.generate request shape', () => {
    const sampleResponse = { data: [{ url: 'https://t.ai/img/1' }] };

    it('strips togetherai: prefix from the wire model id and snaps dimensions to multiples of 8 (>=64)', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'hi',
                imageSize: { w: 50, h: 130, kind: 'pixels' }, // expect snap to {64,128}
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.model).toBe('Qwen/Qwen-Image');
        expect(sent.width).toBe(64);
        expect(sent.height).toBe(128);
        expect(sent.n).toBe(1);
    });

    it('forwards optional knobs: steps clamp, seed round, negative_prompt, response_format, image_url, prompt_strength, disable_safety_checker', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'hi',
                steps: 999, // clamps to 50
                seed: 42.7, // rounds to 43
                negative_prompt: 'no clouds',
                response_format: 'url',
                image_url: 'https://example/in.png',
                prompt_strength: 1.5, // clamps to 1
                disable_safety_checker: true,
            } as never),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.steps).toBe(50);
        expect(sent.seed).toBe(43);
        expect(sent.negative_prompt).toBe('no clouds');
        expect(sent.response_format).toBe('url');
        expect(sent.image_url).toBe('https://example/in.png');
        expect(sent.prompt_strength).toBe(1);
        expect(sent.disable_safety_checker).toBe(true);
    });

    it('aliases input_image into image_base64 on the wire payload', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'edit it',
                // canonical key the driver layer accepts; provider mirrors it
                // to the SDK's `image_base64` field.
                input_image: 'BASE64DATA',
            } as never),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.image_base64).toBe('BASE64DATA');
    });

    it('routes a base64 input_images entry to image_base64', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'edit it',
                input_images: ['BASE64DATA'],
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.image_base64).toBe('BASE64DATA');
    });

    it('routes a URL input_images entry to the native image_url field (no fetch)', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'edit it',
                input_images: ['https://example.com/in.png'],
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.image_url).toBe('https://example.com/in.png');
        expect(sent.image_base64).toBeUndefined();
    });

    it('throws 400 when more than one input image is supplied', async () => {
        const provider = makeProvider();

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'togetherai:Qwen/Qwen-Image',
                    prompt: 'edit it',
                    input_images: ['BASE64A', 'BASE64B'],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Output extraction & error mapping ───────────────────────────────

describe('TogetherImageProvider.generate output handling', () => {
    it('falls back to a base64 data URL when SDK returns b64_json instead of url', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({ data: [{ b64_json: 'AAAA' }] });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'hi',
            }),
        );

        expect(result).toBe('data:image/png;base64,AAAA');
    });

    it('lets SDK errors bubble untouched so the driver boundary can classify them', async () => {
        const provider = makeProvider();
        // Together's SDK errors carry a `.status` field — re-wrapping
        // them in a plain Error stripped that out and caused the
        // catch-all `translateProviderError` to fall through to 500.
        const apiError = Object.assign(new Error('upstream blew up'), {
            status: 400,
        });
        generateMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'togetherai:Qwen/Qwen-Image',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ status: 400, message: 'upstream blew up' });

        // Failure path must NOT meter usage.
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

describe('TogetherImageProvider dimensions and references', () => {
    it('uses a supported 2K default for Seedream 5.0 Lite', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:ByteDance/Seedream-5.0-lite',
                prompt: 'a landscape',
            }),
        );
        expect(generateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'ByteDance/Seedream-5.0-lite',
                width: 2048,
                height: 2048,
            }),
        );
    });

    it.each([
        ['ideogram/ideogram-4.0', 2048],
        ['Wan-AI/Wan2.6-image', 1280],
    ])('uses supported default dimensions for %s', async (model, size) => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: `togetherai:${model}`,
                prompt: 'a landscape',
            }),
        );
        expect(generateMock.mock.calls[0][0]).toMatchObject({
            width: size,
            height: size,
        });
    });

    it('maps abstract Ideogram 4 ratios to a supported resolution', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:ideogram/ideogram-4.0',
                prompt: 'a landscape',
                imageSize: { w: 16, h: 9, kind: 'aspect' },
            }),
        );
        expect(generateMock.mock.calls[0][0]).toMatchObject({
            width: 2560,
            height: 1440,
        });
        expect(incrementUsageSpy.mock.calls[0].slice(1)).toEqual([
            'togetherai:ideogram/ideogram-4.0:per-image',
            1,
            6_000_000,
        ]);
    });

    it.each(['google/gemini-3-pro-image', 'google/flash-image-3.1'])(
        'omits the unsupported image count for %s',
        async (model) => {
            generateMock.mockResolvedValueOnce({
                data: [{ url: 'https://t.ai/image.png' }],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    model: `togetherai:${model}`,
                    prompt: 'a landscape',
                }),
            );
            expect(generateMock.mock.calls[0][0]).not.toHaveProperty('n');
        },
    );

    it('bills the rounded pixel dimensions sent for an abstract ratio', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'a landscape',
                imageSize: { w: 16, h: 9, kind: 'aspect' },
            }),
        );
        const sent = generateMock.mock.calls[0][0];
        expect(sent.width).toBeGreaterThan(1000);
        expect(sent.height).toBeGreaterThan(700);
        expect(sent.width % 8).toBe(0);
        expect(incrementUsageSpy.mock.calls[0][2]).toBe(
            (sent.width * sent.height) / 1_000_000,
        );
    });

    it('defaults to the priced 1K tier, not the smallest, when quality is omitted', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:google/flash-image-3.1',
                prompt: 'a landscape',
                imageSize: { w: 1, h: 1, kind: 'aspect' },
            }),
        );
        expect(generateMock).toHaveBeenCalledWith(
            expect.objectContaining({ width: 1024, height: 1024 }),
        );
        expect(incrementUsageSpy.mock.calls[0][1]).toBe(
            'togetherai:google/flash-image-3.1:1K',
        );
    });

    it.each(['black-forest-labs/FLUX.2-dev', 'google/gemini-3-pro-image'])(
        'sends reference_images for %s',
        async (model) => {
            generateMock.mockResolvedValueOnce({
                data: [{ url: 'https://t.ai/image.png' }],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    model: `togetherai:${model}`,
                    prompt: 'a landscape',
                    input_images: ['https://example.com/input.png'],
                }),
            );
            const sent = generateMock.mock.calls[0][0];
            expect(sent.reference_images).toEqual([
                'https://example.com/input.png',
            ]);
            expect(sent.image_url).toBeUndefined();
            expect(sent.condition_image).toBeUndefined();
        },
    );

    it('passes inline Kontext references through image_url as a data URI', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:black-forest-labs/FLUX.1-kontext-pro',
                prompt: 'a landscape',
                input_images: ['AQID'],
            }),
        );
        expect(generateMock.mock.calls[0][0].image_url).toBe(
            'data:image/png;base64,AQID',
        );
        expect(generateMock.mock.calls[0][0].image_base64).toBeUndefined();
    });

    it('sends the documented Kontext image_url field', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:black-forest-labs/FLUX.1-kontext-pro',
                prompt: 'a landscape',
                input_images: ['https://example.com/input.png'],
            }),
        );
        expect(generateMock.mock.calls[0][0].image_url).toBe(
            'https://example.com/input.png',
        );
        expect(generateMock.mock.calls[0][0].condition_image).toBeUndefined();
    });
});

describe('Together supported sizes and references', () => {
    it.each([
        {
            model: 'google/gemini-3-pro-image',
            imageSize: { w: 17, h: 10, kind: 'aspect' },
            quality: '4K',
            width: 5504,
            height: 3072,
            tier: '4K',
            cents: 24,
        },
        {
            model: 'google/flash-image-3.1',
            imageSize: { w: 1, h: 1, kind: 'aspect' },
            quality: ' 2k ',
            width: 2048,
            height: 2048,
            tier: '2K',
            cents: 10.1,
        },
        {
            model: 'google/gemini-3-pro-image',
            imageSize: { w: 4000, h: 3900, kind: 'pixels' },
            quality: undefined,
            width: 4096,
            height: 4096,
            tier: '4K',
            cents: 24,
        },
    ])(
        'uses one supported resolution and price for $model/$tier',
        async ({ model, imageSize, quality, width, height, tier, cents }) => {
            generateMock.mockResolvedValueOnce({
                data: [{ url: 'https://t.ai/image.png' }],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    model: `togetherai:${model}`,
                    prompt: 'a landscape',
                    imageSize,
                    quality,
                }),
            );
            expect(generateMock.mock.calls[0][0]).toMatchObject({
                model,
                width,
                height,
            });
            expect(incrementUsageSpy).toHaveBeenCalledWith(
                expect.anything(),
                `togetherai:${model}:${tier}`,
                1,
                cents * 1_000_000,
            );
        },
    );

    it('treats a blank quality as unset on tiered models', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:google/flash-image-3.1',
                prompt: 'a landscape',
                quality: '  ',
            }),
        );
        expect(incrementUsageSpy).toHaveBeenCalledWith(
            expect.anything(),
            'togetherai:google/flash-image-3.1:1K',
            1,
            6.7 * 1_000_000,
        );
    });

    it.each([
        ['ideogram/ideogram-4.0', 2560, 1440],
        ['google/flash-image-2.5', 1344, 768],
    ])(
        'snaps explicit pixel sizes to a supported resolution for %s',
        async (model, width, height) => {
            generateMock.mockResolvedValueOnce({
                data: [{ url: 'https://t.ai/image.png' }],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    model: `togetherai:${model}`,
                    prompt: 'a landscape',
                    imageSize: { w: 1920, h: 1080, kind: 'pixels' },
                }),
            );
            expect(generateMock.mock.calls[0][0]).toMatchObject({
                width,
                height,
            });
        },
    );

    it('falls back to the model default size when the driver resolved none', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:Qwen/Qwen-Image',
                prompt: 'hi',
                // Caller-facing size fields are the driver's to parse; a
                // provider sees only `imageSize`.
                ratio: { w: '16', h: '9' },
            } as never),
        );
        expect(generateMock.mock.calls[0][0]).toMatchObject({
            width: 1024,
            height: 1024,
        });
        expect(Number.isFinite(hasCreditsSpy.mock.calls[0][1])).toBe(true);
    });

    it('resolves provider aliases without changing the selected model', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: ' GOOGLE/FLASH-IMAGE-3.1 ',
                prompt: 'hi',
            }),
        );
        expect(generateMock.mock.calls[0][0].model).toBe(
            'google/flash-image-3.1',
        );
    });

    it.each([
        'black-forest-labs/FLUX.1-kontext-pro',
        'black-forest-labs/FLUX.1-kontext-max',
    ])('requires an input before checking credits for %s', async (model) => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    model: `togetherai:${model}`,
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
    });

    it.each([
        'black-forest-labs/FLUX.1.1-pro',
        'black-forest-labs/FLUX.1-kontext-pro',
    ])('does not send a URL in image_base64 for %s', async (model) => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: `togetherai:${model}`,
                prompt: 'hi',
                input_image: 'https://example.com/input.png',
            }),
        );
        expect(generateMock.mock.calls[0][0].image_url).toBe(
            'https://example.com/input.png',
        );
        expect(generateMock.mock.calls[0][0].image_base64).toBeUndefined();
    });
});

it.each([undefined, 'unknown-image-model'])(
    'uses the Together default for model %s',
    async (model) => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', model }),
        );
        expect(generateMock.mock.calls[0][0].model).toBe(
            'black-forest-labs/FLUX.2-dev',
        );
    },
);

it.each([
    { imageSize: { w: 16, h: 9, kind: 'aspect' }, width: 1360, height: 768 },
    { imageSize: { w: 64, h: 64, kind: 'pixels' }, width: 128, height: 128 },
    { imageSize: { w: 4096, h: 1024, kind: 'pixels' }, width: 2048, height: 1024 },
])(
    'fits FLUX.2 Dev dimensions to its side bounds and steps: $width x $height',
    async ({ imageSize, width, height }) => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://t.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', imageSize }),
        );
        expect(generateMock.mock.calls[0][0]).toMatchObject({ width, height });
    },
);

it.each(['3K', 'unknown', ' 5k '])(
    'rejects unsupported explicit tier %j before billing',
    async (quality) => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: 'hi',
                    model: 'togetherai:google/gemini-3-pro-image',
                    quality,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
    },
);

describe('Together current API prices', () => {
    it.each(['fast', 'preview', 'ultra'])(
        'records Imagen %s as excluded for data sharing instead of retired',
        (variant) => {
            expect(makeProvider().retiredModelAliases).not.toContain(
                `google/imagen-4.0-${variant}`,
            );
            expect(
                makeProvider()
                    .models()
                    .find(
                        (model) =>
                            model.id ===
                            `togetherai:google/imagen-4.0-${variant}`,
                    ),
            ).toMatchObject({ excludedForDataPolicy: 'thirdPartySharing' });
        },
    );

    it('includes the Flash Image reference surcharge in the credit gate and usage', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://example.com/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'togetherai:google/flash-image-3.1',
                prompt: 'A cup',
                quality: '0.5K',
                input_image: 'https://example.com/reference.png',
            }),
        );
        expect(hasCreditsSpy).toHaveBeenCalledWith(expect.anything(), 4685000);
        expect(incrementUsageSpy).toHaveBeenCalledWith(
            expect.anything(),
            'togetherai:google/flash-image-3.1:0.5K',
            1,
            4657000,
        );
        expect(incrementUsageSpy).toHaveBeenCalledWith(
            expect.anything(),
            'togetherai:google/flash-image-3.1:input_image',
            1,
            28000,
        );
    });
});
