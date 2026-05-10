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
 * Offline unit tests for GeminiVideoProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs GeminiVideoProvider directly against the live
 * wired `MeteringService`. The Google GenAI SDK is mocked at the
 * module boundary — that's the real network egress point. Covers
 * parameter mapping (size→aspectRatio/resolution, image/video refs,
 * negative_prompt, lastFrame), polling for the long-running operation,
 * tier-aware metering, content-filter handling, and error paths.
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
import { GeminiVideoProvider } from './GeminiVideoProvider.js';
import { GEMINI_VIDEO_GENERATION_MODELS } from './models.js';

// ── Google GenAI SDK mock ───────────────────────────────────────────

const { generateVideosMock, getVideosOperationMock, googleAICtor } = vi.hoisted(
    () => ({
        generateVideosMock: vi.fn(),
        getVideosOperationMock: vi.fn(),
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
            generateVideos: generateVideosMock,
            generateContent: vi.fn(),
            generateImages: vi.fn(),
        };
        this.operations = {
            getVideosOperation: getVideosOperationMock,
        };
    });
    return { GoogleGenAI };
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
    new GeminiVideoProvider({ apiKey: 'test-key' }, server.services.metering);

// Canned terminal operation that the polling loop reads.
const completedOperation = (
    overrides: Partial<{
        uri: string;
        videoBytes: string;
        mimeType: string;
    }> = {},
) => ({
    done: true,
    response: {
        generatedVideos: [
            {
                video: {
                    uri: 'https://gemini/out.mp4',
                    ...overrides,
                },
            },
        ],
    },
});

beforeEach(() => {
    generateVideosMock.mockReset();
    getVideosOperationMock.mockReset();
    googleAICtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    hasCreditsSpy.mockResolvedValue(true);
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('GeminiVideoProvider construction', () => {
    it('constructs the GoogleGenAI SDK with the configured api key', () => {
        makeProvider();
        expect(googleAICtor).toHaveBeenCalledTimes(1);
        expect(googleAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new GeminiVideoProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('GeminiVideoProvider model catalog', () => {
    it('getDefaultModel() returns the first catalog entry id', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            GEMINI_VIDEO_GENERATION_MODELS[0].id,
        );
    });

    it('models() decorates entries with google/<id> aliases', async () => {
        const provider = makeProvider();
        const models = await provider.models();
        expect(models.length).toBe(GEMINI_VIDEO_GENERATION_MODELS.length);
        for (const m of models) {
            expect(m.aliases).toEqual(
                expect.arrayContaining([m.id, `google/${m.id}`]),
            );
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('GeminiVideoProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({ prompt: 'hi', test_mode: true }),
        );
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateVideosMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('GeminiVideoProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.generate({ prompt: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.generate({ prompt: '   ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateVideosMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('GeminiVideoProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting Gemini when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateVideosMock).not.toHaveBeenCalled();
    });
});

// ── Request shape & parameter mapping ──────────────────────────────

describe('GeminiVideoProvider.generate parameter mapping', () => {
    it('uses model defaults when no size/seconds/duration are supplied', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
            }),
        );

        const sent = generateVideosMock.mock.calls[0]![0];
        expect(sent.model).toBe('veo-2.0-generate-001');
        expect(sent.prompt).toBe('hi');
        expect(sent.config.numberOfVideos).toBe(1);
        // veo-2.0 default aspectRatio is 16:9; durationSeconds[0] = 5.
        expect(sent.config.aspectRatio).toBe('16:9');
        expect(sent.config.durationSeconds).toBe(5);
    });

    it('maps size=1080x1920 → aspectRatio 9:16 + resolution 1080p (forcing 8s)', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-3.0-generate-001',
                size: '1080x1920',
                seconds: 4, // overridden by isHighRes
            }),
        );

        const sent = generateVideosMock.mock.calls[0]![0];
        expect(sent.config.aspectRatio).toBe('9:16');
        expect(sent.config.resolution).toBe('1080p');
        expect(sent.config.durationSeconds).toBe(8);
    });

    it('forwards a negative_prompt onto config when non-empty', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
                negative_prompt: 'no rain',
            }),
        );

        const sent = generateVideosMock.mock.calls[0]![0];
        expect(sent.config.negativePrompt).toBe('no rain');
    });

    it('parses base64 data URLs as image input for image-to-video models', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        const dataUrl = `data:image/png;base64,AAA`;
        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
                input_reference: dataUrl,
            }),
        );

        const sent = generateVideosMock.mock.calls[0]![0];
        expect(sent.image).toEqual({ imageBytes: 'AAA', mimeType: 'image/png' });
    });

    it('attaches lastFrame parsed from a data URL (when reference_images is not set)', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
                last_frame: `data:image/jpeg;base64,XYZ`,
            }),
        );

        const sent = generateVideosMock.mock.calls[0]![0];
        expect(sent.config.lastFrame).toEqual({
            imageBytes: 'XYZ',
            mimeType: 'image/jpeg',
        });
    });

    it('passes reference_images (clamped to 3) on models that support them and skips first-frame/lastFrame', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-3.1-generate-preview',
                reference_images: [
                    'data:image/png;base64,A',
                    'data:image/png;base64,B',
                    'data:image/png;base64,C',
                    'data:image/png;base64,D', // dropped (over 3)
                ] as never,
                input_reference: 'data:image/png;base64,FIRST',
                last_frame: 'data:image/png;base64,LAST',
            }),
        );

        const sent = generateVideosMock.mock.calls[0]![0];
        expect(sent.config.referenceImages).toHaveLength(3);
        expect(sent.image).toBeUndefined();
        // 8s is forced when reference_images is set.
        expect(sent.config.durationSeconds).toBe(8);
        // lastFrame should NOT be on the wire because reference_images is set.
        expect('lastFrame' in sent.config).toBe(false);
    });
});

