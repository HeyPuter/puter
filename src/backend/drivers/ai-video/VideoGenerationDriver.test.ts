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
import { TOGETHER_VIDEO_GENERATION_MODELS } from './providers/together/models.js';
import type { VideoGenerationDriver } from './VideoGenerationDriver.js';

const DEFAULT_MODEL = 'togetherai:wan-ai/wan2.7-t2v';
const DEFAULT_WIRE_MODEL = 'Wan-AI/wan2.7-t2v';

// ── SDK mocks ──────────────────────────────────────────────────────
//
// These boot during PuterServer.start() since each provider's
// constructor instantiates its SDK. The driver-level tests only care
// about which provider the driver dispatched to.

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

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));

vi.mock('../../util/secureHttp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util/secureHttp.js')>()),
    secureFetch: secureFetchMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: VideoGenerationDriver;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'together-video-generation': { apiKey: 'tg-key' },
            // Configured on purpose: a Gemini key must no longer register a
            // video provider now that its Veo previews are gone.
            'gemini-video-generation': { apiKey: 'gem-key' },
        },
    } as never);
    driver = server.drivers.aiVideo as unknown as VideoGenerationDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    togetherVideosCreateMock.mockReset();
    togetherVideosRetrieveMock.mockReset();
    secureFetchMock.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    hasCreditsSpy.mockResolvedValue(true);
    vi.spyOn(server.services.metering, 'getRemainingUsage').mockResolvedValue(
        100_000_000_000,
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

const withActor = <T>(fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR }, fn));

const withDriverName = <T>(driverName: string, fn: () => T | Promise<T>) =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR, driverName }, fn));

// Queues one Together job that completes on the first poll.
const completeTogetherJob = (videoUrl = 'https://together/out.mp4') => {
    togetherVideosCreateMock.mockResolvedValueOnce({ id: 'tg-job' });
    togetherVideosRetrieveMock.mockResolvedValueOnce({
        id: 'tg-job',
        status: 'completed',
        outputs: { video_url: videoUrl },
    });
};

const togetherSent = (call = 0) =>
    togetherVideosCreateMock.mock.calls[call]![0] as Record<string, unknown>;

// ── Authentication ──────────────────────────────────────────────────

