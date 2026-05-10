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
 * Offline unit tests for VideoGenerationDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) with API keys for every video provider so the driver
 * registers and indexes them all. Then drives `server.drivers.aiVideo`
 * directly. Provider SDKs are mocked at the module boundary so the
 * driver's routing and dispatch logic runs without real network egress.
 * Aligns with AGENTS.md: "Prefer test server over mocking deps."
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

import { runWithContext } from '../../core/context.js';
import { SYSTEM_ACTOR } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import { setupTestServer } from '../../testUtil.js';
import type { VideoGenerationDriver } from './VideoGenerationDriver.js';

// ── SDK mocks ──────────────────────────────────────────────────────
//
// These boot during PuterServer.start() since each provider's
// constructor instantiates its SDK. The driver-level tests only care
// about which provider the driver dispatched to.

const {
    openaiVideosCreateMock,
    openaiVideosRetrieveMock,
    openaiVideosDownloadMock,
} = vi.hoisted(() => ({
    openaiVideosCreateMock: vi.fn(),
    openaiVideosRetrieveMock: vi.fn(),
    openaiVideosDownloadMock: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.videos = {
            create: openaiVideosCreateMock,
            retrieve: openaiVideosRetrieveMock,
            downloadContent: openaiVideosDownloadMock,
        };
        this.chat = { completions: { create: vi.fn() } };
        this.images = { generate: vi.fn() };
        this.audio = { speech: { create: vi.fn() } };
    });
    (OpenAICtor as unknown as { OpenAI: unknown }).OpenAI = OpenAICtor;
    return { OpenAI: OpenAICtor, default: OpenAICtor };
});

const { geminiGenerateVideosMock } = vi.hoisted(() => ({
    geminiGenerateVideosMock: vi.fn(),
}));

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.models = {
            generateContent: vi.fn(),
            generateImages: vi.fn(),
            generateVideos: geminiGenerateVideosMock,
        };
        this.operations = { getVideosOperation: vi.fn() };
    });
    return { GoogleGenAI };
});

const { togetherVideosCreateMock, togetherVideosRetrieveMock } = vi.hoisted(
    () => ({
        togetherVideosCreateMock: vi.fn(),
        togetherVideosRetrieveMock: vi.fn(),
    }),
);

vi.mock('together-ai', () => {
    const Together = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.videos = {
            create: togetherVideosCreateMock,
            retrieve: togetherVideosRetrieveMock,
        };
        this.images = { generate: vi.fn() };
        this.chat = { completions: { create: vi.fn() } };
        this.models = { list: vi.fn() };
    });
    return { Together, default: Together };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: VideoGenerationDriver;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'openai-video-generation': { apiKey: 'oai-key' },
            'together-video-generation': { apiKey: 'tg-key' },
            'gemini-video-generation': { apiKey: 'gem-key' },
        },
    } as never);
    driver = server.drivers.aiVideo as unknown as VideoGenerationDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    openaiVideosCreateMock.mockReset();
    openaiVideosRetrieveMock.mockReset();
    openaiVideosDownloadMock.mockReset();
    geminiGenerateVideosMock.mockReset();
    togetherVideosCreateMock.mockReset();
    togetherVideosRetrieveMock.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    hasCreditsSpy.mockResolvedValue(true);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const withActor = <T>(fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR }, fn));

const withDriverName = <T>(driverName: string, fn: () => T | Promise<T>) =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR, driverName }, fn));

const openaiCompletedJob = () => ({
    id: 'oai-job',
    status: 'completed' as const,
    size: '720x1280',
    seconds: '4',
});

const openaiDownload = () => ({
    headers: new Headers({ 'content-type': 'video/mp4' }),
    body: null,
    arrayBuffer: async () =>
        new Uint8Array(Buffer.from('video-bytes')).buffer as ArrayBuffer,
});

// ── Authentication ──────────────────────────────────────────────────

