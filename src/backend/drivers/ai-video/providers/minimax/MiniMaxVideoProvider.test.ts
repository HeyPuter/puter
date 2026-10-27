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
 * Offline unit tests for MiniMaxVideoProvider.
 *
 * Boots a real PuterServer and constructs the provider against the live wired
 * `MeteringService`. MiniMax's task APIs are called through global `fetch`,
 * which is stubbed as the network boundary.
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
import { MiniMaxVideoProvider } from './MiniMaxVideoProvider.js';
import { MINIMAX_VIDEO_GENERATION_MODELS } from './models.js';

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
    new MiniMaxVideoProvider(
        {
            apiKey: config.apiKey ?? 'test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
            pollIntervalMs: 1,
        },
        aiMetering(),
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

const ok = { status_code: 0, status_msg: 'success' };

const h3Task = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    model: 'MiniMax-H3',
    status: 'succeeded',
    content: { url: 'https://minimax.example/out.mp4' },
    resolution: '768P',
    duration: 5,
    usage: { output_seconds: 5 },
    ...overrides,
});

/** Queue the v2 create response followed by task query responses. */
const mockH3Flow = (...polled: unknown[]) => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ task_id: 'task-1' }));
    for (const task of polled) {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ task }));
    }
};

const hailuoTask = (status: string, fileId = 'file-1') => ({
    task_id: 'task-1',
    status,
    file_id: status === 'Success' ? fileId : '',
    base_resp: ok,
});

