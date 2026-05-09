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
 * Offline unit tests for GeminiImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs GeminiImageProvider directly against the
 * live wired `MeteringService` so the recording side runs end-to-end.
 * The Google GenAI SDK is mocked at the module boundary — that's the
 * real network egress point. Both the `generateContent` (Flash) and
 * `generateImages` (Imagen) code paths are covered.
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
import { GEMINI_IMAGE_GENERATION_MODELS } from './models.js';
import { GeminiImageProvider } from './GeminiImageProvider.js';

// ── Google GenAI SDK mock ───────────────────────────────────────────

const { generateContentMock, generateImagesMock, googleAICtor } = vi.hoisted(
    () => ({
        generateContentMock: vi.fn(),
        generateImagesMock: vi.fn(),
        googleAICtor: vi.fn(),
    }),
);

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        googleAICtor(opts);
        this.models = {
            generateContent: generateContentMock,
            generateImages: generateImagesMock,
        };
    });
    return { GoogleGenAI };
});

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
    new GeminiImageProvider({ apiKey: 'test-key' }, server.services.metering);

beforeEach(() => {
    generateContentMock.mockReset();
    generateImagesMock.mockReset();
    googleAICtor.mockReset();
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

describe('GeminiImageProvider construction', () => {
    it('constructs the GoogleGenAI SDK with the configured api key', () => {
        makeProvider();
        expect(googleAICtor).toHaveBeenCalledTimes(1);
        expect(googleAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new GeminiImageProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('GeminiImageProvider model catalog', () => {
    it('returns the first catalog entry id as the default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            GEMINI_IMAGE_GENERATION_MODELS[0].id,
        );
    });

    it('exposes the static GEMINI_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(GEMINI_IMAGE_GENERATION_MODELS);
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('GeminiImageProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({ prompt: 'something', test_mode: true }),
        );

        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateContentMock).not.toHaveBeenCalled();
        expect(generateImagesMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('GeminiImageProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or empty', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.generate({ prompt: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: undefined as unknown as string }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('throws 400 on Flash path when an input image has no detectable mime type and no override', async () => {
        const provider = makeProvider();

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'gemini-2.5-flash-image',
                    prompt: 'edit',
                    input_images: ['NOT-A-DATA-URI-AND-NOT-RECOGNIZED'],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });
});

// ── generateContent (Flash) path ────────────────────────────────────

describe('GeminiImageProvider.generate Flash path (generateContent)', () => {
    const inlineImageResponse = {
        candidates: [
            {
                content: {
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'image/png',
                                data: 'BASE64IMG',
                            },
                        },
                    ],
                },
            },
        ],
        usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 1500,
            candidatesTokensDetails: [
                { modality: 'IMAGE', tokenCount: 1290 },
            ],
            thoughtsTokenCount: 0,
        },
    };

    it('forwards prompt + aspectRatio config and routes to generateContent', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(inlineImageResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gemini-2.5-flash-image',
                prompt: 'a tiny red dot',
                ratio: { w: 16, h: 9 },
            }),
        );

        const sent = generateContentMock.mock.calls[0]![0];
        expect(sent.model).toBe('gemini-2.5-flash-image');
        expect(sent.contents[0]).toEqual({ text: 'a tiny red dot' });
        expect(sent.config.responseModalities).toEqual(['TEXT', 'IMAGE']);
        expect(sent.config.imageConfig.aspectRatio).toBe('16:9');
        expect(generateImagesMock).not.toHaveBeenCalled();
    });

    it('falls back to the first allowedRatio when an invalid ratio is supplied', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(inlineImageResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gemini-2.5-flash-image',
                prompt: 'hi',
                ratio: { w: 100, h: 99 }, // not in allowedRatios
            }),
        );

        const sent = generateContentMock.mock.calls[0]![0];
        // First allowedRatio is { w: 1, h: 1 }.
        expect(sent.config.imageConfig.aspectRatio).toBe('1:1');
    });

    it('returns a base64 data URL extracted from inlineData', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(inlineImageResponse);

        const result = await withTestActor(() =>
            provider.generate({
                model: 'gemini-2.5-flash-image',
                prompt: 'hi',
            }),
        );

        expect(result).toBe('data:image/png;base64,BASE64IMG');
    });

    it('throws 400 when the SDK returns no inline image data', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'no image here' }] } }],
            usageMetadata: {
                promptTokenCount: 5,
                candidatesTokenCount: 5,
                candidatesTokensDetails: [],
            },
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'gemini-2.5-flash-image',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 402 BEFORE hitting Gemini when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'gemini-2.5-flash-image',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('meters input + output:text + output:image as three batched line items at the model rates', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(inlineImageResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gemini-2.5-flash-image',
                prompt: 'hi',
            }),
        );

        // Flash model costs: input=30, output=250, output_image=3000 (cents per 1M tokens).
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const types = (
            entries as Array<{ usageType: string; usageAmount: number }>
        ).map((e) => e.usageType);
        expect(types).toEqual([
            'gemini:gemini-2.5-flash-image:input',
            'gemini:gemini-2.5-flash-image:output:text',
            'gemini:gemini-2.5-flash-image:output:image',
        ]);
        // Image-token amount comes from candidatesTokensDetails (modality=IMAGE).
        const imageEntry = (
            entries as Array<{ usageType: string; usageAmount: number }>
        ).find((e) => e.usageType.endsWith('output:image'));
        expect(imageEntry?.usageAmount).toBe(1290);
    });
});

