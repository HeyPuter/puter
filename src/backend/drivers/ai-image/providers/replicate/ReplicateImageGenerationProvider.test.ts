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
 * Offline unit tests for ReplicateImageGenerationProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs the provider directly against the live wired `MeteringService`.
 * The Replicate SDK is mocked at the module boundary; the provider's
 * `secureFetch` for measuring input image megapixels is also stubbed, since
 * input-image flows would otherwise try to make a real network round-trip.
 * Covers per-image and megapixel billing schemes plus the param-aliasing /
 * -transform / -filtering machinery.
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
import { Context, runWithContext } from '../../../../core/context.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { ReplicateImageGenerationProvider } from './ReplicateImageGenerationProvider.js';
import { REPLICATE_IMAGE_GENERATION_MODELS } from './models.js';

// ── Replicate SDK mock ──────────────────────────────────────────────

const { createPredictionMock, waitMock, cancelMock, replicateCtor } =
    vi.hoisted(() => ({
        createPredictionMock: vi.fn(),
        waitMock: vi.fn(),
        cancelMock: vi.fn(),
        replicateCtor: vi.fn(),
    }));

vi.mock('replicate', () => {
    const Replicate = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        replicateCtor(opts);
        this.wait = waitMock;
        this.predictions = { create: createPredictionMock, cancel: cancelMock };
    });
    return { default: Replicate };
});

// ── secureFetch stub ────────────────────────────────────────────────

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));

vi.mock('../../../../util/secureHttp.js', () => ({
    secureFetch: secureFetchMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;
let batchIncrementUsagesSpy: MockInstance<
    MeteringService['batchIncrementUsages']
>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () =>
    new ReplicateImageGenerationProvider(
        { apiKey: 'test-key' },
        server.services.metering,
    );

beforeEach(() => {
    createPredictionMock.mockReset();
    waitMock.mockReset();
    cancelMock.mockReset();
    replicateCtor.mockReset();
    secureFetchMock.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
    batchIncrementUsagesSpy = vi.spyOn(
        server.services.metering,
        'batchIncrementUsages',
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('ReplicateImageGenerationProvider construction', () => {
    it('constructs the Replicate SDK with auth=apiKey', () => {
        makeProvider();
        expect(replicateCtor).toHaveBeenCalledTimes(1);
        expect(replicateCtor).toHaveBeenCalledWith({
            auth: 'test-key',
            fetch: expect.any(Function),
        });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new ReplicateImageGenerationProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('ReplicateImageGenerationProvider model catalog', () => {
    it('returns black-forest-labs/flux-schnell as the default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            'black-forest-labs/flux-schnell',
        );
    });

    it('exposes available entries from the static model catalog', () => {
        const provider = makeProvider();
        expect(provider.models()).toEqual(REPLICATE_IMAGE_GENERATION_MODELS.filter((model) => !model.unavailableReason));
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('ReplicateImageGenerationProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({ prompt: 'something', test_mode: true }),
        );
        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(createPredictionMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('ReplicateImageGenerationProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or empty', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.generate({ prompt: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createPredictionMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('ReplicateImageGenerationProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting Replicate when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);
        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(createPredictionMock).not.toHaveBeenCalled();
    });
});

// ── per-image billing (flux-schnell) ───────────────────────────────

describe('ReplicateImageGenerationProvider.generate per-image billing', () => {
    it.each([
        [{ w: 1.6, h: 0.9 }, '16:9'],
        [{ w: 0.04, h: 0.03 }, '4:3'],
    ])('preserves fractional aspect ratios: %j', async (ratio, expected) => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'fractional-ratio',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });
        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                ratio,
            }),
        );
        expect(createPredictionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.objectContaining({ aspect_ratio: expected }),
            }),
        );
    });

    it('routes to <replicateId> with prompt + aspect_ratio and meters one output line', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                ratio: { w: 1920, h: 1080 }, // gcd → "16:9"
            }),
        );

        expect(result).toBe('https://r.example/img.png');
        expect(createPredictionMock).toHaveBeenCalledTimes(1);
        const [opts] = createPredictionMock.mock.calls[0]!;
        expect(opts.model).toBe('black-forest-labs/flux-schnell');
        expect(opts.wait).toBe(60);
        expect(waitMock).not.toHaveBeenCalled();
        expect(opts.input.prompt).toBe('hi');
        expect(opts.input.aspect_ratio).toBe('16:9');

        // flux-schnell: per-image @ 0.3 cents/image → 300_000 microcents.
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe(
            'replicate:black-forest-labs/flux-schnell:output',
        );
        expect(amount).toBe(1);
        expect(cost).toBe(Math.round(0.3 * 1_000_000));
    });

    it('returns a string output verbatim and an array output by first element', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: 'https://r.example/single.png',
        });

        const result1 = await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
            }),
        );
        expect(result1).toBe('https://r.example/single.png');

        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/first.png', 'ignored'],
        });
        const result2 = await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
            }),
        );
        expect(result2).toBe('https://r.example/first.png');
    });

    it('throws 400 when the SDK returns no usable URL', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: [],
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'black-forest-labs/flux-schnell',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── megapixel billing (flux-2-pro) ─────────────────────────────────

describe('ReplicateImageGenerationProvider.generate megapixel billing', () => {
    it('bills run + output_mp components on a per-MP model', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-pro',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        );

        // flux-2-pro: run=1.5, output_mp=1.5 (cents). Default outputMp=1.
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const types = (
            entries as Array<{ usageType: string }>
        ).map((e) => e.usageType);
        expect(types).toEqual(
            expect.arrayContaining([
                'replicate:black-forest-labs/flux-2-pro:run',
                'replicate:black-forest-labs/flux-2-pro:output_mp',
            ]),
        );
    });
});

