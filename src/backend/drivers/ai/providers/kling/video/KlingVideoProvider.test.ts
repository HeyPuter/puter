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

import { translateProviderError } from '../../../../../controllers/drivers/DriverController.js';
import { Context } from '../../../../../core/context.js';
import type { MeteringService } from '../../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../../server.js';
import { setupTestServer } from '../../../../../testUtil.js';
import { withTestActor } from '../../../shared/integrationTestUtil.js';
import { withAiCostFactor } from '../../../../../util/aiCostFactor.js';
import type { IGenerateVideoParams } from '../../../interfaces/video/types.js';
import { VIDEO_POLL_WINDOW_MS } from '../../../shared/polling.js';
import { KlingVideoProvider } from './KlingVideoProvider.js';

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

describe('KlingVideoProvider catalog', () => {
    it('defaults to Kling 4.0 and lists only the supported models', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('kling-4.0');
        expect(provider.models().map((model) => model.id)).toEqual([
            'kling-4.0',
            'kling-4.0-flash',
        ]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('KlingVideoProvider requests', () => {
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

    it('sends text-to-video to the model path and polls /tasks', async () => {
        mockTaskFlow(succeededTask());
        const result = await generate({
            model: 'kling-4.0',
            seconds: 7,
            size: '1080p',
            width: 720,
            height: 1280,
        });

        expect(result).toBe('https://kling.example/out.mp4');
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/text-to-video/kling-4.0',
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
                duration: 7,
                aspect_ratio: '9:16',
            },
            options: { watermark_info: { enabled: false } },
        });
        expect(sentUrl(1)).toBe(
            'https://api-singapore.klingai.com/tasks?task_ids=task-1',
        );
    });

    it('defaults the aspect ratio to 16:9 and ignores ratios Kling lacks', async () => {
        mockTaskFlow(succeededTask());
        await generate({ model: 'kling-4.0', width: 1000, height: 300 });
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
        expect(sentUrl()).toBe('https://kling.proxy/text-to-video/kling-4.0');
    });

    it('sends frames to image-to-video, stripping the data URI prefix', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-4.0',
            input_reference: 'data:image/png;base64,AAAA',
            last_frame: 'https://example.com/last.png',
        });
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/image-to-video/kling-4.0',
        );
        const body = sentBody();
        expect(body.contents).toEqual([
            { type: 'prompt', text: 'a ball rolls' },
            { type: 'first_frame', url: 'AAAA' },
            { type: 'last_frame', url: 'https://example.com/last.png' },
        ]);
        expect(body.settings.aspect_ratio).toBeUndefined();
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

    it('rejects with insufficient_funds before creating a task it cannot afford', async () => {
        remainingUsageSpy.mockResolvedValue(1000);
        await expect(generate({ model: 'kling-4.0' })).rejects.toMatchObject({
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

    // Kling bills a task it reports as succeeded, video or not.
    it('fails, still metered, when the finished task has no video', async () => {
        mockTaskFlow(succeededTask({ outputs: [] }));
        await expect(generate({})).rejects.toThrow(/unexpected response/);
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
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

    /** Times out on the first status poll; later polls return `late()`. */
    const outliveWindow = async (late: () => unknown) => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(envelope({ id: 'task-1', status: 'submitted' })),
        );
        const realNow = Date.now.bind(Date);
        let skew = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
        let polls = 0;
        fetchSpy.mockImplementation(async () => {
            skew = VIDEO_POLL_WINDOW_MS + 1;
            return jsonResponse(
                envelope([
                    polls++ === 0
                        ? { id: 'task-1', status: 'processing' }
                        : late(),
                ]),
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
    };

    it('meters a task that finishes after the window', async () => {
        let finished = false;
        await outliveWindow(() =>
            finished ? succeededTask() : { id: 'task-1', status: 'processing' },
        );
        expect(incrementUsageSpy).not.toHaveBeenCalled();

        finished = true;
        await vi.waitFor(() =>
            expect(incrementUsageSpy).toHaveBeenCalledTimes(1),
        );
        const [, usageType, amount] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toMatch(/^kling-video-generation:/);
        expect(amount).toBe(5);
    });

    it('meters nothing for a task that fails after the window', async () => {
        await outliveWindow(() => ({
            id: 'task-1',
            status: 'failed',
            message: 'boom',
        }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

describe('Kling 4 generation', () => {
    it.each([
        ['kling-4.0', 30, '1080p', 23.55],
        ['kling-4.0-flash', 20, '720p', 9.42],
    ])(
        'generates and bills %s at flagship rates',
        async (model, seconds, size, cents) => {
            mockTaskFlow(succeededTask());
            await generate({
                model,
                seconds,
                size,
                prompt: 'a'.repeat(26_000),
                generate_audio: true,
            });
            expect(sentUrl()).toBe(
                `https://api-singapore.klingai.com/text-to-video/${model}`,
            );
            expect(sentBody().settings).toMatchObject({
                duration: seconds,
                resolution: size,
            });
            expect(sentBody().settings).not.toHaveProperty('audio');
            expect(incrementUsageSpy.mock.calls[0]![3]).toBe(
                Math.round(seconds * cents * 1_000_000),
            );
        },
    );
    it('routes Flash first frames to image-to-video', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling-4.0-flash',
            input_reference: 'https://example.com/frame.png',
        });
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/image-to-video/kling-4.0-flash',
        );
    });
    it('rejects Flash last frames before submitting a task', async () => {
        await expect(
            generate({
                model: 'kling-4.0-flash',
                input_reference: 'https://example.com/frame.png',
                last_frame: 'https://example.com/end.png',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    it('routes Kling 4 first and last frames to image-to-video', async () => {
        mockTaskFlow(succeededTask());
        await generate({
            model: 'kling/kling-4.0',
            input_reference: 'https://example.com/frame.png',
            last_frame: 'https://example.com/end.png',
            seconds: 3,
        });
        expect(sentUrl()).toBe(
            'https://api-singapore.klingai.com/image-to-video/kling-4.0',
        );
        expect(sentBody().contents).toContainEqual({
            type: 'last_frame',
            url: 'https://example.com/end.png',
        });
        expect(sentBody().settings.duration).toBe(3);
    });

    it.each(['kling-4.0', 'kling-4.0-flash'])(
        'rejects an oversized prompt on %s before submitting a task',
        async (model) => {
            await expect(
                generate({ model, prompt: 'a'.repeat(26_001) }),
            ).rejects.toMatchObject({ statusCode: 400 });
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it("leaves Kling 4's lower non-English prompt limit to Kling", async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    code: 1201,
                    message:
                        'prompt is too long: at most 26000 English characters or 11000 non-English characters',
                },
                400,
            ),
        );
        const failure = await generate({
            model: 'kling-4.0',
            prompt: '海'.repeat(12_000),
        }).catch((e) => e);
        expect(sentBody().prompt).toHaveLength(12_000);
        expect(translateProviderError(failure)).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it.each(['kling-4.0', 'kling-4.0-flash'])(
        'omits the unsupported audio switch on %s when audio is disabled',
        async (model) => {
            mockTaskFlow(succeededTask());
            await generate({ model, generate_audio: false });
            expect(sentBody().settings).not.toHaveProperty('audio');
        },
    );
});