/** Queue the v1 create, query and file retrieve responses. */
const mockHailuoFlow = (...polled: unknown[]) => {
    fetchSpy.mockResolvedValueOnce(
        jsonResponse({ task_id: 'task-1', base_resp: ok }),
    );
    for (const task of polled) {
        fetchSpy.mockResolvedValueOnce(jsonResponse(task));
    }
    fetchSpy.mockResolvedValueOnce(
        jsonResponse({
            file: {
                file_id: 1,
                download_url: 'https://minimax.example/hailuo.mp4',
            },
            base_resp: ok,
        }),
    );
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
    MINIMAX_VIDEO_GENERATION_MODELS.find((m) => m.id === id)!.costs![key]!;

// -- Construction / catalog ------------------------------------------

describe('MiniMaxVideoProvider construction and catalog', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () => new MiniMaxVideoProvider({ apiKey: '' }, aiMetering()),
        ).toThrow(/API key/i);
    });

    it('defaults to MiniMax H3 and lists the seven models', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('minimax-h3');
        expect(provider.models().map((m) => m.id)).toEqual([
            'minimax-h3',
            'minimax-h3-highspeed',
            'minimax-h3-lite',
            'minimax-h3-max',
            'minimax-hailuo-2.3',
            'minimax-hailuo-2.3-fast',
            'minimax-hailuo-02',
        ]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- H3 request shape ------------------------------------------------

describe('MiniMaxVideoProvider.generate H3 request shape', () => {
    it('creates a v2 task with a ratio and polls it', async () => {
        mockH3Flow(h3Task());
        const result = await generate({
            model: 'minimax-h3-lite',
            seconds: 6,
            size: '480p',
            width: 1080,
            height: 1920,
        });

        expect(result).toBe('https://minimax.example/out.mp4');
        expect(sentUrl()).toBe('https://api.minimax.io/v2/video_generation');
        const init = fetchSpy.mock.calls[0]![1] as RequestInit & {
            headers: Record<string, string>;
        };
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer test-key');
        expect(sentBody()).toEqual({
            model: 'MiniMax-H3-Lite',
            content: [{ type: 'text', text: 'a ball rolls' }],
            duration: 6,
            resolution: '480P',
            ratio: '9:16',
        });
        expect(sentUrl(1)).toBe(
            'https://api.minimax.io/v2/query/video_generation/task-1',
        );
    });

    it('sends the model name as MiniMax spells it and 2K upper-cased', async () => {
        mockH3Flow(h3Task());
        await generate({ model: 'MiniMax:minimax/minimax-h3', size: '2K' });
        expect(sentBody()).toMatchObject({
            model: 'MiniMax-H3',
            resolution: '2K',
            duration: 5,
        });
    });

    it('defaults the ratio to 16:9 and ignores ratios MiniMax lacks', async () => {
        mockH3Flow(h3Task());
        await generate({ model: 'minimax-h3', width: 1000, height: 300 });
        expect(sentBody().ratio).toBe('16:9');
    });

    it('sends frames with roles and no ratio', async () => {
        mockH3Flow(h3Task());
        await generate({
            model: 'minimax-h3',
            input_reference: 'data:image/png;base64,AAAA',
            last_frame: 'https://example.com/last.png',
            width: 1920,
            height: 1080,
        });
        const body = sentBody();
        expect(body.content).toEqual([
            { type: 'text', text: 'a ball rolls' },
            {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,AAAA' },
                role: 'first_frame',
            },
            {
                type: 'image_url',
                image_url: { url: 'https://example.com/last.png' },
                role: 'last_frame',
            },
        ]);
        expect('ratio' in body).toBe(false);
    });

    it('takes a last frame on its own', async () => {
        mockH3Flow(h3Task());
        await generate({
            model: 'minimax-h3',
            last_frame: 'https://example.com/last.png',
        });
        expect(
            sentBody().content.map((c: { role?: string }) => c.role),
        ).toEqual([undefined, 'last_frame']);
    });

    it('wraps raw base64 as a PNG data URI', async () => {
        mockH3Flow(h3Task());
        await generate({ model: 'minimax-h3', input_reference: 'BBBB' });
        expect(sentBody().content[1].image_url.url).toBe(
            'data:image/png;base64,BBBB',
        );
    });

    it('sends references with a ratio', async () => {
        mockH3Flow(h3Task());
        await generate({
            model: 'minimax-h3-max',
            reference_images: ['https://example.com/a.png', 'CCCC'],
            width: 4,
            height: 3,
        });
        const body = sentBody();
        expect(body.content).toEqual([
            { type: 'text', text: 'a ball rolls' },
            {
                type: 'image_url',
                image_url: { url: 'https://example.com/a.png' },
                role: 'reference_image',
            },
            {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,CCCC' },
                role: 'reference_image',
            },
        ]);
        expect(body.ratio).toBe('4:3');
    });

    it("drops the chat API's /v1 from a base URL override", async () => {
        mockH3Flow(h3Task());
        await withTestActor(() =>
            makeProvider({
                apiBaseUrl: 'https://api.minimaxi.com/v1/',
            }).generate({ prompt: 'hi' }),
        );
        expect(sentUrl()).toBe('https://api.minimaxi.com/v2/video_generation');
    });

    it('keeps polling while the task is queued or running', async () => {
        mockH3Flow(
            h3Task({ status: 'queued', content: undefined, usage: {} }),
            h3Task({ status: 'running', content: undefined, usage: {} }),
            h3Task(),
        );
        const result = await generate({});
        expect(result).toBe('https://minimax.example/out.mp4');
        expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('treats a rate-limited poll as a missed poll', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ task_id: 'task-1' }));
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    type: 'error',
                    error: {
                        type: 'rate_limit_error',
                        message: 'rate limit (1002)',
                    },
                },
                429,
            ),
        );
        fetchSpy.mockResolvedValueOnce(jsonResponse({ task: h3Task() }));
        const result = await generate({});
        expect(result).toBe('https://minimax.example/out.mp4');
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('returns the sample clip in test mode without calling MiniMax', async () => {
        const result = await generate({ test_mode: true });
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// -- Hailuo request shape --------------------------------------------

describe('MiniMaxVideoProvider.generate Hailuo request shape', () => {
    it('creates a v1 task, polls it and exchanges the file id for a URL', async () => {
        mockHailuoFlow(hailuoTask('Preparing'), hailuoTask('Success'));
        const result = await generate({
            model: 'minimax-hailuo-2.3',
            seconds: 10,
            width: 1920,
            height: 1080,
        });

        expect(result).toBe('https://minimax.example/hailuo.mp4');
        expect(sentUrl()).toBe('https://api.minimax.io/v1/video_generation');
        expect(sentBody()).toEqual({
            model: 'MiniMax-Hailuo-2.3',
            prompt: 'a ball rolls',
            duration: 10,
            resolution: '768P',
        });
        expect(sentUrl(1)).toBe(
            'https://api.minimax.io/v1/query/video_generation?task_id=task-1',
        );
        expect(sentUrl(3)).toBe(
            'https://api.minimax.io/v1/files/retrieve?file_id=file-1',
        );
    });

    it('falls back to 6 seconds at 1080p, which takes no 10-second clip', async () => {
        mockHailuoFlow(hailuoTask('Success'));
        await generate({
            model: 'minimax-hailuo-2.3-fast',
            seconds: 10,
            size: '1080p',
            input_reference: 'https://example.com/first.png',
        });
        expect(sentBody()).toMatchObject({
            model: 'MiniMax-Hailuo-2.3-Fast',
            duration: 6,
            resolution: '1080P',
            first_frame_image: 'https://example.com/first.png',
        });
    });

    it.each(['768p', '1080p'])('sends first and last frames at %s', async (size) => {
        mockHailuoFlow(hailuoTask('Success'));
        await generate({
            model: 'minimax-hailuo-02',
            size,
            input_reference: 'DDDD',
            last_frame: 'https://example.com/last.png',
        });
        expect(sentBody()).toEqual({
            model: 'MiniMax-Hailuo-02',
            prompt: 'a ball rolls',
            duration: 6,
            resolution: size.toUpperCase(),
            first_frame_image: 'data:image/png;base64,DDDD',
            last_frame_image: 'https://example.com/last.png',
        });
    });
});

// -- Validation ------------------------------------------------------

describe('MiniMaxVideoProvider.generate rejects invalid input before calling MiniMax', () => {
    it.each<[string, Partial<IGenerateVideoParams>]>([
        ['a blank prompt', { prompt: '  ' }],
        [
            'a prompt over 7000 characters on H3',
            { model: 'minimax-h3', prompt: 'x'.repeat(7001) },
        ],
        [
            'a prompt over 2000 characters on Hailuo',
            { model: 'minimax-hailuo-2.3', prompt: 'x'.repeat(2001) },
        ],
        [
            'a source video',
            { model: 'minimax-h3', input_video: 'https://example.com/v.mp4' },
        ],
        [
            'reference images on Hailuo',
            {
                model: 'minimax-hailuo-02',
                reference_images: ['https://example.com/r.png'],
            },
        ],
        [
            'reference images with a first frame on H3',
            {
                model: 'minimax-h3',
                input_reference: 'https://example.com/f.png',
                reference_images: ['https://example.com/r.png'],
            },
        ],
        [
            'more than 5 images on H3',
            {
                model: 'minimax-h3',
                reference_images: Array(6).fill('https://example.com/r.png'),
            },
        ],
        [
            'more than 2 images on H3 Max',
            {
                model: 'minimax-h3-max',
                reference_images: Array(3).fill('https://example.com/r.png'),
            },
        ],
        [
            'a last frame on Hailuo 2.3',
            {
                model: 'minimax-hailuo-2.3',
                input_reference: 'https://example.com/f.png',
                last_frame: 'https://example.com/l.png',
            },
        ],
        [
            'a last frame without a first frame on Hailuo 02',
            {
                model: 'minimax-hailuo-02',
                last_frame: 'https://example.com/l.png',
            },
        ],
        [
            '512p without a first frame on Hailuo 02',
            { model: 'minimax-hailuo-02', size: '512p' },
        ],
        [
            'a missing first frame on Hailuo 2.3 Fast',
            { model: 'minimax-hailuo-2.3-fast' },
        ],
        [
            '512p with first and last frames on Hailuo 02',
            {
                model: 'minimax-hailuo-02',
                size: '512p',
                input_reference: 'https://example.com/first.png',
                last_frame: 'https://example.com/last.png',
            },
        ],
        [
            'a non-string image',
            { model: 'minimax-h3', input_reference: 42 as never },
        ],
        [
            'a non-array reference_images',
            { model: 'minimax-h3', reference_images: 'x' as never },
        ],
    ])('rejects %s', async (_label, params) => {
        fetchSpy.mockRejectedValue(new Error('Unexpected MiniMax request'));
        const reserveCreditsSpy = vi.spyOn(
            server.services.metering,
            'reserveCredits',
        );
        await expect(generate(params)).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(reserveCreditsSpy).not.toHaveBeenCalled();
    });

    it('accepts a 7000-character prompt on H3', async () => {
        mockH3Flow(h3Task());
        await generate({ model: 'minimax-h3', prompt: 'x'.repeat(7000) });
        expect(fetchSpy).toHaveBeenCalled();
    });

    it('accepts five images on H3', async () => {
        mockH3Flow(h3Task());
        await generate({
            model: 'minimax-h3',
            reference_images: Array(5).fill('https://example.com/r.png'),
        });
        expect(sentBody().content).toHaveLength(6);
    });
});

// -- Billing ---------------------------------------------------------

describe('MiniMaxVideoProvider billing', () => {
    it.each<[Partial<IGenerateVideoParams>, string, string, number]>([
        [
            { model: 'minimax-h3', seconds: 5 },
            'minimax-h3',
            'per-second:768p',
            5,
        ],
        [
            { model: 'minimax-h3', seconds: 8, size: '2k' },
            'minimax-h3',
            'per-second:2k',
            8,
        ],
        [
            { model: 'minimax-h3-lite', seconds: 4, size: '480p' },
            'minimax-h3-lite',
            'per-second:480p',
            4,
        ],
    ])(
        'meters %o per second under its cost key',
        async (params, id, key, secs) => {
            mockH3Flow(
                h3Task({ duration: secs, usage: { output_seconds: secs } }),
            );
            await generate(params);
            expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
            const [, usageType, amount, cost] =
                incrementUsageSpy.mock.calls[0]!;
            expect(usageType).toBe(`minimax-video-generation:${id}:${key}`);
            expect(amount).toBe(secs);
            expect(cost).toBeCloseTo(secs * rate(id, key) * 1_000_000);
        },
    );

    it('bills the seconds of output the task reports', async () => {
        mockH3Flow(h3Task({ duration: 5, usage: { output_seconds: 4 } }));
        await generate({ model: 'minimax-h3', seconds: 5 });
        const [, , amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(amount).toBe(4);
        expect(cost).toBeCloseTo(4 * 8 * 1_000_000);
    });

    it('bills the requested seconds when the task reports no usage', async () => {
        mockH3Flow(h3Task({ duration: undefined, usage: undefined }));
        await generate({ model: 'minimax-h3', seconds: 7 });
        expect(incrementUsageSpy.mock.calls[0]![2]).toBe(7);
    });

    it('shortens an H3 clip to what the balance buys', async () => {
        remainingUsageSpy.mockResolvedValue(6 * 8 * 1_000_000);
        mockH3Flow(h3Task({ duration: 6, usage: { output_seconds: 6 } }));
        await generate({ model: 'minimax-h3', seconds: 10 });
        expect(sentBody().duration).toBe(6);
    });

    it('rejects with insufficient_funds before creating an H3 task it cannot afford', async () => {
        remainingUsageSpy.mockResolvedValue(1000);
        await expect(generate({ model: 'minimax-h3' })).rejects.toMatchObject({
            statusCode: 402,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each<[Partial<IGenerateVideoParams>, string, string]>([
        [
            { model: 'minimax-hailuo-2.3', seconds: 10 },
            'minimax-hailuo-2.3',
            'per-video:768p:10',
        ],
        [
            { model: 'minimax-hailuo-02', size: '1080p' },
            'minimax-hailuo-02',
            'per-video:1080p:6',
        ],
        [
            {
                model: 'minimax-hailuo-02',
                size: '512p',
                seconds: 10,
                input_reference: 'https://example.com/f.png',
            },
            'minimax-hailuo-02',
            'per-video:512p:10',
        ],
    ])('meters a Hailuo clip %o as one video', async (params, id, key) => {
        mockHailuoFlow(hailuoTask('Success'));
        await generate(params);
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe(`minimax-video-generation:${id}:${key}`);
        expect(amount).toBe(1);
        expect(cost).toBe(rate(id, key) * 1_000_000);
    });

    it('rejects with insufficient_funds before creating a Hailuo task it cannot afford', async () => {
        remainingUsageSpy.mockResolvedValue(1000);
        await expect(
            generate({ model: 'minimax-hailuo-2.3' }),
        ).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Failures --------------------------------------------------------

describe('MiniMaxVideoProvider failures', () => {
    it.each(['failed', 'cancelled'])(
        'maps a %s H3 task to upstream_failed and meters nothing',
        async (status) => {
            mockH3Flow(
                h3Task({
                    status,
                    content: undefined,
                    error: { code: '1000', message: 'unknown error' },
                }),
            );
            await expect(generate({})).rejects.toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
            });
            expect(incrementUsageSpy).not.toHaveBeenCalled();
        },
    );

    it('maps an H3 task failed by the content filter to moderation_flagged', async () => {
        mockH3Flow(
            h3Task({
                status: 'failed',
                content: undefined,
                error: {
                    code: '1026',
                    message: 'video description contains sensitive content',
                },
            }),
        );
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('carries a v2 parameter rejection with its status and code', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    type: 'error',
                    error: {
                        type: 'bad_request_error',
                        message:
                            'invalid params, model MiniMax-H3-Lite does not support resolution 2K (2013)',
                        http_code: '400',
                    },
                },
                400,
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            status: 400,
            code: '2013',
            provider: 'minimax',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('reports a model MiniMax no longer serves as upstream_failed', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    type: 'error',
                    error: {
                        type: 'bad_request_error',
                        message:
                            'invalid params, this model is not supported by /v2/video_generation (2013)',
                    },
                },
                400,
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
    });

    it('hides the auth message behind a 401', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    type: 'error',
                    error: {
                        type: 'authorized_error',
                        message:
                            'login fail: carry the key in Authorization (1004)',
                    },
                },
                401,
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            status: 401,
            message: 'MiniMax rejected the API key',
        });
    });

    it('surfaces an empty balance as status 402 with the MiniMax code', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    type: 'error',
                    error: {
                        type: 'insufficient_balance_error',
                        message: 'insufficient balance (1008)',
                    },
                },
                402,
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            status: 402,
            code: '1008',
            provider: 'minimax',
        });
    });

    it('maps a content block at submit to moderation_flagged', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse(
                {
                    type: 'error',
                    error: {
                        type: 'unprocessable_entity_error',
                        message: 'input new_sensitive (1026)',
                    },
                },
                422,
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
    });

    it('reads a v1 verdict out of base_resp under HTTP 200', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({
                task_id: '',
                base_resp: {
                    status_code: 1008,
                    status_msg: 'insufficient balance',
                },
            }),
        );
        await expect(
            generate({ model: 'minimax-hailuo-2.3' }),
        ).rejects.toMatchObject({
            status: 402,
            code: '1008',
            provider: 'minimax',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('reports a Hailuo model MiniMax no longer serves as upstream_failed', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({
                task_id: '',
                base_resp: {
                    status_code: 2013,
                    status_msg: 'invalid params, incorrect model param input',
                },
            }),
        );
        await expect(
            generate({ model: 'minimax-hailuo-2.3' }),
        ).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
    });

    it('maps a failed Hailuo task to upstream_failed and meters nothing', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ task_id: 'task-1', base_resp: ok }),
        );
        fetchSpy.mockResolvedValueOnce(jsonResponse(hailuoTask('Fail')));
        await expect(
            generate({ model: 'minimax-hailuo-2.3' }),
        ).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps a Hailuo clip removed by the output filter to moderation_flagged', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ task_id: 'task-1', base_resp: ok }),
        );
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({
                task_id: 'task-1',
                status: 'Fail',
                base_resp: {
                    status_code: 1027,
                    status_msg: 'output new_sensitive',
                },
            }),
        );
        await expect(
            generate({ model: 'minimax-hailuo-2.3' }),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('fails when the finished H3 task has no video', async () => {
        mockH3Flow(h3Task({ content: {} }));
        await expect(generate({})).rejects.toThrow(/video URL/);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('fails when the Hailuo file has no download URL', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ task_id: 'task-1', base_resp: ok }),
        );
        fetchSpy.mockResolvedValueOnce(jsonResponse(hailuoTask('Success')));
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ file: { file_id: 1 }, base_resp: ok }),
        );
        await expect(generate({ model: 'minimax-hailuo-2.3' })).rejects.toThrow(
            /video URL/,
        );
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