// ── Param filtering, aliases, and transforms ───────────────────────

describe('ReplicateImageGenerationProvider.generate param filtering / aliases / transforms', () => {
    it('drops params not in allowed_params (ignores arbitrary inputs)', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                seed: 42,
                arbitrary_unknown_key: 'should-be-stripped',
            } as never),
        );

        // mock.calls[0] = [replicateId, { input }]
        const opts = createPredictionMock.mock.calls[0]![0];
        expect(opts.input.seed).toBe(42); // allowed
        expect('arbitrary_unknown_key' in opts.input).toBe(false); // dropped
    });

    it('renames canonical param keys via param_aliases (response_format → output_format, steps → num_inference_steps)', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                response_format: 'png',
                steps: 4,
            } as never),
        );

        const opts = createPredictionMock.mock.calls[0]![0];
        expect(opts.input.output_format).toBe('png');
        expect(opts.input.num_inference_steps).toBe(4);
        expect('response_format' in opts.input).toBe(false);
        expect('steps' in opts.input).toBe(false);
    });

    it('applies param_transforms: injects defaults for missing keys (flux-2-dev: go_fast=true by default)', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-dev',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        );

        const opts = createPredictionMock.mock.calls[0]![0];
        expect(opts.input.go_fast).toBe(true);
    });

    it('applies param_transforms: appends configured suffix (flux-2-pro: resolution gets " MP")', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-pro',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
                output_megapixels: '1', // aliased → resolution; transformed → "1 MP"
            } as never),
        );

        const opts = createPredictionMock.mock.calls[0]![0];
        expect(opts.input.resolution).toBe('1 MP');
    });

    it('drops the cross-provider resolution option instead of sending it as a megapixel value', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-pro',
                prompt: 'hi',
                resolution: '2k', // the xAI tier spelling, documented cross-provider
            }),
        );

        const opts = createPredictionMock.mock.calls[0]![0];
        expect(opts.input).not.toHaveProperty('resolution');
    });
});

// ── go_fast cost path ──────────────────────────────────────────────

