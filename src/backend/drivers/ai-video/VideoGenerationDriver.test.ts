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

import { v4 as uuidv4 } from 'uuid';
import { Context, runWithContext } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { type Actor, SYSTEM_ACTOR } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import { setupTestServer } from '../../testUtil.js';
import { withAiCostFactorHook } from '../integrationTestUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
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
let admitSpy: MockInstance<MeteringService['reserveCreditsIfAffordable']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'together-video-generation': { apiKey: 'tg-key' },
            // Configured on purpose: Gemini video reads the shared `gemini`
            // block, so this one alone must not register a provider.
            'gemini-video-generation': { apiKey: 'gem-key' },
            kling: { apiKey: 'kling-key' },
            // The chat block's base URL ends in `/v1`; video must drop it.
            minimax: {
                apiKey: 'mm-key',
                apiBaseUrl: 'https://api.minimax.io/v1',
            },
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
    admitSpy = vi.spyOn(server.services.metering, 'reserveCreditsIfAffordable');
    admitSpy.mockImplementation((who, amount, opts) =>
            server.services.metering.reserveCredits(who, amount, opts),
        );
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

    it('refuses a source video for a model without video input before calling it', async () => {
        await expect(
            withActor(() =>
                driver.generate({
                    prompt: 'Make this dog a dinosaur.',
                    model: DEFAULT_MODEL,
                    input_video: 'https://example.com/dog.mp4',
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: `${DEFAULT_MODEL} does not accept a source video`,
        });
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
        expect(secureFetchMock).not.toHaveBeenCalled();
    });
});

