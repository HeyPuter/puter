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
 * Offline unit tests for KlingVideoProvider.
 *
 * Boots a real PuterServer and constructs the provider against the live wired
 * `MeteringService`. Kling's task API is called through global `fetch`, which
 * is stubbed as the network boundary.
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

import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { withAiCostFactor } from '../../../util/aiCostFactor.js';
import type { IGenerateVideoParams } from '../../types.js';
import { VIDEO_POLL_WINDOW_MS } from '../polling.js';
import { KlingVideoProvider } from './KlingVideoProvider.js';
import { KLING_VIDEO_GENERATION_MODELS } from './models.js';

// -- Test harness ----------------------------------------------------

let server: PuterServer;
let fetchSpy: MockInstance<typeof fetch>;
let remainingUsageSpy: MockInstance<MeteringService['getRemainingUsage']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const aiMetering = () =>
    withAiCostFactor(
        server.services.metering,
        server.clients.event,
        'ai-video',
    );

const makeProvider = (config: { apiKey?: string; apiBaseUrl?: string } = {}) =>
    new KlingVideoProvider(
        {
            apiKey: config.apiKey ?? 'test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
            pollIntervalMs: 1,
        },
        aiMetering(),
        { stores: server.stores, fs: server.services.fs } as never,
    );

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    remainingUsageSpy = vi.spyOn(server.services.metering, 'getRemainingUsage');
    remainingUsageSpy.mockResolvedValue(Number.MAX_SAFE_INTEGER);
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
    incrementUsageSpy.mockResolvedValue({} as never);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const envelope = (data: unknown) => ({
    code: 0,
    message: 'SUCCEED',
    request_id: 'req',
    data,
});

const succeededTask = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    status: 'succeeded',
    outputs: [
        {
            type: 'video',
            url: 'https://kling.example/out.mp4',
            duration: '5.041',
        },
    ],
    ...overrides,
});

/** Queue the create response followed by `/tasks` poll responses. */
const mockTaskFlow = (...polled: unknown[]) => {
    fetchSpy.mockResolvedValueOnce(
        jsonResponse(envelope({ id: 'task-1', status: 'submitted' })),
    );
    for (const task of polled) {
        fetchSpy.mockResolvedValueOnce(jsonResponse(envelope([task])));
    }
};

const sentUrl = (callIndex = 0) => String(fetchSpy.mock.calls[callIndex]![0]);

const sentBody = (callIndex = 0): Record<string, any> =>
    JSON.parse(
        (fetchSpy.mock.calls[callIndex]![1] as RequestInit).body as string,
    );

const generate = (params: Partial<IGenerateVideoParams>) =>
    withTestActor(() =>
        makeProvider().generate({ prompt: 'a ball rolls', ...params }),
    );

const rate = (id: string, key: string) =>
    KLING_VIDEO_GENERATION_MODELS.find((m) => m.id === id)!.costs![key]!;

// -- Construction / catalog ------------------------------------------