describe('ReplicateImageGenerationProvider.generate go_fast pricing', () => {
    it('uses the costs_go_fast map when go_fast resolves to true (flux-2-dev)', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-dev',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
                // go_fast defaults to true via param_transforms.
            } as never),
        );

        // costs_go_fast for flux-2-dev: input_mp=1.2, output_mp=1.2.
        // Default outputMp=1, no input MP → output_mp line at 1.2 cents.
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const outputMp = (
            entries as Array<{ usageType: string; costOverride: number }>
        ).find((e) => e.usageType.endsWith(':output_mp'));
        expect(outputMp?.costOverride).toBe(Math.round(1.2 * 1_000_000));
    });

    it('does not bill a megapixel hint the model cannot forward (flux-2-dev)', async () => {
        const provider = makeProvider();
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://r.example/img.png'],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-dev',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
                output_megapixels: '4',
            } as never),
        );

        // flux-2-dev has no native megapixel control: the hint stays out of
        // the request and the estimate stays at the 1 MP default.
        const sent = createPredictionMock.mock.calls[0]![0].input as Record<string, unknown>;
        expect(sent).not.toHaveProperty('output_megapixels');
        expect(sent).not.toHaveProperty('resolution');
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const outputMp = (
            entries as Array<{ usageType: string; usageAmount: number; costOverride: number }>
        ).find((e) => e.usageType.endsWith(':output_mp'));
        expect(outputMp?.usageAmount).toBe(1);
        expect(outputMp?.costOverride).toBe(Math.round(1.2 * 1_000_000));
    });
});

// -- Upstream rejection handling --

describe('ReplicateImageGenerationProvider.generate upstream rejections', () => {
    const generate = () =>
        withTestActor(() =>
            makeProvider().generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
            }),
        );

    it('maps an NSFW refusal to 400 moderation_flagged without metering', async () => {
        createPredictionMock.mockRejectedValueOnce(
            new Error(
                'Prediction failed: Error generating image: NSFW content detected.',
            ),
        );

        await expect(generate()).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            code: 'moderation_flagged',
            message: 'Error generating image: NSFW content detected.',
            fields: { provider: 'replicate' },
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps a sensitive-content (E005) refusal to 400 moderation_flagged', async () => {
        createPredictionMock.mockRejectedValueOnce(
            new Error(
                'Prediction failed: The input or output was flagged as sensitive. Please try again with different inputs. (E005)',
            ),
        );

        await expect(generate()).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
    });

    it('maps any other failed prediction to 502 upstream_failed, keeping the cause', async () => {
        const raw = new Error(
            'Prediction failed: q_descale must have shape (batch_size, num_heads_k)',
        );
        createPredictionMock.mockRejectedValueOnce(raw);

        await expect(generate()).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
            message: 'q_descale must have shape (batch_size, num_heads_k)',
            fields: { provider: 'replicate' },
            cause: raw,
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('strips markup and bounds the message when upstream returns an HTML error page', async () => {
        const page =
            '<html><head><style>body{color:red}</style></head><body>' +
            "<h1>Our services aren't available right now</h1>" +
            `<p>${'x'.repeat(500)}</p></body></html>`;
        createPredictionMock.mockRejectedValueOnce(
            new Error(
                `Prediction failed: Error generating image: Failed to generate: ${page}`,
            ),
        );

        const err = await generate().catch((e) => e);
        expect(err).toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
        expect(err.message).toContain(
            "Our services aren't available right now",
        );
        expect(err.message).not.toMatch(/<|body\{/);
        expect(err.message.length).toBeLessThanOrEqual(300);
    });

    it('passes a rejection that carries an HTTP status through untouched for the driver boundary', async () => {
        const apiError = Object.assign(
            new Error(
                'Request to https://api.replicate.com/v1/predictions failed with status 429 Too Many Requests',
            ),
            { name: 'ApiError', response: { status: 429 } },
        );
        createPredictionMock.mockRejectedValueOnce(apiError);

        await expect(generate()).rejects.toBe(apiError);
    });
});

describe('ReplicateImageGenerationProvider canonical inputs', () => {
    it.each(['https://example.com/input.png', 'AQID'])(
        'forwards input_images to a single-image model',
        async (image) => {
            createPredictionMock.mockResolvedValueOnce({
                id: 'prediction-1',
                status: 'succeeded',
                output: ['https://example.com/output.png'],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    model: 'black-forest-labs/flux-1.1-pro',
                    prompt: 'a landscape',
                    input_images: [image],
                }),
            );
            expect(
                createPredictionMock.mock.calls[0][0].input.image_prompt,
            ).toBe(
                image.startsWith('https:')
                    ? image
                    : 'data:image/png;base64,AQID',
            );
        },
    );

    it('rejects extra references on single-image models', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    model: 'black-forest-labs/flux-1.1-pro',
                    prompt: 'a landscape',
                    input_images: ['AQID', 'AQID'],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(createPredictionMock).not.toHaveBeenCalled();
    });
});