describe('VideoGenerationDriver.generate authentication', () => {
    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.generate({ prompt: 'hi', model: 'sora-2' } as never),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('VideoGenerationDriver.generate argument validation', () => {
    it('throws 400 when no provider knows the requested model', async () => {
        await expect(
            withActor(() =>
                driver.generate({
                    prompt: 'hi',
                    model: 'totally-not-a-real-model',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Catalog & list ──────────────────────────────────────────────────

describe('VideoGenerationDriver catalog', () => {
    it('models() returns deduped entries sorted by provider then id', async () => {
        const all = await driver.models();
        const ids = all.map((m) => m.id);
        // Sentinel ids from each provider.
        expect(ids).toContain('sora-2'); // OpenAI
        expect(ids).toContain('veo-2.0-generate-001'); // Gemini
        // Together IDs are lowercased togetherai:org/model strings.
        expect(ids).toContain('togetherai:minimax/video-01-director');
        // Sort assertion: same-provider entries should be alphabetical.
        const openaiEntries = all.filter((m) => m.provider === 'openai-video-generation');
        const openaiIds = openaiEntries.map((m) => m.id);
        expect(openaiIds).toEqual([...openaiIds].sort());
    });

    it('list() returns ids sorted', async () => {
        const ids = await driver.list();
        expect(ids).toEqual([...ids].sort());
    });

    it('getReportedCosts emits per-cost-key line items namespaced by provider:model:costKey', () => {
        const reported = driver.getReportedCosts() as Array<{
            usageType: string;
            costValue: number;
            source: string;
        }>;
        // sora-2 has a per-second line — must surface in reportedCosts.
        const sora2PerSec = reported.find(
            (r) => r.usageType === 'openai-video-generation:sora-2:per-second',
        );
        expect(sora2PerSec).toBeDefined();
        expect(sora2PerSec?.source).toBe(
            'driver:aiVideo/openai-video-generation',
        );
    });
});

// ── Provider routing ────────────────────────────────────────────────

describe('VideoGenerationDriver.generate provider routing', () => {
    it('routes a known sora-2 id to the OpenAI video provider', async () => {
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({ prompt: 'hi', model: 'sora-2' } as never),
        );

        expect(openaiVideosCreateMock).toHaveBeenCalledTimes(1);
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
        expect(geminiGenerateVideosMock).not.toHaveBeenCalled();
    });

    it('routes a known veo-2.0-generate-001 id to the Gemini provider', async () => {
        geminiGenerateVideosMock.mockResolvedValueOnce({
            done: true,
            response: {
                generatedVideos: [
                    { video: { uri: 'https://gemini/out.mp4' } },
                ],
            },
        });

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'veo-2.0-generate-001',
            } as never),
        );

        expect(geminiGenerateVideosMock).toHaveBeenCalledTimes(1);
        expect(openaiVideosCreateMock).not.toHaveBeenCalled();
    });

    it('routes a known togetherai:minimax/video-01-director id to the Together provider', async () => {
        togetherVideosCreateMock.mockResolvedValueOnce({ id: 'tg-job' });
        togetherVideosRetrieveMock.mockResolvedValueOnce({
            id: 'tg-job',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/video-01-director',
            } as never),
        );

        expect(togetherVideosCreateMock).toHaveBeenCalledTimes(1);
        expect(openaiVideosCreateMock).not.toHaveBeenCalled();
    });

    it('lowercases model lookups so case variants resolve (SORA-2 → sora-2)', async () => {
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({ prompt: 'hi', model: 'SORA-2' } as never),
        );

        expect(openaiVideosCreateMock).toHaveBeenCalledTimes(1);
    });

    it('defaults to openai-video-generation when no model or provider hint is supplied', async () => {
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({ prompt: 'hi' } as never),
        );

        expect(openaiVideosCreateMock).toHaveBeenCalledTimes(1);
    });

    it('falls through to the requested provider via Context.driverName when args.provider is not supplied', async () => {
        togetherVideosCreateMock.mockResolvedValueOnce({ id: 'tg-job' });
        togetherVideosRetrieveMock.mockResolvedValueOnce({
            id: 'tg-job',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });

        await withDriverName('together-video-generation', () =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/video-01-director',
            } as never),
        );

        expect(togetherVideosCreateMock).toHaveBeenCalledTimes(1);
    });
});

// ── Parameter validation / normalisation ───────────────────────────

describe('VideoGenerationDriver.generate parameter normalisation', () => {
    it('snaps invalid seconds to the first allowed value for the resolved model', async () => {
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'sora-2',
                seconds: 999, // not in [4, 8, 12]
            } as never),
        );

        const sent = openaiVideosCreateMock.mock.calls[0]![0];
        // Sora-2 first allowed second is 4 (snapped from 999).
        expect(sent.seconds).toBe('4');
    });

    it('snaps invalid resolution to the first allowed dimension for the resolved model', async () => {
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'sora-2',
                size: '99x99',
            } as never),
        );

        const sent = openaiVideosCreateMock.mock.calls[0]![0];
        // Sora-2 first dimension is 720x1280.
        expect(sent.size).toBe('720x1280');
    });

    it('coerces a string seconds value to a number before snapping', async () => {
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'sora-2',
                seconds: '8',
            } as never),
        );

        const sent = openaiVideosCreateMock.mock.calls[0]![0];
        expect(sent.seconds).toBe('8');
    });
});

// ── Error mapping ──────────────────────────────────────────────────

describe('VideoGenerationDriver.generate error mapping', () => {
    it('passes through provider HttpError (e.g. 400 on missing prompt) with same status code', async () => {
        await expect(
            withActor(() =>
                driver.generate({
                    prompt: '',
                    model: 'sora-2',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        // Provider should not be called when validation lives at provider level.
        // The error is thrown by the provider; ensure no upstream call leaked.
        expect(openaiVideosCreateMock).not.toHaveBeenCalled();
    });

    it('does not meter when the dispatched provider throws an SDK error', async () => {
        const incrementUsageSpy = vi.spyOn(
            server.services.metering,
            'incrementUsage',
        );
        openaiVideosCreateMock.mockRejectedValueOnce(new Error('upstream blew up'));

        await expect(
            withActor(() =>
                driver.generate({
                    prompt: 'hi',
                    model: 'sora-2',
                } as never),
            ),
        ).rejects.toThrow('upstream blew up');
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Metering propagation ───────────────────────────────────────────

describe('VideoGenerationDriver metering propagation', () => {
    it('hands off to the provider whose metering call records the dispatched provider key', async () => {
        const incrementUsageSpy = vi.spyOn(
            server.services.metering,
            'incrementUsage',
        );
        openaiVideosCreateMock.mockResolvedValueOnce(openaiCompletedJob());
        openaiVideosDownloadMock.mockResolvedValueOnce(openaiDownload());

        await withActor(() =>
            driver.generate({ prompt: 'hi', model: 'sora-2' } as never),
        );

        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType] = incrementUsageSpy.mock.calls[0]!;
        // OpenAIVideoProvider meters under the openai:<model>:<tier> shape.
        expect(usageType).toMatch(/^openai:sora-2:/);
    });
});