describe('KlingVideoProvider construction and catalog', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new KlingVideoProvider(
                    { apiKey: '' },
                    aiMetering(),
                    {} as never,
                ),
        ).toThrow(/API key/i);
    });

    it('defaults to Kling 3.0 Turbo and lists the six models', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('kling-3.0-turbo');
        expect(provider.models().map((m) => m.id)).toEqual([
            'kling-3.0-turbo',
            'kling-3.0',
            'kling-3.0-omni',
            'kling-o1',
            'kling-2.6',
            'kling-2.5-turbo',
        ]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Request shape ---------------------------------------------------

describe('KlingVideoProvider.generate request shape', () => {
    it('sends text-to-video to the model path and polls /tasks', async () => {
        mockTaskFlow(succeededTask());
        const result = await generate({
            model: 'kling-3.0',
            seconds: 7,
            size: '1080p',
            width: 720,
            height: 1280,
        });

        expect(result).toBe('https://kling.example/out.mp4');
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/text-to-video/kling-3.0',
        );
        const init = fetchSpy.mock.calls[0]![1] as RequestInit & {
            headers: Record<string, string>;
        };
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer test-key');
        expect(sentBody()).toEqual({
            prompt: 'a ball rolls',
            settings: {
                resolution: '1080p',
                audio: 'off',
                duration: 7,
                aspect_ratio: '9:16',
            },
            options: { watermark_info: { enabled: false } },
        });
        expect(sentUrl(1)).toBe(
            'https://api-singapore.klingai.com/tasks?task_ids=task-1',
        );
    });

    it('asks for native audio when generate_audio is true', async () => {
        mockTaskFlow(succeededTask());
        await generate({ model: 'kling-3.0', generate_audio: true });
        expect(sentBody().settings.audio).toBe('native');
    });

    it('sends no audio switch to 3.0 Turbo or 2.5 Turbo', async () => {
        mockTaskFlow(succeededTask());
        await generate({ model: 'kling-3.0-turbo' });
        expect(sentBody().settings.audio).toBeUndefined();

        mockTaskFlow(succeededTask());
        await generate({ model: 'kling-2.5-turbo' });
        expect(sentBody(2).settings.audio).toBeUndefined();
    });

    it('defaults the aspect ratio to 16:9 and ignores ratios Kling lacks', async () => {
        mockTaskFlow(succeededTask());
        await generate({ model: 'kling-2.6', width: 1000, height: 300 });
        expect(sentBody().settings.aspect_ratio).toBe('16:9');
    });

    it('honors a base URL override', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope({ id: 'task-1', status: 'submitted' })),
        );
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope([succeededTask()])),
        );
        await withTestActor(() =>
            makeProvider({ apiBaseUrl: 'https://kling.proxy/' }).generate({
                prompt: 'hi',
            }),
        );
        expect(sentUrl()).toBe(
            'https://kling.proxy/text-to-video/kling-3.0-turbo',
        );
    });

    it('sends frames to image-to-video, stripping the data URI prefix', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-3.0',
            input_reference: 'data:image/png;base64,AAAA',
            last_frame: 'https://example.com/last.png',
        });
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/image-to-video/kling-3.0',
        );
        const body = sentBody();
        expect(body.contents).toEqual([
            { type: 'prompt', text: 'a ball rolls' },
            { type: 'first_frame', url: 'AAAA' },
            { type: 'last_frame', url: 'https://example.com/last.png' },
        ]);
        expect(body.settings.aspect_ratio).toBeUndefined();
    });

    it('sends references to the omni path with an aspect ratio', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-3.0-omni',
            reference_images: ['https://example.com/a.png', 'BBBB'],
        });
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/omni-video/kling-3.0-omni',
        );
        const body = sentBody();
        expect(body.contents).toEqual([
            { type: 'prompt', text: 'a ball rolls' },
            { type: 'refer_image', url: 'https://example.com/a.png' },
            { type: 'refer_image', url: 'BBBB' },
        ]);
        expect(body.settings).toMatchObject({
            aspect_ratio: '16:9',
            audio: 'off',
            duration: 5,
        });
    });

    it('edits a source video: base_video, single shot, original sound, no duration', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-3.0-omni',
            input_video: 'https://example.com/source.mp4',
            seconds: 3,
        });
        const body = sentBody();
        expect(body.contents).toEqual([
            { type: 'prompt', text: 'a ball rolls' },
            { type: 'base_video', url: 'https://example.com/source.mp4' },
        ]);
        expect(body.settings).toEqual({
            resolution: '720p',
            audio: 'original',
            multi_shot: false,
        });
    });

    it('drops the source sound when generate_audio is false', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-o1',
            input_video: 'https://example.com/source.mp4',
            generate_audio: false,
        });
        expect(sentBody().settings.audio).toBe('off');
    });

    it.each([
        [3, 5],
        [7, 5],
        [15, 10],
    ])('snaps O1 first-frame-only %is to %is', async (requested, expected) => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-o1',
            input_reference: 'https://example.com/first.png',
            seconds: requested,
        });
        expect(sentBody().settings.duration).toBe(expected);
    });

    it('keeps O1 durations outside the ladder when there are references', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-o1',
            input_reference: 'https://example.com/first.png',
            reference_images: ['https://example.com/ref.png'],
            seconds: 3,
        });
        expect(sentBody().settings.duration).toBe(3);
    });

    it('keeps polling while the task is missing from the list', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope({ id: 'task-1', status: 'submitted' })),
        );
        fetchSpy.mockResolvedValueOnce(jsonResponse(envelope([])));
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope([{ id: 'task-1', status: 'processing' }])),
        );
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope([succeededTask()])),
        );
        const result = await generate({});
        expect(result).toBe('https://kling.example/out.mp4');
        expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('returns the sample clip in test mode without calling Kling', async () => {
        const result = await generate({ test_mode: true });
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// -- Validation ------------------------------------------------------

describe('KlingVideoProvider.generate rejects invalid input before calling Kling', () => {
    it.each<[string, Partial<IGenerateVideoParams>]>([
        [
            'a last frame without a first frame',
            { model: 'kling-3.0', last_frame: 'https://example.com/l.png' },
        ],
        [
            'a last frame on 3.0 Turbo',
            {
                model: 'kling-3.0-turbo',
                input_reference: 'https://example.com/f.png',
                last_frame: 'https://example.com/l.png',
            },
        ],
        [
            'a last frame at 720p on 2.5 Turbo',
            {
                model: 'kling-2.5-turbo',
                size: '720p',
                input_reference: 'https://example.com/f.png',
                last_frame: 'https://example.com/l.png',
            },
        ],
        [
            'audio with a last frame on 2.6',
            {
                model: 'kling-2.6',
                size: '1080p',
                generate_audio: true,
                input_reference: 'https://example.com/f.png',
                last_frame: 'https://example.com/l.png',
            },
        ],
        [
            'audio on 2.5 Turbo',
            { model: 'kling-2.5-turbo', generate_audio: true },
        ],
        ['audio on O1', { model: 'kling-o1', generate_audio: true }],
        [
            'audio at 720p on 2.6',
            { model: 'kling-2.6', size: '720p', generate_audio: true },
        ],
        [
            'reference images on a non-omni model',
            {
                model: 'kling-3.0',
                reference_images: ['https://example.com/r.png'],
            },
        ],
        [
            'more than 7 reference images',
            {
                model: 'kling-3.0-omni',
                reference_images: Array(8).fill('https://example.com/r.png'),
            },
        ],
        [
            'more than 4 reference images with a source video',
            {
                model: 'kling-3.0-omni',
                input_video: 'https://example.com/v.mp4',
                reference_images: Array(5).fill('https://example.com/r.png'),
            },
        ],
        [
            'a data URI source video',
            {
                model: 'kling-3.0-omni',
                input_video: 'data:video/mp4;base64,AA',
            },
        ],
        [
            'a source video with frames',
            {
                model: 'kling-3.0-omni',
                input_video: 'https://example.com/v.mp4',
                input_reference: 'https://example.com/f.png',
            },
        ],
        [
            'a prompt over 2500 characters on 2.6',
            { model: 'kling-2.6', prompt: 'x'.repeat(2501) },
        ],
        [
            'a prompt over 3072 characters on 3.0',
            { model: 'kling-3.0', prompt: 'x'.repeat(3073) },
        ],
        [
            'a prompt over 2500 characters with a first frame on 3.0 Turbo',
            {
                model: 'kling-3.0-turbo',
                prompt: 'x'.repeat(2501),
                input_reference: 'https://example.com/f.png',
            },
        ],
        [
            'reference images with a first and last frame on O1',
            {
                model: 'kling-o1',
                input_reference: 'https://example.com/f.png',
                last_frame: 'https://example.com/l.png',
                reference_images: ['https://example.com/r.png'],
            },
        ],
        ['a blank prompt', { prompt: '  ' }],
    ])('rejects %s', async (_label, params) => {
        await expect(generate(params)).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts a 3072-character prompt on 3.0', async () => {
        mockTaskFlow(succeededTask());
        await generate({ model: 'kling-3.0', prompt: 'x'.repeat(3072) });
        expect(fetchSpy).toHaveBeenCalled();
    });

    it('accepts a 3072-character text-to-video prompt on 3.0 Turbo', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-3.0-turbo',
            prompt: 'x'.repeat(3072),
        });
        expect(fetchSpy).toHaveBeenCalled();
    });
});