describe('Replicate prediction completion', () => {
    it.each(['starting', 'processing'])(
        'polls only after the blocking request returns %s',
        async (status) => {
            const prediction = { id: 'pending-image', status, output: null };
            createPredictionMock.mockResolvedValueOnce(prediction);
            waitMock.mockResolvedValueOnce({
                ...prediction,
                status: 'succeeded',
                output: ['https://r.example/done.png'],
            });
            const result = await withTestActor(() =>
                makeProvider().generate({ prompt: 'hi' }),
            );
            expect(createPredictionMock.mock.calls[0][0].wait).toBe(60);
            expect(waitMock).toHaveBeenCalledWith(
                prediction,
                { interval: 2000 },
                expect.any(Function),
            );
            expect(result).toBe('https://r.example/done.png');
            expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['failed', 'canceled'])(
        'does not bill a terminal %s response',
        async (status) => {
            createPredictionMock.mockResolvedValueOnce({
                id: 'failed-image',
                status,
                error: 'provider unavailable',
                output: null,
            });
            await expect(
                withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
            ).rejects.toMatchObject({ statusCode: 502 });
            expect(waitMock).not.toHaveBeenCalled();
            expect(incrementUsageSpy).not.toHaveBeenCalled();
        },
    );

    it('cancels an unfinished prediction when the caller aborts', async () => {
        const controller = new AbortController();
        createPredictionMock.mockResolvedValueOnce({
            id: 'pending-image',
            status: 'processing',
            output: null,
        });
        cancelMock.mockResolvedValueOnce({
            id: 'pending-image',
            status: 'canceled',
        });
        waitMock.mockImplementationOnce(async (prediction, options, stop) => {
            controller.abort();
            expect(await stop(prediction)).toBe(true);
            return prediction;
        });
        await expect(
            withTestActor(() =>
                runWithContext(
                    {
                        actor: Context.get('actor'),
                        abortSignal: controller.signal,
                    },
                    () => makeProvider().generate({ prompt: 'hi' }),
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
        });
        expect(cancelMock).toHaveBeenCalledWith('pending-image');
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

describe('Replicate abort during creation', () => {
    it('retains the prediction ID and cancels after a disconnect during create', async () => {
        const controller = new AbortController();
        createPredictionMock.mockImplementationOnce(async (options) => {
            controller.abort();
            if (options.signal?.aborted)
                throw new DOMException('aborted', 'AbortError');
            return {
                id: 'created-after-abort',
                status: 'processing',
                output: null,
            };
        });
        cancelMock.mockResolvedValueOnce({
            id: 'created-after-abort',
            status: 'canceled',
            output: null,
        });
        await expect(
            withTestActor(() =>
                runWithContext(
                    {
                        actor: Context.get('actor'),
                        abortSignal: controller.signal,
                    },
                    () => makeProvider().generate({ prompt: 'hi' }),
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
        });
        expect(cancelMock).toHaveBeenCalledWith('created-after-abort');
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('bills completed work when completion wins the abort race', async () => {
        const controller = new AbortController();
        createPredictionMock.mockImplementationOnce(async () => {
            controller.abort();
            return {
                id: 'completed-image',
                status: 'succeeded',
                output: ['https://r.example/done.png'],
            };
        });
        await expect(
            withTestActor(() =>
                runWithContext(
                    {
                        actor: Context.get('actor'),
                        abortSignal: controller.signal,
                    },
                    () => makeProvider().generate({ prompt: 'hi' }),
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
        });
        expect(cancelMock).not.toHaveBeenCalled();
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
    });
});

it.each(['cancel failure', 'poll failure'])(
    'cleans up an aborted prediction after %s',
    async (failure) => {
        const controller = new AbortController();
        const prediction = {
            id: 'pending-cleanup',
            status: 'processing',
            output: null,
        };
        createPredictionMock.mockResolvedValueOnce(prediction);
        waitMock.mockImplementationOnce(async () => {
            controller.abort();
            if (failure === 'poll failure')
                throw new Error('poll connection failed');
            return prediction;
        });
        if (failure === 'cancel failure') {
            cancelMock.mockRejectedValueOnce(
                new Error('cancel connection failed'),
            );
            waitMock.mockResolvedValueOnce({
                ...prediction,
                status: 'succeeded',
                output: ['https://r.example/done.png'],
            });
        } else
            cancelMock.mockResolvedValueOnce({
                ...prediction,
                status: 'canceled',
            });
        await expect(
            withTestActor(() =>
                runWithContext(
                    {
                        actor: Context.get('actor'),
                        abortSignal: controller.signal,
                    },
                    () => makeProvider().generate({ prompt: 'hi' }),
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
        });
        expect(cancelMock).toHaveBeenCalledWith('pending-cleanup');
        expect(incrementUsageSpy).toHaveBeenCalledTimes(
            failure === 'cancel failure' ? 1 : 0,
        );
    },
);

it('does not start a prediction for an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
        withTestActor(() =>
            runWithContext(
                { actor: Context.get('actor'), abortSignal: controller.signal },
                () => makeProvider().generate({ prompt: 'hi' }),
            ),
        ),
    ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'client_aborted' });
    expect(createPredictionMock).not.toHaveBeenCalled();
    expect(hasCreditsSpy).not.toHaveBeenCalled();
});

it('stops polling and cancels at the prediction deadline', async () => {
    let stopResult: boolean | undefined;
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const prediction = {
        id: 'deadline-image',
        status: 'processing',
        output: null,
    };
    createPredictionMock.mockResolvedValueOnce(prediction);
    waitMock.mockImplementationOnce(async (current, options, stop) => {
        now += 10 * 60 * 1000;
        stopResult =
            typeof stop === 'function' ? await stop(current) : undefined;
        return current;
    });
    cancelMock.mockResolvedValueOnce({ ...prediction, status: 'canceled' });
    await expect(
        withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
    ).rejects.toMatchObject({
        statusCode: 504,
        legacyCode: 'upstream_timeout',
    });
    expect(stopResult).toBe(true);
    expect(cancelMock).toHaveBeenCalledWith(prediction.id);
    expect(incrementUsageSpy).not.toHaveBeenCalled();
});

it('bounds cleanup when cancellation fails and the prediction stays pending', async () => {
    let stopResult: boolean | undefined;
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const controller = new AbortController();
    const prediction = {
        id: 'cleanup-timeout',
        status: 'processing',
        output: null,
    };
    createPredictionMock.mockImplementationOnce(async () => {
        controller.abort();
        return prediction;
    });
    cancelMock.mockRejectedValueOnce(new Error('unreachable'));
    waitMock.mockImplementationOnce(async (current, options, stop) => {
        now += 30_000;
        stopResult =
            typeof stop === 'function' ? await stop(current) : undefined;
        return current;
    });
    await expect(
        withTestActor(() =>
            runWithContext(
                { actor: Context.get('actor'), abortSignal: controller.signal },
                () => makeProvider().generate({ prompt: 'hi' }),
            ),
        ),
    ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'client_aborted' });
    expect(stopResult).toBe(true);
    expect(incrementUsageSpy).not.toHaveBeenCalled();
});

it('adds an upstream deadline and a network timeout to prediction creation', async () => {
    makeProvider();
    const transport = replicateCtor.mock.calls[0][0].fetch;
    const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}'));
    await transport(
        'https://api.replicate.com/v1/models/owner/model/predictions',
        { method: 'POST', headers: { Prefer: 'wait=60' } },
    );
    const options = fetchSpy.mock.calls[0][1]!;
    expect(new Headers(options.headers).get('Cancel-After')).toBe('600s');
    expect(new Headers(options.headers).get('Prefer')).toBe('wait=60');
    expect(options.signal).toBeInstanceOf(AbortSignal);
});

it('sends a failed prediction create only once, replaying the failure to SDK retries', async () => {
    makeProvider();
    const transport = replicateCtor.mock.calls[0][0].fetch;
    const failure = new DOMException('create timed out', 'TimeoutError');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(failure);
    // The SDK's retry loop re-invokes fetch with the very same init object.
    const init = { method: 'POST', headers: { Prefer: 'wait=60' } };
    const url = 'https://api.replicate.com/v1/models/owner/model/predictions';
    for (let attempt = 0; attempt < 6; attempt++) {
        await expect(transport(url, init)).rejects.toBe(failure);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A fresh create (new init) is still sent.
    fetchSpy.mockResolvedValueOnce(new Response('{}'));
    await transport(url, { method: 'POST', headers: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Idempotent GET polls keep the SDK's own retry behaviour.
    fetchSpy.mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response('{}'));
    const poll = { method: 'GET' };
    await expect(
        transport('https://api.replicate.com/v1/predictions/abc', poll),
    ).rejects.toBe(failure);
    await transport('https://api.replicate.com/v1/predictions/abc', poll);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
});

it('measures multiple input images concurrently and bills their combined size', async () => {
    let releaseFirst!: (response: Response) => void;
    secureFetchMock
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirst = resolve;
                }),
        )
        .mockResolvedValueOnce(new Response('not-an-image'));
    createPredictionMock.mockResolvedValueOnce({
        id: 'parallel-images',
        status: 'succeeded',
        output: ['https://example.com/out.jpg'],
    });
    const result = withTestActor(() =>
        makeProvider().generate({
            prompt: 'hi',
            model: 'black-forest-labs/flux-2-dev',
            input_images: [
                'https://example.com/a.png',
                'https://example.com/b.png',
            ],
        }),
    );
    // The output-only credit check runs first, so the fetches start a tick later.
    await vi.waitFor(() => expect(secureFetchMock).toHaveBeenCalledTimes(2));
    releaseFirst(new Response('not-an-image'));
    await result;
    expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                usageType: expect.stringContaining(':input_mp'),
                usageAmount: 2,
            }),
        ]),
    );
});

