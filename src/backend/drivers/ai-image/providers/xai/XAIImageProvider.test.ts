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
 * Offline unit tests for XAIImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs XAIImageProvider directly against the live
 * wired `MeteringService` so the recording side is exercised end-to-
 * end. xAI's image API is OpenAI-compatible so the OpenAI SDK is
 * mocked at the module boundary; that's the real network egress
 * point.
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
import { XAI_IMAGE_GENERATION_MODELS } from './models.js';
import { XAIImageProvider } from './XAIImageProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { generateMock, openAICtor } = vi.hoisted(() => ({
    generateMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.images = { generate: generateMock };
        // Some sibling providers boot through the same SDK module.
        this.chat = { completions: { create: vi.fn() } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
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
    new XAIImageProvider({ apiKey: 'test-key' }, server.services.metering);

beforeEach(() => {
    generateMock.mockReset();
    openAICtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('XAIImageProvider construction', () => {
    it('points the OpenAI SDK at the xAI base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.x.ai/v1',
        });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new XAIImageProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('XAIImageProvider model catalog', () => {
    it('returns grok-2-image as the default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('grok-2-image');
    });

    it('exposes the static XAI_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(XAI_IMAGE_GENERATION_MODELS);
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('XAIImageProvider.generate test_mode', () => {
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
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('XAIImageProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or non-string', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: undefined as unknown as string }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: '   ' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('XAIImageProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting xAI when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'a tiny red dot' }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        expect(generateMock).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('XAIImageProvider.generate model resolution', () => {
    const sampleResponse = { data: [{ url: 'https://x.ai/img/1' }] };

    it('falls back to the default model when given an unknown id', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'totally-not-a-real-model',
                prompt: 'hi',
            }),
        );

        expect(generateMock.mock.calls[0]![0].model).toBe('grok-2-image');
    });

    it('resolves an alias to its canonical id', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                // grok-image is an alias of grok-2-image.
                model: 'grok-image',
                prompt: 'hi',
            }),
        );

        expect(generateMock.mock.calls[0]![0].model).toBe('grok-2-image');
    });
});

// ── Successful generation ───────────────────────────────────────────

describe('XAIImageProvider.generate success path', () => {
    it('returns the URL from response.data[0].url and meters one image', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://x.ai/img/abc' }],
        });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'grok-2-image',
                prompt: 'a small red dot',
            }),
        );

        expect(result).toBe('https://x.ai/img/abc');

        // One increment, at the model's per-image rate (7 cents → 7,000,000 ucents).
        const grok = XAI_IMAGE_GENERATION_MODELS.find(
            (m) => m.id === 'grok-2-image',
        )!;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('xai:grok-2-image:output');
        expect(count).toBe(1);
        expect(cost).toBe(grok.costs.output * 1_000_000);
    });

    it('falls back to a base64 data URL when response carries b64_json', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({
            data: [{ b64_json: 'AAAA' }],
        });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'grok-2-image',
                prompt: 'a small red dot',
            }),
        );

        expect(result).toBe('data:image/png;base64,AAAA');
    });

    it('throws when the SDK returns no usable image data', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({ data: [{}] });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'grok-2-image',
                    prompt: 'a small red dot',
                }),
            ),
        ).rejects.toThrow(/Failed to extract image URL/);

        // Failure path must NOT meter usage.
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