// -- Billing ---------------------------------------------------------

describe('KlingVideoProvider billing', () => {
    it.each<[Partial<IGenerateVideoParams>, string, string, number]>([
        [{ model: 'kling-3.0', seconds: 6 }, 'kling-3.0', 'per-second:720p', 6],
        [
            {
                model: 'kling-3.0',
                seconds: 6,
                size: '4k',
                generate_audio: true,
            },
            'kling-3.0',
            'per-second:4k:audio',
            6,
        ],
        [
            {
                model: 'kling-2.6',
                seconds: 10,
                size: '1080p',
                generate_audio: true,
            },
            'kling-2.6',
            'per-second:1080p:audio',
            10,
        ],
        [
            { model: 'kling-v2-5-turbo' },
            'kling-2.5-turbo',
            'per-second:720p',
            5,
        ],
    ])(
        'meters %o under its cost key for the requested seconds',
        async (params, id, key, secs) => {
            mockTaskFlow(succeededTask());
            await generate(params);
            expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
            const [, usageType, amount, cost] =
                incrementUsageSpy.mock.calls[0]!;
            expect(usageType).toBe(`kling-video-generation:${id}:${key}`);
            expect(amount).toBe(secs);
            expect(cost).toBeCloseTo(secs * rate(id, key) * 1_000_000);
        },
    );

    it('bills an edit on the rounded length of the returned clip', async () => {
        mockTaskFlow(
            succeededTask({
                outputs: [
                    {
                        type: 'video',
                        url: 'https://kling.example/out.mp4',
                        duration: '7.6',
                    },
                ],
            }),
        );
        await generate({
            model: 'kling-3.0-omni',
            size: '1080p',
            input_video: 'https://example.com/source.mp4',
        });
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe(
            'kling-video-generation:kling-3.0-omni:per-second:1080p:video-input',
        );
        expect(amount).toBe(8);
        expect(cost).toBeCloseTo(8 * 16.8 * 1_000_000);
    });

    it('holds a 3.0 Omni edit at 16 seconds, covering a 15.5-second source', async () => {
        const perSecond = rate('kling-3.0-omni', 'per-second:720p:video-input');
        remainingUsageSpy.mockResolvedValue(15.5 * perSecond * 1_000_000);
        await expect(
            generate({
                model: 'kling-3.0-omni',
                input_video: 'https://example.com/source.mp4',
            }),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects with insufficient_funds before creating a task it cannot afford', async () => {
        remainingUsageSpy.mockResolvedValue(1000);
        await expect(generate({ model: 'kling-3.0' })).rejects.toMatchObject({
            statusCode: 402,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Failures --------------------------------------------------------

describe('KlingVideoProvider failures', () => {
    it('maps a failed task to upstream_failed and meters nothing', async () => {
        mockTaskFlow({
            id: 'task-1',
            status: 'failed',
            message: 'internal error',
        });
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it("maps Kling failing to decode an edit's source to a bad request", async () => {
        mockTaskFlow({
            id: 'task-1',
            status: 'failed',
            message:
                'VideoNormalize failed, code: 90001, message: ffmpeg error, code 1',
        });
        await expect(
            generate({
                model: 'kling-3.0-omni',
                input_video: 'https://example.com/source.mp4',
            }),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps a risk-control failure to moderation_flagged', async () => {
        mockTaskFlow({
            id: 'task-1',
            status: 'failed',
            message: 'Triggering the content risk control of the platform',
        });
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('surfaces an exhausted resource pack as status 402 with the Kling code', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                { code: 1102, message: 'Account balance not enough' },
                429,
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            status: 402,
            code: '1102',
            provider: 'kling',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps a content-safety block at submit to moderation_flagged', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ code: 1301, message: 'Content security' }, 400),
        );
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
    });

    it('fails when the finished task has no video', async () => {
        mockTaskFlow(succeededTask({ outputs: [] }));
        await expect(generate({})).rejects.toThrow(/video URL/);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

describe('KlingVideoProvider after the caller leaves', () => {
    it('keeps polling after a disconnect and meters the finished clip', async () => {
        mockTaskFlow({ id: 'task-1', status: 'processing' }, succeededTask());
        const result = await withTestActor(() => {
            const abort = new AbortController();
            abort.abort();
            Context.set('abortSignal', abort.signal);
            return makeProvider().generate({ prompt: 'a ball rolls' });
        });
        expect(result).toBe('https://kling.example/out.mp4');
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
    });

    it('meters the held seconds when the task outlives the window', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope({ id: 'task-1', status: 'submitted' })),
        );
        const realNow = Date.now.bind(Date);
        let skew = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
        fetchSpy.mockImplementation(async () => {
            skew = VIDEO_POLL_WINDOW_MS + 1;
            return jsonResponse(
                envelope([{ id: 'task-1', status: 'processing' }]),
            );
        });

        let failure: unknown;
        try {
            await generate({ seconds: 5 });
        } catch (e) {
            failure = e;
        }
        expect(failure).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, amount] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toMatch(/^kling-video-generation:/);
        expect(amount).toBe(5);
    });
});