it('surfaces a poll failure as an upstream error without cancelling or billing', async () => {
    createPredictionMock.mockResolvedValueOnce({
        id: 'poll-error',
        status: 'processing',
        output: null,
    });
    const error = new Error('poll unavailable');
    waitMock.mockRejectedValueOnce(error);
    const rejection = await withTestActor(() =>
        makeProvider().generate({ prompt: 'hi' }),
    ).then(
        () => {
            throw new Error('expected generate to reject');
        },
        (err: unknown) => err as Error,
    );
    expect(rejection).toMatchObject({
        statusCode: 502,
        legacyCode: 'upstream_failed',
    });
    expect(rejection.cause).toBe(error);
    // The prediction is still healthy upstream; only our poll broke.
    expect(cancelMock).not.toHaveBeenCalled();
    expect(incrementUsageSpy).not.toHaveBeenCalled();
});

it('lets a poll timeout reach the driver boundary for its 504 mapping', async () => {
    createPredictionMock.mockResolvedValueOnce({
        id: 'poll-timeout',
        status: 'processing',
        output: null,
    });
    const timeout = new DOMException('poll timed out', 'TimeoutError');
    waitMock.mockRejectedValueOnce(timeout);
    await expect(
        withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
    ).rejects.toBe(timeout);
    expect(cancelMock).not.toHaveBeenCalled();
});

