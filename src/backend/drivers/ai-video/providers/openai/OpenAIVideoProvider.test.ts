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
 * Offline unit tests for OpenAIVideoProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs OpenAIVideoProvider directly against the live
 * wired `MeteringService`. The OpenAI SDK is mocked at the module
 * boundary — that's the real network egress point. Covers parameter
 * mapping (size/seconds normalization, input_reference forwarding),
 * polling/long-running job state, sora-2-pro size tiering, error
 * paths, and per-second cost reporting.
 */

import { Readable } from 'node:stream';
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
import { OpenAIVideoProvider } from './OpenAIVideoProvider.js';
import { OPENAI_VIDEO_MODELS } from './models.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const {
    videosCreateMock,
    videosRetrieveMock,
    videosDownloadContentMock,
    openAICtor,
} = vi.hoisted(() => ({
    videosCreateMock: vi.fn(),
    videosRetrieveMock: vi.fn(),
    videosDownloadContentMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.videos = {
            create: videosCreateMock,
            retrieve: videosRetrieveMock,
            downloadContent: videosDownloadContentMock,
        };
        // Sibling chat / image providers in the same boot.
        this.chat = { completions: { create: vi.fn() } };
        this.images = { generate: vi.fn() };
        this.audio = { speech: { create: vi.fn() } };
    });
    (OpenAICtor as unknown as { OpenAI: unknown }).OpenAI = OpenAICtor;
    return { OpenAI: OpenAICtor, default: OpenAICtor };
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
    new OpenAIVideoProvider({ apiKey: 'test-key' }, server.services.metering);

const sampleVideoBytes = () =>
    new Uint8Array(Buffer.from('video-bytes')).buffer as ArrayBuffer;

const completedJob = (
    overrides: Partial<{
        id: string;
        size: string;
        seconds: string;
    }> = {},
) => ({
    id: 'job-1',
    status: 'completed' as const,
    size: '720x1280',
    seconds: '4',
    ...overrides,
});

const downloadResponse = () => ({
    headers: new Headers({ 'content-type': 'video/mp4' }),
    body: null,
    arrayBuffer: async () => sampleVideoBytes(),
});

beforeEach(() => {
    videosCreateMock.mockReset();
    videosRetrieveMock.mockReset();
    videosDownloadContentMock.mockReset();
    openAICtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    hasCreditsSpy.mockResolvedValue(true);
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('OpenAIVideoProvider construction', () => {
    it('constructs the OpenAI SDK with the configured api key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new OpenAIVideoProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('OpenAIVideoProvider model catalog', () => {
    it('getDefaultModel() returns the first catalog entry id', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe(OPENAI_VIDEO_MODELS[0].id);
    });

    it('models() lists every catalog entry verbatim', async () => {
        const provider = makeProvider();
        expect(await provider.models()).toBe(OPENAI_VIDEO_MODELS);
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('OpenAIVideoProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2',
                test_mode: true,
            }),
        );
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(videosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('OpenAIVideoProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: '', model: 'sora-2' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: '  ', model: 'sora-2' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(videosCreateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when model is unknown', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'sora-fake' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(videosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('OpenAIVideoProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting OpenAI when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'sora-2' }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(videosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Request shape & parameter mapping ──────────────────────────────

describe('OpenAIVideoProvider.generate parameter mapping', () => {
    it('forwards model + prompt + normalised size and seconds defaults', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(completedJob());
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({ prompt: 'hi', model: 'sora-2' }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.model).toBe('sora-2');
        expect(sent.prompt).toBe('hi');
        // Default seconds = 4, default size = first dimension.
        expect(sent.seconds).toBe('4');
        expect(sent.size).toBe('720x1280');
    });

    it('snaps invalid seconds to the default (4) and invalid sizes to the first allowed', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(completedJob());
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2',
                seconds: 7, // not in [4, 8, 12]
                size: '99x99', // not in sora-2 dimensions
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.seconds).toBe('4');
        expect(sent.size).toBe('720x1280');
    });

    it('honours valid seconds and size verbatim, normalising whitespace', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(completedJob());
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2',
                seconds: '12',
                size: '1280 x 720',
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.seconds).toBe('12');
        expect(sent.size).toBe('1280x720');
    });

    it('forwards input_reference when supplied', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(completedJob());
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2',
                input_reference: 'https://example/keyframe.png',
            }),
        );

        const sent = videosCreateMock.mock.calls[0]![0];
        expect(sent.input_reference).toBe('https://example/keyframe.png');
    });
});

// ── Polling / long-running job state ───────────────────────────────