describe('VideoGenerationDriver.generate media inputs', () => {
    const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
    );
    const pngDataUri = `data:image/png;base64,${PNG.toString('base64')}`;

    const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
        const username = `video-media-${Math.random().toString(36).slice(2, 10)}`;
        const created = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });
        await generateDefaultFsentries(
            server.clients.db,
            server.stores.user,
            created,
        );
        const user = (await server.stores.user.getById(created.id))!;
        return {
            userId: user.id,
            actor: {
                user: {
                    id: user.id,
                    uuid: user.uuid,
                    username: user.username,
                    email: user.email ?? null,
                    email_confirmed: true,
                } as Actor['user'],
            },
        };
    };

    const writeImage = async (
        { actor, userId }: { actor: Actor; userId: number },
        name: string,
    ) => {
        const path = `/${actor.user.username}/${name}`;
        await server.services.fs.write(userId, {
            fileMetadata: {
                path,
                size: PNG.byteLength,
                contentType: 'application/octet-stream',
            },
            fileContent: PNG,
        });
        return path;
    };

    const generateAs = (actor: Actor, args: Record<string, unknown>) =>
        Promise.resolve(
            runWithContext({ actor }, () =>
                driver.generate({
                    prompt: 'A dinosaur.',
                    model: DEFAULT_MODEL,
                    ...args,
                } as never),
            ),
        );

    it("sends Puter file image inputs as data URIs without changing the caller's arrays", async () => {
        const user = await makeUser();
        const first = await writeImage(user, 'first.tmp');
        const reference = await writeImage(user, 'reference.tmp');
        const referenceImages = [reference, 'https://example.com/b.png'];
        const frameImages = [{ input_image: first, frame: 'first' }];

        completeTogetherJob();
        await generateAs(user.actor, {
            reference_images: referenceImages,
            frame_images: frameImages,
        });
        expect(togetherSent().reference_images).toEqual([
            pngDataUri,
            'https://example.com/b.png',
        ]);
        expect(togetherSent().frame_images).toEqual([
            { input_image: pngDataUri, frame: 'first' },
        ]);
        expect(referenceImages[0]).toBe(reference);
        expect(frameImages[0]!.input_image).toBe(first);

        completeTogetherJob();
        await generateAs(user.actor, {
            input_reference: first,
            last_frame: 'https://example.com/last.png',
        });
        expect(togetherSent(1).frame_images).toEqual([
            { input_image: pngDataUri, frame: 'first' },
            { input_image: 'https://example.com/last.png', frame: 'last' },
        ]);
        expect(secureFetchMock).not.toHaveBeenCalled();
    });

    it("refuses another user's image before calling the provider", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const path = await writeImage(owner, 'private.png');
        const status = await generateAs(intruder.actor, {
            input_reference: path,
        }).then(
            () => null,
            (err: { statusCode?: number }) => err.statusCode,
        );
        expect([403, 404]).toContain(status);
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('reads no file in test mode', async () => {
        const { actor } = await makeUser();
        await expect(
            generateAs(actor, {
                input_reference: '/nobody/missing.png',
                test_mode: true,
            }),
        ).resolves.toBeTruthy();
    });

    it('refuses a data URI source video over 1 MiB with 413', async () => {
        const { actor } = await makeUser();
        const video = Buffer.alloc(1024 * 1024 + 1).toString('base64');
        await expect(
            generateAs(actor, {
                model: 'togetherai:black-forest-labs/flux-3',
                input_video: `data:video/mp4;base64,${video}`,
            }),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'input_too_large',
        });
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
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

    it('builds the catalog once at boot, not on every listing', async () => {
        expect(await driver.models()).toBe(await driver.models());
        expect(await driver.list()).toBe(await driver.list());
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

    it('registers no Gemini video provider from a gemini-video-generation key alone', async () => {
        const all = await driver.models();
        expect(
            all.some((m) => m.provider === 'gemini-video-generation'),
        ).toBe(false);
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

    it.each(['kling-3.0', 'kling-v3', 'kling:kling/kling-3.0'])(
        'routes %s to the Kling provider from the shared kling key',
        async (model) => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            fetchSpy.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        code: 0,
                        data: { id: 'kl-task', status: 'submitted' },
                    }),
                ),
            );
            fetchSpy.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        code: 0,
                        data: [
                            {
                                id: 'kl-task',
                                status: 'succeeded',
                                outputs: [
                                    {
                                        type: 'video',
                                        url: 'https://kling/out.mp4',
                                        duration: '5',
                                    },
                                ],
                            },
                        ],
                    }),
                ),
            );

            const result = await withActor(() =>
                driver.generate({ prompt: 'hi', model } as never),
            );

            expect(result).toBe('https://kling/out.mp4');
            expect(String(fetchSpy.mock.calls[0]![0])).toBe(
                'https://api-singapore.klingai.com/text-to-video/kling-3.0',
            );
            expect(togetherVideosCreateMock).not.toHaveBeenCalled();
        },
    );

    it('lists the Kling models under the kling-video-generation provider', async () => {
        const kling = (await driver.models()).filter(
            (m) => m.provider === 'kling-video-generation',
        );
        expect(kling.map((m) => m.id).sort()).toEqual([
            'kling-2.5-turbo',
            'kling-2.6',
            'kling-3.0',
            'kling-3.0-omni',
            'kling-3.0-turbo',
            'kling-o1',
        ]);
    });

    it.each([
        'minimax-h3',
        'minimax/minimax-h3',
        'minimax:minimax/minimax-h3',
    ])('routes %s to the MiniMax provider from the shared minimax key', async (model) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ task_id: 'mm-task' })),
        );
        fetchSpy.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    task: {
                        id: 'mm-task',
                        status: 'succeeded',
                        content: { url: 'https://minimax/out.mp4' },
                        usage: { output_seconds: 5 },
                    },
                }),
            ),
        );

        const result = await withActor(() =>
            driver.generate({ prompt: 'hi', model } as never),
        );

        expect(result).toBe('https://minimax/out.mp4');
        expect(String(fetchSpy.mock.calls[0]![0])).toBe(
            'https://api.minimax.io/v2/video_generation',
        );
        expect(togetherVideosCreateMock).not.toHaveBeenCalled();
    });

    it('lists the MiniMax models under the minimax-video-generation provider', async () => {
        const minimax = (await driver.models()).filter(
            (m) => m.provider === 'minimax-video-generation',
        );
        expect(minimax.map((m) => m.id).sort()).toEqual([
            'minimax-h3',
            'minimax-h3-highspeed',
            'minimax-h3-lite',
            'minimax-h3-max',
            'minimax-hailuo-02',
            'minimax-hailuo-2.3',
            'minimax-hailuo-2.3-fast',
        ]);
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

    it('returns the result and flags it unsaved when write access is revoked mid-job', async () => {
        vi.spyOn(server.services.acl, 'check').mockResolvedValueOnce(true);
        vi.spyOn(server.services.fs, 'checkFSAccess').mockRejectedValueOnce(
            new HttpError(403, 'Access denied', { legacyCode: 'forbidden' }),
        );
        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        const videoBytes = Buffer.from('video-bytes').toString('base64');
        completeTogetherJob(`data:video/mp4;base64,${videoBytes}`);

        const [result, metadata] = await withTestUser(async () => [
            await driver.generate({
                prompt: 'hi',
                model: DEFAULT_MODEL,
                puter_output_path: '/testuser/videos/clip.mp4',
            } as never),
            Context.get('driverMetadata'),
        ]);

        expect(result).toBe(`data:video/mp4;base64,${videoBytes}`);
        expect(fsWriteSpy).not.toHaveBeenCalled();
        expect(metadata).toEqual({ outputSaved: false });
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

    it("leaves the caller's args untouched", async () => {
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

        const args = {
            prompt: 'hi',
            model: ` ${DEFAULT_MODEL.toUpperCase()} `,
            seconds: 999,
            size: '1920x1080',
            puter_output_path: '/testuser/dir/clip.mp4',
        };
        const before = structuredClone(args);
        await withTestUser(() => driver.generate(args as never));

        expect(args).toEqual(before);
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
    it.each(['912x512', '512x912'])(
        'selects and bills Hailuo 02 at 512p for %s',
        async (size) => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            const incrementUsageSpy = vi.spyOn(
                server.services.metering,
                'incrementUsage',
            );
            fetchSpy.mockResolvedValueOnce(
                new Response(JSON.stringify({ task_id: 'mm-task' })),
            );
            fetchSpy.mockResolvedValueOnce(
                new Response(JSON.stringify({
                    status: 'Success',
                    file_id: 'file-1',
                })),
            );
            fetchSpy.mockResolvedValueOnce(
                new Response(JSON.stringify({
                    file: { download_url: 'https://minimax/out.mp4' },
                })),
            );

            await withActor(() => driver.generate({
                prompt: 'a ball rolls',
                model: 'minimax-hailuo-02',
                size,
                input_reference: 'https://example.com/first.png',
            } as never));

            const body = JSON.parse(
                fetchSpy.mock.calls[0]![1]!.body as string,
            );
            expect(body.resolution).toBe('512P');
            expect(incrementUsageSpy).toHaveBeenCalledWith(
                SYSTEM_ACTOR,
                'minimax-video-generation:minimax-hailuo-02:per-video:512p:6',
                1,
                10 * 1_000_000,
            );
        },
    );

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

    it('treats a catalog with a 2k or 4k tier as tier-based', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    code: 0,
                    data: { id: 'kl-task', status: 'submitted' },
                }),
            ),
        );
        fetchSpy.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    code: 0,
                    data: [
                        {
                            id: 'kl-task',
                            status: 'succeeded',
                            outputs: [
                                {
                                    type: 'video',
                                    url: 'https://kling/out.mp4',
                                    duration: '5',
                                },
                            ],
                        },
                    ],
                }),
            ),
        );
        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'kling-3.0',
                size: '1080x1920',
            } as never),
        );
        const sent = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(sent.settings.resolution).toBe('1080p');
        expect(sent.settings.aspect_ratio).toBe('9:16');

        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ task_id: 'mm-task' })),
        );
        fetchSpy.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    task: {
                        id: 'mm-task',
                        status: 'succeeded',
                        content: { url: 'https://minimax/out.mp4' },
                    },
                }),
            ),
        );
        await withActor(() =>
            driver.generate({
                prompt: 'hi',
                model: 'minimax-h3-lite',
                size: '854x480',
            } as never),
        );
        const sentToMiniMax = JSON.parse(
            (fetchSpy.mock.calls[2]![1] as RequestInit).body as string,
        );
        expect(sentToMiniMax.resolution).toBe('480P');
        expect(sentToMiniMax.ratio).toBe('16:9');
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

describe('VideoGenerationDriver cost factor', () => {
    it('holds and meters at the AI cost factor', async () => {
        const incrementUsageSpy = vi.spyOn(
            server.services.metering,
            'incrementUsage',
        );
        const reserveSpy = vi.spyOn(server.services.metering, 'reserveCredits');
        const metered = () =>
            incrementUsageSpy.mock.calls.map(([, , , cost]) => cost!);
        const generate = async (charges: number) => {
            completeTogetherJob();
            await withActor(() =>
                driver.generate({ prompt: 'hi', model: DEFAULT_MODEL } as never),
            );
            await vi.waitFor(() => expect(metered()).toHaveLength(charges));
        };
        await generate(1);
        await withAiCostFactorHook(server.clients.event, 2, () => generate(2));

        const [base, factored] = metered();
        expect(base).toBeGreaterThan(0);
        expect(factored).toBe(Math.round(base! * 2));
        const held = reserveSpy.mock.calls.map(([, amount]) => amount);
        expect(held[0]).toBeGreaterThan(0);
        expect(held).toEqual([held[0], Math.round(held[0]! * 2)]);
    });
});