it('translates a prediction that fails while polling without a redundant cancel', async () => {
    createPredictionMock.mockResolvedValueOnce({
        id: 'fails-later',
        status: 'processing',
        output: null,
    });
    waitMock.mockRejectedValueOnce(
        new Error('Prediction failed: provider unavailable'),
    );
    await expect(
        withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
    ).rejects.toMatchObject({ statusCode: 502, legacyCode: 'upstream_failed' });
    expect(cancelMock).not.toHaveBeenCalled();
    expect(incrementUsageSpy).not.toHaveBeenCalled();
});

it('returns the image when a timed-out prediction completes during cleanup', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const prediction = {
        id: 'late-finish',
        status: 'processing',
        output: null,
    };
    createPredictionMock.mockResolvedValueOnce(prediction);
    waitMock.mockImplementationOnce(async (current, options, stop) => {
        now += 10 * 60 * 1000;
        await stop(current);
        return current;
    });
    cancelMock.mockResolvedValueOnce({
        ...prediction,
        status: 'succeeded',
        output: ['https://r.example/late.png'],
    });
    await expect(
        withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
    ).resolves.toBe('https://r.example/late.png');
    expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
});

it('rejects more than ten input images before fetching or pricing any', async () => {
    await expect(
        withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                model: 'black-forest-labs/flux-2-dev',
                input_images: Array.from(
                    { length: 11 },
                    (_, i) => `https://example.com/${i}.png`,
                ),
            }),
        ),
    ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
    expect(secureFetchMock).not.toHaveBeenCalled();
    expect(hasCreditsSpy).not.toHaveBeenCalled();
    expect(createPredictionMock).not.toHaveBeenCalled();
});

