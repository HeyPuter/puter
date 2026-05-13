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
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs TogetherImageProvider directly against the
 * live wired `MeteringService` so the recording side is exercised
 * end-to-end. The Together SDK is mocked at the module boundary —
 * that's the real network egress point.
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
            'togetherai:black-forest-labs/FLUX.1-schnell',
        );
    });

    it('exposes the static TOGETHER_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(TOGETHER_IMAGE_GENERATION_MODELS);
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

        // FLUX.1-schnell is per-MP @ 0.27 cents/MP.
        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:black-forest-labs/FLUX.1-schnell',
                prompt: 'hello',
                ratio: { w: 1024, h: 1024 },
            }),
        );

        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe(
            'togetherai:black-forest-labs/FLUX.1-schnell:1MP',
        );
        const expectedMP = (1024 * 1024) / 1_000_000;
        expect(amount).toBeCloseTo(expectedMP);
        expect(cost).toBeCloseTo(0.27 * expectedMP * 1_000_000);
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
                ratio: { w: 1, h: 1 },
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
                model: 'togetherai:black-forest-labs/FLUX.1-schnell',
                prompt: 'hi',
                ratio: { w: 50, h: 130 }, // expect snap to {64,128}
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.model).toBe('black-forest-labs/FLUX.1-schnell');
        expect(sent.width).toBe(64);
        expect(sent.height).toBe(128);
        expect(sent.n).toBe(1);
    });

    it('forwards optional knobs: steps clamp, seed round, negative_prompt, response_format, image_url, prompt_strength, disable_safety_checker', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'togetherai:black-forest-labs/FLUX.1-schnell',
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
                model: 'togetherai:black-forest-labs/FLUX.1-schnell',
                prompt: 'edit it',
                // canonical key the driver layer accepts; provider mirrors it
                // to the SDK's `image_base64` field.
                input_image: 'BASE64DATA',
            } as never),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.image_base64).toBe('BASE64DATA');
    });
});

// ── Output extraction & error mapping ───────────────────────────────

describe('TogetherImageProvider.generate output handling', () => {
    it('falls back to a base64 data URL when SDK returns b64_json instead of url', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({ data: [{ b64_json: 'AAAA' }] });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'togetherai:black-forest-labs/FLUX.1-schnell',
                prompt: 'hi',
            }),
        );

        expect(result).toBe('data:image/png;base64,AAAA');
    });

    it('wraps SDK errors with an "image generation error:" prefix', async () => {
        const provider = makeProvider();
        const apiError = new Error('upstream blew up');
        generateMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'togetherai:black-forest-labs/FLUX.1-schnell',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toThrow(/Together AI image generation error:.*upstream blew up/);

        // Failure path must NOT meter usage.
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