describe('MiniMaxVideoProvider after the caller leaves', () => {
    const disconnected = (params: Partial<IGenerateVideoParams>) =>
        withTestActor(() => {
            const abort = new AbortController();
            abort.abort();
            Context.set('abortSignal', abort.signal);
            return makeProvider().generate({
                prompt: 'a ball rolls',
                ...params,
            });
        });

    /** Moves the clock past the poll window on the first status poll. */
    const expireOnPoll = (pending: unknown) => {
        const realNow = Date.now.bind(Date);
        let skew = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
        fetchSpy.mockImplementation(async () => {
            skew = VIDEO_POLL_WINDOW_MS + 1;
            return jsonResponse(pending);
        });
    };

    const timedOut = async (params: Partial<IGenerateVideoParams>) => {
        try {
            await generate(params);
        } catch (e) {
            return e;
        }
        throw new Error('expected the call to reject');
    };

    it('keeps polling an H3 task after a disconnect and meters it', async () => {
        mockH3Flow(h3Task({ status: 'running' }), h3Task());
        await expect(
            disconnected({ model: 'minimax-h3', seconds: 5 }),
        ).resolves.toBe('https://minimax.example/out.mp4');
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        expect(incrementUsageSpy.mock.calls[0]![2]).toBe(5);
    });

    it('keeps polling a Hailuo task after a disconnect and meters it', async () => {
        mockHailuoFlow(hailuoTask('Processing'), hailuoTask('Success'));
        await expect(
            disconnected({ model: 'minimax-hailuo-2.3', seconds: 6 }),
        ).resolves.toBe('https://minimax.example/hailuo.mp4');
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
    });

    it('meters the held H3 seconds when the task outlives the window', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ task_id: 'task-1' }));
        expireOnPoll({ task: h3Task({ status: 'running' }) });
        expect(
            await timedOut({ model: 'minimax-h3', seconds: 5 }),
        ).toMatchObject({ statusCode: 504, legacyCode: 'upstream_timeout' });
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe(
            'minimax-video-generation:minimax-h3:per-second:768p',
        );
        expect(amount).toBe(5);
        expect(cost).toBeCloseTo(
            5 * rate('minimax-h3', 'per-second:768p') * 1_000_000,
        );
    });

    it('meters the held Hailuo clip when the task outlives the window', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ task_id: 'task-1', base_resp: ok }),
        );
        expireOnPoll(hailuoTask('Processing'));
        expect(
            await timedOut({ model: 'minimax-hailuo-2.3', seconds: 6 }),
        ).toMatchObject({ statusCode: 504 });
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        expect(incrementUsageSpy.mock.calls[0]![2]).toBe(1);
    });
});