it('checks credits on the output-only estimate before fetching input images', async () => {
    hasCreditsSpy.mockResolvedValueOnce(false);
    await expect(
        withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                model: 'black-forest-labs/flux-2-dev',
                input_images: ['https://example.com/a.png'],
            }),
        ),
    ).rejects.toMatchObject({ statusCode: 402 });
    expect(secureFetchMock).not.toHaveBeenCalled();
});

it('bounds input image fetches to four at a time', async () => {
    const releases: Array<(response: Response) => void> = [];
    secureFetchMock.mockImplementation(
        () =>
            new Promise<Response>((resolve) => {
                releases.push(resolve);
            }),
    );
    createPredictionMock.mockResolvedValueOnce({
        id: 'bounded-images',
        status: 'succeeded',
        output: ['https://example.com/out.jpg'],
    });
    const result = withTestActor(() =>
        makeProvider().generate({
            prompt: 'hi',
            model: 'black-forest-labs/flux-2-dev',
            input_images: Array.from(
                { length: 6 },
                (_, i) => `https://example.com/${i}.png`,
            ),
        }),
    );
    await vi.waitFor(() => expect(secureFetchMock).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach((release) =>
        release(new Response('not-an-image')),
    );
    await vi.waitFor(() => expect(secureFetchMock).toHaveBeenCalledTimes(6));
    releases.splice(0).forEach((release) =>
        release(new Response('not-an-image')),
    );
    await result;
    expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                usageType: expect.stringContaining(':input_mp'),
                usageAmount: 6,
            }),
        ]),
    );
});

it('does not keep polling an upstream prediction aborted before starting', async () => {
    const prediction = {
        id: 'upstream-aborted',
        status: 'processing',
        output: null,
    };
    createPredictionMock.mockResolvedValueOnce(prediction);
    let stopResult: boolean | undefined;
    waitMock.mockImplementationOnce(async (current, options, stop) => {
        const aborted = { ...current, status: 'aborted' };
        stopResult = await stop(aborted);
        return aborted;
    });
    await expect(
        withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
    ).rejects.toMatchObject({ statusCode: 502, legacyCode: 'upstream_failed' });
    expect(stopResult).toBe(true);
    expect(incrementUsageSpy).not.toHaveBeenCalled();
});

it('preserves request cancellation on status fetches without setting a creation deadline', async () => {
    makeProvider();
    const transport = replicateCtor.mock.calls[0][0].fetch;
    const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}'));
    const controller = new AbortController();
    controller.abort();
    await transport('https://api.replicate.com/v1/predictions/image-id', {
        method: 'GET',
        signal: controller.signal,
    });
    const options = fetchSpy.mock.calls[0][1]!;
    expect(new Headers(options.headers).has('Cancel-After')).toBe(false);
    expect(options.signal?.aborted).toBe(true);
});