// ── Polling / long-running operation ───────────────────────────────

describe('GeminiVideoProvider.generate polling', () => {
    it('returns the uri from an operation that completes on first poll', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        const result = await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
            }),
        );
        expect(result).toBe('https://gemini/out.mp4');
    });

    it('polls past not-done operations until completion', async () => {
        vi.useFakeTimers();
        try {
            const provider = makeProvider();
            generateVideosMock.mockResolvedValueOnce({ done: false });
            getVideosOperationMock
                .mockResolvedValueOnce({ done: false })
                .mockResolvedValueOnce(completedOperation());

            const promise = withTestActor(() =>
                provider.generate({
                    prompt: 'hi',
                    model: 'veo-2.0-generate-001',
                }),
            );

            // 10s poll interval × 2.
            await vi.advanceTimersByTimeAsync(10_000);
            await vi.advanceTimersByTimeAsync(10_000);

            const result = await promise;
            expect(result).toBe('https://gemini/out.mp4');
            expect(getVideosOperationMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('throws when the operation finishes with an error', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce({
            done: true,
            error: { message: 'rate limit' },
            response: {},
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    prompt: 'hi',
                    model: 'veo-2.0-generate-001',
                }),
            ),
        ).rejects.toThrow(/rate limit/);
    });

    it('throws 400 with the filter reason when raiMediaFilteredCount > 0', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce({
            done: true,
            response: {
                generatedVideos: [],
                raiMediaFilteredCount: 1,
                raiMediaFilteredReasons: ['unsafe content'],
            },
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    prompt: 'hi',
                    model: 'veo-2.0-generate-001',
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('unsafe content'),
        });
    });

    it('throws when the operation returns no generatedVideos and no filter', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce({
            done: true,
            response: {},
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    prompt: 'hi',
                    model: 'veo-2.0-generate-001',
                }),
            ),
        ).rejects.toThrow(/did not include a video/);
    });

    it('returns a base64 data URL when the operation surfaces videoBytes', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce({
            done: true,
            response: {
                generatedVideos: [
                    {
                        video: {
                            videoBytes: 'ZZZ',
                            mimeType: 'video/mp4',
                        },
                    },
                ],
            },
        });

        const result = await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
            }),
        );
        expect(result).toBe('data:video/mp4;base64,ZZZ');
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('GeminiVideoProvider.generate metering', () => {
    it('meters duration × per-second cents under gemini:<model> on the standard tier', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
                seconds: 6,
            }),
        );

        const veo2 = GEMINI_VIDEO_GENERATION_MODELS.find(
            (m) => m.id === 'veo-2.0-generate-001',
        )!;
        const perSec = veo2.costs!['per-second'];
        // ceil(perSec * 6 * 1e6) — perSec is an integer cents value so
        // no rounding occurs in practice.
        const expectedCost = Math.ceil(perSec * 6 * 1_000_000);

        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('gemini:veo-2.0-generate-001');
        expect(count).toBe(6);
        expect(cost).toBe(expectedCost);
    });

    it('meters under the :1080p suffix when the model has a tier rate and size is 1080p', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-3.1-lite-generate-preview',
                size: '1920x1080',
                seconds: 8,
            }),
        );

        const [, usageType] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('gemini:veo-3.1-lite-generate-preview:1080p');
    });

    it('meters under the :4k suffix when the model has a tier rate and size is 4k', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce(completedOperation());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'veo-3.1-generate-preview',
                size: '3840x2160',
                seconds: 8,
            }),
        );

        const [, usageType] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('gemini:veo-3.1-generate-preview:4k');
    });

    it('does NOT meter when the operation errors out', async () => {
        const provider = makeProvider();
        generateVideosMock.mockResolvedValueOnce({
            done: true,
            error: { message: 'boom' },
            response: {},
        });

        await expect(
            withTestActor(() =>
                provider.generate({
                    prompt: 'hi',
                    model: 'veo-2.0-generate-001',
                }),
            ),
        ).rejects.toThrow();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('GeminiVideoProvider.generate error paths', () => {
    it('propagates SDK errors thrown from generateVideos and does not meter', async () => {
        const provider = makeProvider();
        const apiError = new Error('upstream blew up');
        generateVideosMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.generate({
                    prompt: 'hi',
                    model: 'veo-2.0-generate-001',
                }),
            ),
        ).rejects.toBe(apiError);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