describe('VideoGenerationDriver.generate authentication', () => {
    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.generate({ prompt: 'hi', model: DEFAULT_MODEL } as never),
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

// Providers hand these catalogs to the driver by module-level reference
// (via per-call copies), so #buildModelMap must never write through to
// them: an in-place id normalization or puterId append would accumulate
// across map builds. Cloned at import time, before beforeAll boots the
// server that builds the map. (Same regression as in
// ChatCompletionDriver.test.ts.)
const pristineCatalogs = structuredClone({
    TOGETHER_VIDEO_GENERATION_MODELS,
});

describe('VideoGenerationDriver catalog', () => {
    it('does not mutate the catalog objects providers hand back', () => {
        expect({
            TOGETHER_VIDEO_GENERATION_MODELS,
        }).toEqual(pristineCatalogs);
    });

    it('models() returns deduped entries sorted by provider then id', async () => {
        const all = await driver.models();
        const ids = all.map((m) => m.id);
        // Together IDs are lowercased togetherai:org/model strings.
        expect(ids).toContain('togetherai:minimax/video-01-director');
        expect(ids.some((id) => id.includes('sora'))).toBe(false);
        // Sort assertion: same-provider entries should be alphabetical.
        const togetherIds = all
            .filter((m) => m.provider === 'together-video-generation')
            .map((m) => m.id);
        expect(togetherIds).toEqual([...togetherIds].sort());
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
        // The default model has a per-second line — must surface in reportedCosts.
        const litePerSec = reported.find(
            (r) =>
                r.usageType ===
                `together-video-generation:${DEFAULT_MODEL}:per-second`,
        );
        expect(litePerSec).toBeDefined();
        expect(litePerSec?.source).toBe(
            'driver:aiVideo/together-video-generation',
        );
    });
});

// ── Provider routing ────────────────────────────────────────────────

describe('VideoGenerationDriver.generate provider routing', () => {
    it.each(['__proto__', 'constructor'])(
        'rejects inherited object keys as unknown models: %s',
        async (model) => {
            await expect(
                withDriverName('ai-video', () =>
                    driver.generate({ prompt: 'hi', model }),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect(togetherVideosCreateMock).not.toHaveBeenCalled();
        },
    );

    it.each(['__proto__', 'constructor'])(
        'uses the default for an unknown provider named %s',
        async (provider) => {
            completeTogetherJob();
            await withActor(() => driver.generate({ prompt: 'hi', provider }));
            expect(togetherSent().model).toBe(DEFAULT_WIRE_MODEL);
        },
    );

    it.each([
        'veo-3.1-generate-preview',
        'veo-3.1-fast-generate-preview',
        'veo-3.1-lite-generate-preview',
        'google:google/veo-3.1-lite',
    ])('rejects the retired Gemini Veo preview id %s', async (model) => {
        await expect(
            withActor(() => driver.generate({ prompt: 'hi', model } as never)),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('registers no Gemini video provider even when a Gemini key is configured', async () => {
        const all = await driver.models();
        expect(
            all.some((m) => m.provider === 'gemini-video-generation'),
        ).toBe(false);
        expect(driver.driverAliases).not.toContain('gemini-video-generation');
    });

    it.each([
        'togetherai:google/veo-2.0',
        'togetherai:kwaivgi/kling-2.1-master',
        'togetherai:kwaivgi/kling-2.1-standard',
        'togetherai:kwaivgi/kling-2.1-pro',
        'togetherai:kwaivgi/kling-1.6-standard',
        'kling-2.1-master',
        'veo-2.0',
    ])('rejects the delisted Together model %s', async (model) => {
        await expect(
            withActor(() => driver.generate({ prompt: 'hi', model } as never)),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
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
    });

    it('lowercases model lookups so case variants resolve (WAN2.7-T2V → wan2.7-t2v)', async () => {
        completeTogetherJob();

        await withActor(() =>
            driver.generate({ prompt: 'hi', model: 'WAN2.7-T2V' } as never),
        );

        expect(togetherVideosCreateMock).toHaveBeenCalledTimes(1);
        expect(togetherSent().model).toBe(DEFAULT_WIRE_MODEL);
    });

    it('defaults to Wan 2.7 T2V on Together when no model or provider hint is supplied', async () => {
        completeTogetherJob();

        await withActor(() => driver.generate({ prompt: 'hi' } as never));

        expect(togetherVideosCreateMock).toHaveBeenCalledTimes(1);
        expect(togetherSent().model).toBe(DEFAULT_WIRE_MODEL);
    });

    it('still defaults to Wan 2.7 T2V when Context.driverName is the generic ai-video alias', async () => {
        completeTogetherJob();

        await withDriverName('ai-video', () =>
            driver.generate({ prompt: 'hi' } as never),
        );

        expect(togetherVideosCreateMock).toHaveBeenCalledTimes(1);
        expect(togetherSent().model).toBe(DEFAULT_WIRE_MODEL);
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
        completeTogetherJob();

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                seconds: 999, // outside Wan 2.7's 2-15s range
            } as never),
        );

        // Wan 2.7 T2V's default (first) duration is 5 seconds.
        expect(togetherSent().seconds).toBe('5');
    });

    it('snaps invalid resolution to the first allowed dimension for the resolved model', async () => {
        completeTogetherJob();

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                resolution: '4k',
            } as never),
        );

        // Wan 2.7 T2V's first tier is 720P.
        expect(togetherSent().resolution).toBe('720P');
    });

    it('coerces a string seconds value to a number before snapping', async () => {
        completeTogetherJob();

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                seconds: '8',
            } as never),
        );

        expect(togetherSent().seconds).toBe('8');
    });
});

// ── Error mapping ──────────────────────────────────────────────────