describe('Replicate expanded catalog billing', () => {
    it('returns the generated ControlNet sample instead of its diagnostic control map', async () => {
        createPredictionMock.mockResolvedValueOnce({
            id: 'controlnet',
            status: 'succeeded',
            metrics: { predict_time: 4 },
            output: [
                'https://r.example/control.png',
                'https://r.example/generated.png',
            ],
        });
        const result = await withTestActor(() =>
            makeProvider().generate({
                model: 'jagilley/controlnet-scribble',
                prompt: 'A cup',
                input_image: 'data:image/png;base64,aGVsbG8=',
            }),
        );
        expect(result).toBe('https://r.example/generated.png');
        expect(createPredictionMock.mock.calls[0][0].input.num_samples).toBe(
            '1',
        );
    });

    it('uses a pinned community version and meters actual prediction runtime', async () => {
        createPredictionMock.mockResolvedValueOnce({
            id: 'runtime',
            status: 'succeeded',
            output: ['https://r.example/output.png'],
            metrics: { predict_time: 12.5 },
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'stability-ai/sdxl',
                prompt: 'A cup',
            }),
        );
        expect(createPredictionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                version: expect.any(String),
                wait: 60,
                input: expect.objectContaining({
                    prompt: 'A cup',
                    num_outputs: 1,
                }),
            }),
        );
        expect(createPredictionMock.mock.calls[0]![0]).not.toHaveProperty(
            'model',
        );
        expect(batchIncrementUsagesSpy).toHaveBeenCalledWith(
            expect.anything(),
            [
                {
                    usageType: 'replicate:stability-ai/sdxl:second',
                    usageAmount: 12.5,
                    costOverride: 1218750,
                },
            ],
        );
    });

    it('extracts structured image output and uses the chosen resolution tariff', async () => {
        createPredictionMock.mockResolvedValueOnce({
            id: 'tier',
            status: 'succeeded',
            output: {
                image: 'https://r.example/output.svg',
                style_id: 'unused',
            },
        });
        const result = await withTestActor(() =>
            makeProvider().generate({
                model: 'google/nano-banana-2',
                prompt: 'A cup',
                quality: '2k',
            }),
        );
        expect(result).toBe('https://r.example/output.svg');
        expect(batchIncrementUsagesSpy).toHaveBeenCalledWith(
            expect.anything(),
            [
                {
                    usageType: 'replicate:google/nano-banana-2:output',
                    usageAmount: 1,
                    costOverride: 10100000,
                },
            ],
        );
    });

    it('does not substitute the credit estimate when actual runtime is missing', async () => {
        createPredictionMock.mockResolvedValueOnce({
            id: 'missing-runtime',
            status: 'succeeded',
            output: 'https://r.example/output.png',
        });
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    model: 'stability-ai/sdxl',
                    prompt: 'A cup',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 502 });
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});

describe('Replicate availability gates', () => {
    it.each(['leonardoai/phoenix-1.0', 'bytedance/seedream-3', 'black-forest-labs/flux-pro-finetuned', 'quiverai/arrow-1.1', 'quiverai/arrow-1.1-max', 'prunaai/hidream-l1-fast'])(
        'does not advertise the unavailable %s endpoint but explains it', (id) => {
            const provider = makeProvider();
            expect(provider.models().some((model) => model.id === id)).toBe(false);
            expect(provider.retiredModelAliases).toContain(id);
            expect(provider.retiredModelReasons[id]).toMatch(/Replicate/);
        },
    );

    it('rejects a reference image over the 30 MB cap instead of estimating it', async () => {
        const provider = makeProvider();
        const chunk = new Uint8Array(1024 * 1024);
        let sent = 0;
        secureFetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
            pull(controller) {
                if (sent++ < 31) controller.enqueue(chunk);
                else controller.close();
            },
        })));
        await expect(withTestActor(() => provider.generate({
            model: 'black-forest-labs/flux-2-dev',
            prompt: 'hi',
            ratio: { w: 1024, h: 1024 },
            input_images: ['https://example.com/huge.png'],
        }))).rejects.toMatchObject({ statusCode: 400, code: 'input_too_large' });
        expect(createPredictionMock).not.toHaveBeenCalled();
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});