describe('OpenAIVideoProvider.generate polling', () => {
    it('returns the downloaded stream when the job completes on first poll', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(completedJob());
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        const result = (await withTestActor(() =>
            provider.generate({ prompt: 'hi', model: 'sora-2' }),
        )) as { stream: Readable; content_type: string };

        expect(result.content_type).toBe('video/mp4');
        expect(result.stream).toBeInstanceOf(Readable);
        // Retrieve doesn't need to be called when status is already
        // terminal on creation.
        expect(videosRetrieveMock).not.toHaveBeenCalled();
    });

    it('polls past queued/in_progress states until completion', async () => {
        vi.useFakeTimers();
        try {
            const provider = makeProvider();
            videosCreateMock.mockResolvedValueOnce({
                id: 'job-poll',
                status: 'queued',
                size: '720x1280',
                seconds: '4',
            });
            videosRetrieveMock
                .mockResolvedValueOnce({
                    id: 'job-poll',
                    status: 'in_progress',
                })
                .mockResolvedValueOnce(completedJob({ id: 'job-poll' }));
            videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

            const promise = withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'sora-2' }),
            );

            // Two poll intervals (5s each) → terminal state.
            await vi.advanceTimersByTimeAsync(5_000);
            await vi.advanceTimersByTimeAsync(5_000);

            await promise;
            expect(videosRetrieveMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('throws when the polled job ends in failed state', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({
            id: 'job-fail',
            status: 'failed',
            error: { message: 'content policy violation' },
            size: '720x1280',
            seconds: '4',
        });

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'sora-2' }),
            ),
        ).rejects.toThrow('content policy violation');
        expect(videosDownloadContentMock).not.toHaveBeenCalled();
    });
});

// ── Sora-2-Pro size tiers ──────────────────────────────────────────

describe('OpenAIVideoProvider.generate sora-2-pro size tiers', () => {
    it('meters the xxl tier when the resolved size is 1080x1920', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(
            completedJob({ size: '1080x1920', seconds: '4' }),
        );
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2-pro',
                size: '1080x1920',
                seconds: 4,
            }),
        );

        const proModel = OPENAI_VIDEO_MODELS.find((m) => m.id === 'sora-2-pro')!;
        const xxlPerSecond = proModel.costs!['per-second-xxl'];
        const expectedCost = xxlPerSecond * 1_000_000 * 4;

        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('openai:sora-2-pro:xxl');
        expect(count).toBe(4);
        expect(cost).toBe(expectedCost);
    });

    it('meters the xl tier when the resolved size is 1024x1792', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(
            completedJob({ size: '1024x1792', seconds: '8' }),
        );
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2-pro',
                size: '1024x1792',
                seconds: 8,
            }),
        );

        const [, usageType, count] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('openai:sora-2-pro:xl');
        expect(count).toBe(8);
    });

    it('meters the default tier on sora-2 across all dimensions', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(
            completedJob({ size: '1280x720', seconds: '8' }),
        );
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({
                prompt: 'hi',
                model: 'sora-2',
                size: '1280x720',
                seconds: 8,
            }),
        );

        const [, usageType, count] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('openai:sora-2:default');
        expect(count).toBe(8);
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('OpenAIVideoProvider.generate metering', () => {
    it('meters seconds × per-second cents × 1e6 under openai:<model>:default', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce(
            completedJob({ seconds: '4' }),
        );
        videosDownloadContentMock.mockResolvedValueOnce(downloadResponse());

        await withTestActor(() =>
            provider.generate({ prompt: 'hi', model: 'sora-2', seconds: 4 }),
        );

        const sora2 = OPENAI_VIDEO_MODELS.find((m) => m.id === 'sora-2')!;
        const expectedCost = sora2.costs!['per-second'] * 1_000_000 * 4;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('openai:sora-2:default');
        expect(count).toBe(4);
        expect(cost).toBe(expectedCost);
    });

    it('does NOT meter when the job ends in failed state', async () => {
        const provider = makeProvider();
        videosCreateMock.mockResolvedValueOnce({
            id: 'job-fail',
            status: 'failed',
            error: { message: 'boom' },
            size: '720x1280',
            seconds: '4',
        });

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'sora-2' }),
            ),
        ).rejects.toThrow();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('OpenAIVideoProvider.generate error paths', () => {
    it('propagates SDK errors thrown from videos.create and does not meter', async () => {
        const provider = makeProvider();
        const apiError = new Error('upstream blew up');
        videosCreateMock.mockRejectedValueOnce(apiError);

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'hi', model: 'sora-2' }),
            ),
        ).rejects.toBe(apiError);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