describe('VideoGenerationDriver.generate error mapping', () => {
    it('passes through provider HttpError (e.g. 400 on missing prompt) with same status code', async () => {
        await expect(
            withActor(() =>
                driver.generate({
                    prompt: '',
                    model: DEFAULT_MODEL,
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        // Provider should not be called when validation lives at provider level.
        // The error is thrown by the provider; ensure no upstream call leaked.
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('does not meter when the dispatched provider throws an SDK error', async () => {
        const incrementUsageSpy = vi.spyOn(
            server.services.metering,
            'incrementUsage',
        );
        togetherVideosCreateMock.mockRejectedValueOnce(
            new Error('upstream blew up'),
        );

        await expect(
            withActor(() =>
                driver.generate({
                    prompt: 'hi',
                    model: DEFAULT_MODEL,
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
        completeTogetherJob();

        await withActor(() =>
            driver.generate({ prompt: 'hi', model: DEFAULT_MODEL } as never),
        );

        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType] = incrementUsageSpy.mock.calls[0]!;
        // TogetherVideoProvider meters under the together-video:<model> shape.
        expect(usageType).toBe(`together-video:${DEFAULT_WIRE_MODEL}`);
    });
});

// ── puter_output_path ─────────────────────────────────────────────

describe('VideoGenerationDriver.generate puter_output_path', () => {
    const TEST_ACTOR: import('../../core/actor.js').Actor = {
        user: { uuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', id: 42, username: 'testuser' },
    };

    const withTestUser = <T>(fn: () => T | Promise<T>): Promise<T> =>
        Promise.resolve(runWithContext({ actor: TEST_ACTOR }, fn));

    it('throws 400 when puter_output_path is root', async () => {
        await expect(
            withTestUser(() =>
                driver.generate({
                    prompt: 'hi',
                    model: DEFAULT_MODEL,
                    puter_output_path: '/',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when puter_output_path parent is root (e.g. /video.mp4)', async () => {
        await expect(
            withTestUser(() =>
                driver.generate({
                    prompt: 'hi',
                    model: DEFAULT_MODEL,
                    puter_output_path: '/video.mp4',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('throws 403 when ACL denies write access', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(false);

        await expect(
            withTestUser(() =>
                driver.generate({
                    prompt: 'hi',
                    model: DEFAULT_MODEL,
                    puter_output_path: '/testuser/videos/clip.mp4',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });

        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('ACL check runs BEFORE provider.generate so credits are not wasted', async () => {
        const callOrder: string[] = [];
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockImplementation(async () => {
            callOrder.push('acl');
            return false;
        });
        togetherVideosCreateMock.mockImplementation(async () => {
            callOrder.push('provider');
            return { id: 'tg-job' };
        });

        await expect(
            withTestUser(() =>
                driver.generate({
                    prompt: 'hi',
                    model: DEFAULT_MODEL,
                    puter_output_path: '/testuser/dir/clip.mp4',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });

        expect(callOrder).toEqual(['acl']);
    });

    it('resolves ~ in puter_output_path to /<username>/', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(true);

        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        fsWriteSpy.mockResolvedValueOnce(undefined as never);

        completeTogetherJob();
        secureFetchMock.mockResolvedValueOnce(
            new Response(Buffer.from('fake-mp4'), {
                status: 200,
                headers: { 'content-type': 'video/mp4' },
            }),
        );

        await withTestUser(() =>
            driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                puter_output_path: '~/videos/clip.mp4',
            } as never),
        );

        expect(fsWriteSpy).toHaveBeenCalledTimes(1);
        const [, writeArg] = fsWriteSpy.mock.calls[0]!;
        expect(
            (writeArg as { fileMetadata: { path: string } }).fileMetadata.path,
        ).toBe('/testuser/videos/clip.mp4');
    });

    it('downloads a URL result through the SSRF-guarded fetch before writing it to FS', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(true);

        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        fsWriteSpy.mockResolvedValueOnce(undefined as never);

        togetherVideosCreateMock.mockResolvedValueOnce({ id: 'tg-job' });
        togetherVideosRetrieveMock.mockResolvedValueOnce({
            id: 'tg-job',
            status: 'completed',
            outputs: { video_url: 'https://together/out.mp4' },
        });
        secureFetchMock.mockResolvedValueOnce(
            new Response(Buffer.from('fake-mp4'), {
                status: 200,
                headers: { 'content-type': 'video/mp4' },
            }),
        );

        await withTestUser(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/video-01-director',
                puter_output_path: '/testuser/videos/clip.mp4',
            } as never),
        );

        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://together/out.mp4',
            { skipProxy: true },
        );
        expect(fsWriteSpy).toHaveBeenCalledTimes(1);
        const [, writeArg] = fsWriteSpy.mock.calls[0]!;
        const meta = (
            writeArg as { fileMetadata: { path: string; contentType: string } }
        ).fileMetadata;
        expect(meta.path).toBe('/testuser/videos/clip.mp4');
        expect(meta.contentType).toBe('video/mp4');
    });

    it('decodes an inline data-URI result, writes it to FS and hands it back unchanged', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(true);

        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        fsWriteSpy.mockResolvedValueOnce(undefined as never);

        const videoBytes = Buffer.from('video-bytes').toString('base64');
        completeTogetherJob(`data:video/mp4;base64,${videoBytes}`);

        const result = await withTestUser(() =>
            driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                puter_output_path: '/testuser/videos/clip.mp4',
            } as never),
        );

        expect(secureFetchMock).not.toHaveBeenCalled();
        expect(fsWriteSpy).toHaveBeenCalledTimes(1);
        const [userId, writeArg] = fsWriteSpy.mock.calls[0]!;
        expect(userId).toBe(42);
        const meta = (
            writeArg as {
                fileMetadata: {
                    path: string;
                    contentType: string;
                    size: number;
                    overwrite: boolean;
                };
            }
        ).fileMetadata;
        expect(meta.path).toBe('/testuser/videos/clip.mp4');
        expect(meta.contentType).toBe('video/mp4');
        expect(meta.size).toBe(Buffer.byteLength('video-bytes'));
        expect(meta.overwrite).toBe(true);

        expect(result).toBe(`data:video/mp4;base64,${videoBytes}`);
    });

    it('does not forward puter_output_path to the upstream provider call', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(true);

        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        fsWriteSpy.mockResolvedValueOnce(undefined as never);

        completeTogetherJob();
        secureFetchMock.mockResolvedValueOnce(
            new Response(Buffer.from('fake-mp4'), {
                status: 200,
                headers: { 'content-type': 'video/mp4' },
            }),
        );

        await withTestUser(() =>
            driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                puter_output_path: '/testuser/dir/clip.mp4',
            } as never),
        );

        expect(togetherSent().puter_output_path).toBeUndefined();
    });

    it('throws 400 when actor has no user ID but puter_output_path is set', async () => {
        const noIdActor: import('../../core/actor.js').Actor = {
            user: { uuid: 'f0e1d2c3-b4a5-4968-8777-0a1b2c3d4e5f', username: 'noone' },
        };
        await expect(
            Promise.resolve(
                runWithContext({ actor: noIdActor }, () =>
                    driver.generate({
                        prompt: 'hi',
                        model: DEFAULT_MODEL,
                        puter_output_path: '/noone/dir/clip.mp4',
                    } as never),
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });
});

// ── Size unification ───────────────────────────────────────────────

describe('VideoGenerationDriver.generate size unification', () => {
    it('maps a WIDTHxHEIGHT size onto a tier plus aspect ratio for tier-based models', async () => {
        completeTogetherJob();

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:wan-ai/wan2.7-t2v',
                size: '1920x1080',
            } as never),
        );

        const sent = togetherSent();
        expect(sent.resolution).toBe('1080P');
        expect(sent.ratio).toBe('16:9');
        expect('width' in sent).toBe(false);
    });

    it('picks the tier of the shorter side and drops the ratio when the model has none', async () => {
        completeTogetherJob();

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:bytedance/seedance-2.5',
                size: '480x854',
            } as never),
        );

        const sent = togetherSent();
        expect(sent.resolution).toBe('480p');
        expect('ratio' in sent).toBe(false);
    });

    it('fills width/height from a WIDTHxHEIGHT size for pixel-sized models', async () => {
        completeTogetherJob();

        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/hailuo-02',
                size: '1920x1080',
            } as never),
        );

        const sent = togetherSent();
        expect(sent.width).toBe(1920);
        expect(sent.height).toBe(1080);
    });

    it('leaves width/height alone when the caller set them or passed no size', async () => {
        completeTogetherJob();
        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/hailuo-02',
                size: '1920x1080',
                width: 1366,
                height: 768,
            } as never),
        );
        expect(togetherSent().width).toBe(1366);
        expect(togetherSent().height).toBe(768);

        completeTogetherJob();
        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'togetherai:minimax/hailuo-02',
            } as never),
        );
        const second = togetherVideosCreateMock.mock.calls[1]![0] as Record<
            string,
            unknown
        >;
        expect('width' in second).toBe(false);
        expect('height' in second).toBe(false);
    });
});
