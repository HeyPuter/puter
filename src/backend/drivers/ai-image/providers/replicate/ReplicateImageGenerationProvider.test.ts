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
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs the provider directly against the live wired
 * `MeteringService`. The Replicate SDK is mocked at the module
 * boundary; the provider's `secureFetch` for measuring input image
 * megapixels is also stubbed, since input-image flows would otherwise
 * try to make a real network round-trip. Covers per-image and
 * megapixel billing schemes plus the param-aliasing / -transform /
 * -filtering machinery.
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
import { ReplicateImageGenerationProvider } from './ReplicateImageGenerationProvider.js';
import { REPLICATE_IMAGE_GENERATION_MODELS } from './models.js';

// ── Replicate SDK mock ──────────────────────────────────────────────

const { runMock, replicateCtor } = vi.hoisted(() => ({
    runMock: vi.fn(),
    replicateCtor: vi.fn(),
}));

vi.mock('replicate', () => {
    const Replicate = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        replicateCtor(opts);
        this.run = runMock;
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
    runMock.mockReset();
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
        expect(replicateCtor).toHaveBeenCalledWith({ auth: 'test-key' });
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

    it('exposes the static REPLICATE_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(REPLICATE_IMAGE_GENERATION_MODELS);
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
        expect(runMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('ReplicateImageGenerationProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or empty', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.generate({ prompt: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(runMock).not.toHaveBeenCalled();
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
        expect(runMock).not.toHaveBeenCalled();
    });
});

// ── per-image billing (flux-schnell) ───────────────────────────────

describe('ReplicateImageGenerationProvider.generate per-image billing', () => {
    it('routes to <replicateId> with prompt + aspect_ratio and meters one output line', async () => {
        const provider = makeProvider();
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

        const result = await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                ratio: { w: 1920, h: 1080 }, // gcd → "16:9"
            }),
        );

        expect(result).toBe('https://r.example/img.png');
        expect(runMock).toHaveBeenCalledTimes(1);
        const [replicateId, opts] = runMock.mock.calls[0]!;
        expect(replicateId).toBe('black-forest-labs/flux-schnell');
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
        runMock.mockResolvedValueOnce('https://r.example/single.png');

        const result1 = await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
            }),
        );
        expect(result1).toBe('https://r.example/single.png');

        runMock.mockResolvedValueOnce(['https://r.example/first.png', 'ignored']);
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
        runMock.mockResolvedValueOnce([]);

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
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

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
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                seed: 42,
                arbitrary_unknown_key: 'should-be-stripped',
            } as never),
        );

        // mock.calls[0] = [replicateId, { input }]
        const opts = runMock.mock.calls[0]![1];
        expect(opts.input.seed).toBe(42); // allowed
        expect('arbitrary_unknown_key' in opts.input).toBe(false); // dropped
    });

    it('renames canonical param keys via param_aliases (response_format → output_format, steps → num_inference_steps)', async () => {
        const provider = makeProvider();
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
                response_format: 'png',
                steps: 4,
            } as never),
        );

        const opts = runMock.mock.calls[0]![1];
        expect(opts.input.output_format).toBe('png');
        expect(opts.input.num_inference_steps).toBe(4);
        expect('response_format' in opts.input).toBe(false);
        expect('steps' in opts.input).toBe(false);
    });

    it('applies param_transforms: injects defaults for missing keys (flux-2-dev: go_fast=true by default)', async () => {
        const provider = makeProvider();
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-dev',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        );

        const opts = runMock.mock.calls[0]![1];
        expect(opts.input.go_fast).toBe(true);
    });

    it('applies param_transforms: appends configured suffix (flux-2-pro: resolution gets " MP")', async () => {
        const provider = makeProvider();
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

        await withTestActor(() =>
            provider.generate({
                model: 'black-forest-labs/flux-2-pro',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
                output_megapixels: '1', // aliased → resolution; transformed → "1 MP"
            } as never),
        );

        const opts = runMock.mock.calls[0]![1];
        expect(opts.input.resolution).toBe('1 MP');
    });
});

// ── go_fast cost path ──────────────────────────────────────────────

describe('ReplicateImageGenerationProvider.generate go_fast pricing', () => {
    it('uses the costs_go_fast map when go_fast resolves to true (flux-2-dev)', async () => {
        const provider = makeProvider();
        runMock.mockResolvedValueOnce(['https://r.example/img.png']);

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
});