// ── generateImages (Imagen) path ────────────────────────────────────

describe('GeminiImageProvider.generate Imagen path (generateImages)', () => {
    const imagenResponse = {
        generatedImages: [
            { image: { mimeType: 'image/png', imageBytes: 'BASE64IMAGEN' } },
        ],
    };

    it('routes generateImages-typed models to the Imagen API and returns a base64 data URL', async () => {
        const provider = makeProvider();
        generateImagesMock.mockResolvedValueOnce(imagenResponse);

        const result = await withTestActor(() =>
            provider.generate({
                // imagen-4.0-fast has apiType='generateImages'.
                model: 'imagen-4.0-fast-generate-001',
                prompt: 'a cat',
                ratio: { w: 1, h: 1 },
            }),
        );

        expect(generateContentMock).not.toHaveBeenCalled();
        expect(generateImagesMock).toHaveBeenCalledTimes(1);
        const sent = generateImagesMock.mock.calls[0]![0];
        expect(sent.model).toBe('imagen-4.0-fast-generate-001');
        expect(sent.config.aspectRatio).toBe('1:1');
        expect(sent.config.numberOfImages).toBe(1);

        expect(result).toBe('data:image/png;base64,BASE64IMAGEN');
    });

    it('meters one usage at the per-image cents rate × 1e6', async () => {
        const provider = makeProvider();
        generateImagesMock.mockResolvedValueOnce(imagenResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'imagen-4.0-fast-generate-001',
                prompt: 'a cat',
            }),
        );

        // imagen-4.0-fast: 2 cents/image → 2_000_000 microcents.
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('gemini:imagen-4.0-fast-generate-001');
        expect(count).toBe(1);
        expect(cost).toBe(2 * 1_000_000);
    });

    it('throws 400 when the Imagen response carries no image bytes', async () => {
        const provider = makeProvider();
        generateImagesMock.mockResolvedValueOnce({ generatedImages: [] });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'imagen-4.0-fast-generate-001',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when the Imagen response was filtered for safety', async () => {
        const provider = makeProvider();
        generateImagesMock.mockResolvedValueOnce({
            generatedImages: [{ raiFilteredReason: 'unsafe content' }],
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'imagen-4.0-fast-generate-001',
                    prompt: 'hi',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});
