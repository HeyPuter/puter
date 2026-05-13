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
 * Offline unit tests for TogetherVideoProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs TogetherVideoProvider directly against the
 * live wired `MeteringService`. The Together SDK is mocked at the
 * module boundary — that's the real network egress point. Covers
 * parameter mapping (durations, dimensions, frame_images, etc.),
 * polling/long-running job state, error paths, and cost reporting.
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
import { TogetherVideoProvider } from './TogetherVideoProvider.js';
import { TOGETHER_VIDEO_GENERATION_MODELS } from './models.js';

// ── Together SDK mock ───────────────────────────────────────────────

const { videosCreateMock, videosRetrieveMock, togetherCtor } = vi.hoisted(
    () => ({
        videosCreateMock: vi.fn(),
        videosRetrieveMock: vi.fn(),
        togetherCtor: vi.fn(),
    }),
);

vi.mock('together-ai', () => {
    const TogetherCtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        togetherCtor(opts);
        this.videos = {
            create: videosCreateMock,
            retrieve: videosRetrieveMock,
        };
        // Sibling Together-backed providers also boot during PuterServer
        // start — keep their namespaces happy.
        this.images = { generate: vi.fn() };
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
    new TogetherVideoProvider(
        { apiKey: 'test-key' },
        server.services.metering,
    );

beforeEach(() => {
    videosCreateMock.mockReset();
    videosRetrieveMock.mockReset();
    togetherCtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    // Default to "has credits" so per-test setup only needs to override
    // for the explicit credit-gate scenarios. SYSTEM_ACTOR has no uuid,
    // so the live `getRemainingUsage` path can short-circuit to 0.
    hasCreditsSpy.mockResolvedValue(true);
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('TogetherVideoProvider construction', () => {
    it('constructs the Together SDK with the configured api key', () => {
        makeProvider();
        expect(togetherCtor).toHaveBeenCalledTimes(1);
        expect(togetherCtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new TogetherVideoProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('TogetherVideoProvider model catalog', () => {
    it('getDefaultModel() returns the togetherai-prefixed director model', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(
            'togetherai:minimax/video-01-director',
        );
    });

    it('models() lists every catalog entry with togetherai- aliases populated', async () => {
        const provider = makeProvider();
        const models = await provider.models();
        expect(models.length).toBe(TOGETHER_VIDEO_GENERATION_MODELS.length);
        for (const m of models) {
            // Provider attaches `aliases: [model]` — the bare model id
            // (no togetherai: prefix) should be there.
            expect(m.aliases?.length ?? 0).toBeGreaterThan(0);
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('TogetherVideoProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({ prompt: 'hi', test_mode: true }),
        );
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(videosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('TogetherVideoProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.generate({ prompt: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.generate({ prompt: '  ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(videosCreateMock).not.toHaveBeenCalled();
    });

    it('throws when no pricing exists for the resolved model', async () => {
        const provider = makeProvider();
        // Passing an unknown id falls back to the bare model string,
        // which has no entry in the cost table — provider should throw
        // before calling the SDK.
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'nonexistent/model' }),
            ),
        ).rejects.toThrow(/No pricing configured/);
        expect(videosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('TogetherVideoProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting Together when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(videosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Request shape & parameter mapping ──────────────────────────────

describe('TogetherVideoProvider.generate parameter mapping', () => {
    it('strips the togetherai: prefix from the model id on the wire', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/video-01-director',
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.model).toBe('minimax/video-01-director');
        expect(sent.prompt).toBe('hi');
    });

    it('defaults seconds to 6 when no_extra_params is unset and no value is supplied', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() => provider.generate({ prompt: 'hi' }));

        const sent = videosCreateMock.mock.calls[0]![0];
        // String-encoded per the SDK contract.
        expect(sent.seconds).toBe('6');
    });

    it('omits seconds when no_extra_params is set and no value is supplied', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() =>
            provider.generate({ prompt: 'hi', no_extra_params: true }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect('seconds' in sent).toBe(false);
    });

    it('forwards width/height/fps/steps/guidance_scale/seed/negative_prompt verbatim', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                width: 1280,
                height: 720,
                fps: 24,
                steps: 30,
                guidance_scale: 7.5,
                seed: 42,
                negative_prompt: 'no rain',
                output_format: 'mp4',
                output_quality: 90,
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.width).toBe(1280);
        expect(sent.height).toBe(720);
        expect(sent.fps).toBe(24);
        expect(sent.steps).toBe(30);
        expect(sent.guidance_scale).toBe(7.5);
        expect(sent.seed).toBe(42);
        expect(sent.negative_prompt).toBe('no rain');
        expect(sent.output_format).toBe('mp4');
        expect(sent.output_quality).toBe(90);
    });

    it('filters reference_images and frame_images to valid shapes', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                reference_images: [
                    'https://example/a.png',
                    '  ',
                    '',
                    'https://example/b.png',
                ] as never,
                frame_images: [
                    { input_image: 'https://example/keyframe.png' },
                    { input_image: 123 }, // non-string → filtered
                    {} as never, // missing → filtered
                ] as never,
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.reference_images).toEqual([
            'https://example/a.png',
            'https://example/b.png',
        ]);
        expect(sent.frame_images).toEqual([
            { input_image: 'https://example/keyframe.png' },
        ]);
    });

    it('forwards metadata when it is an object', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                metadata: { traceId: 'abc-123' },
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.metadata).toEqual({ traceId: 'abc-123' });
    });
});

// ── Polling / long-running job state ───────────────────────────────

describe('TogetherVideoProvider.generate polling', () => {
    it('returns the video_url from a job that completes on first poll', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        const result = await withTestActor(() =>
            provider.generate({ prompt: 'hi' }),
        );
        expect(result).toBe('https://together/out.mp4');
        // No retries needed.
        expect(videosRetrieveMock).toHaveBeenCalledTimes(1);
    });

    it('polls past queued → in_progress states until completion', async () => {
        vi.useFakeTimers();
        try {
            const provider = makeProvider();
            videosCreateMock.mockResolvedValueOnce({ id: 'job-2' });
            videosRetrieveMock
                .mockResolvedValueOnce({ id: 'job-2', status: 'queued' })
                .mockResolvedValueOnce({ id: 'job-2', status: 'in_progress' })
                .mockResolvedValueOnce({
                    id: 'job-2',
                    status: 'completed',
                    outputs: { video_url: 'https://together/done.mp4' },
                });

            const promise = withTestActor(() =>
                provider.generate({ prompt: 'hi' }),
            );

            // Advance through two 5s poll intervals to reach completion.
            await vi.advanceTimersByTimeAsync(5_000);
            await vi.advanceTimersByTimeAsync(5_000);

            expect(await promise).toBe('https://together/done.mp4');
            expect(videosRetrieveMock).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('throws HttpError 500 on failed jobs with the surfaced error message', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-3' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-3',
            status: 'failed',
            error: { message: 'content policy violation' },
        });

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({
            statusCode: 500,
            message: 'content policy violation',
        });
    });

    it('throws when a finished job has no video_url', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-4' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-4',
            status: 'completed',
            outputs: {},
        });

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toThrow(/did not include a video URL/);
    });

    it('throws when a job is cancelled mid-flight', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-5' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-5',
            status: 'cancelled',
        });

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toThrow(/cancelled/);
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('TogetherVideoProvider.generate metering', () => {
    it('meters one usage line per video at the per-video cents × 1e6 rate', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-1' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-1',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/video-01-director',
            }),
        );

        // The director model is 28 cents per video → 28_000_000 microcents.
        const directorModel = TOGETHER_VIDEO_GENERATION_MODELS.find(
            (m) => m.model === 'minimax/video-01-director',
        )!;
        const expectedCost = directorModel.costs['per-video'] * 1_000_000;

        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('together-video:minimax/video-01-director');
        expect(count).toBe(1);
        expect(cost).toBe(expectedCost);
    });

    it('does NOT meter when the job fails', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({ id: 'job-fail' });
        videosRetrieveMock.mockResolvedValueOnce({
            id: 'job-fail',
            status: 'failed',
            error: { message: 'boom' },
        });

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toThrow();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('TogetherVideoProvider.generate error paths', () => {
    it('propagates SDK errors thrown from videos.create and does not meter', async () => {
        const provider = makeProvider();
        const apiError = new Error('upstream blew up');
        videosCreateMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' })),
        ).rejects.toBe(apiError);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
