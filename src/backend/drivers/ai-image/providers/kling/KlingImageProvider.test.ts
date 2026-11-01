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
 * Offline unit tests for KlingImageProvider.
 *
 * Boots a real PuterServer and constructs the provider against the live wired
 * `MeteringService`. Kling's task API has no SDK; the provider calls it through
 * global `fetch`, which is stubbed as the network egress point.
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
import type { IGenerateParams } from '../../types.js';
import { KlingImageProvider } from './KlingImageProvider.js';

// -- Test harness ----------------------------------------------------

let server: PuterServer;
let fetchSpy: MockInstance<typeof fetch>;
let admitSpy: MockInstance<MeteringService['reserveCreditsIfAffordable']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () =>
    new KlingImageProvider(
        { apiKey: 'test-key', pollIntervalMs: 1 },
        withAiCostFactor(
            server.services.metering,
            server.clients.event,
            'ai-image',
        ),
    );

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    admitSpy = vi.spyOn(server.services.metering, 'reserveCreditsIfAffordable');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
    incrementUsageSpy.mockResolvedValue({} as never);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const envelope = (data: unknown, code = 0, status = 200) =>
    new Response(JSON.stringify({ code, message: 'msg', data }), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const task = (status: string, extra: Record<string, unknown> = {}) => ({
    task_id: 'task-1',
    task_status: status,
    ...extra,
});

const succeeded = task('succeed', {
    task_result: { images: [{ index: 0, url: 'https://kling.example/1.png' }] },
});

/** Queue the create response, then each poll response. */
const mockFlow = (...polls: Response[]) => {
    fetchSpy.mockResolvedValueOnce(envelope(task('submitted')));
    for (const poll of polls) fetchSpy.mockResolvedValueOnce(poll);
};

const call = (i: number) => {
    const [url, init] = fetchSpy.mock.calls[i]!;
    return {
        url: String(url),
        method: (init as RequestInit).method,
        body: (init as RequestInit).body
            ? JSON.parse((init as RequestInit).body as string)
            : undefined,
    };
};

const generate = (params: Partial<IGenerateParams>) =>
    withTestActor(() =>
        makeProvider().generate({ prompt: 'a red apple', ...params }),
    );

// -- Construction ----------------------------------------------------

describe('KlingImageProvider construction', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new KlingImageProvider(
                    { apiKey: '' },
                    withAiCostFactor(
                        server.services.metering,
                        server.clients.event,
                        'ai-image',
                    ),
                ),
        ).toThrow(/API key/i);
    });

    it('defaults to Kling Image 3.0', () => {
        expect(makeProvider().getDefaultModel()).toBe('kling-v3');
    });
});

// -- Request shape ---------------------------------------------------

describe('KlingImageProvider request', () => {
    it('creates a text-to-image task and returns the polled image URL', async () => {
        mockFlow(envelope(task('processing')), envelope(succeeded));

        const url = await generate({});

        expect(url).toBe('https://kling.example/1.png');
        const create = call(0);
        expect(create.url).toBe(
            'https://api-singapore.klingai.com/v1/images/generations',
        );
        expect(create.method).toBe('POST');
        expect(create.body).toEqual({
            model_name: 'kling-v3',
            prompt: 'a red apple',
            n: 1,
            resolution: '1k',
            aspect_ratio: '1:1',
        });
        expect(call(1).url).toBe(
            'https://api-singapore.klingai.com/v1/images/generations/task-1',
        );
        expect(call(1).method).toBe('GET');
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
            .headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer test-key');
    });

    it.each([
        ['high', '2k'],
        ['2K', '2k'],
        ['low', '1k'],
        ['ultra', '1k'],
    ])('maps quality %s to the %s tier', async (quality, tier) => {
        mockFlow(envelope(succeeded));
        await generate({ quality });
        expect(call(0).body.resolution).toBe(tier);
    });

    it('takes 4k only on Image 3.0 Omni', async () => {
        mockFlow(envelope(succeeded));
        await generate({ model: 'kling-v3-omni', quality: '4k' });
        expect(call(0).body.resolution).toBe('4k');

        fetchSpy.mockReset();
        mockFlow(envelope(succeeded));
        await generate({ model: 'kling-v3', quality: '4k' });
        expect(call(0).body.resolution).toBe('1k');
    });

    it('snaps the requested size to the closest Kling aspect ratio', async () => {
        mockFlow(envelope(succeeded));
        await generate({ imageSize: { w: 1920, h: 1000, kind: 'pixels' } });
        expect(call(0).body.aspect_ratio).toBe('16:9');

        fetchSpy.mockReset();
        mockFlow(envelope(succeeded));
        await generate({ imageSize: { w: 2, h: 3, kind: 'aspect' } });
        expect(call(0).body.aspect_ratio).toBe('2:3');
    });

    it('sends a negative prompt only without a reference image', async () => {
        mockFlow(envelope(succeeded));
        await generate({ negative_prompt: 'blur' });
        expect(call(0).body.negative_prompt).toBe('blur');

        fetchSpy.mockReset();
        mockFlow(envelope(succeeded));
        await generate({
            negative_prompt: 'blur',
            input_image: 'https://example.com/a.png',
        });
        expect(call(0).body.negative_prompt).toBeUndefined();
        expect(call(0).body.image).toBe('https://example.com/a.png');
    });

    it('sends a data URI reference image as raw base64', async () => {
        mockFlow(envelope(succeeded));
        await generate({ input_images: ['data:image/png;base64,iVBORw0KGgo'] });
        expect(call(0).body.image).toBe('iVBORw0KGgo');
    });

    it.each(['kling-v3-omni', 'kling-image-o1'])(
        'sends %s reference images to omni-image with an auto ratio',
        async (model) => {
            mockFlow(envelope(succeeded));
            await generate({
                model,
                input_images: [
                    'https://example.com/a.png',
                    'data:image/jpeg;base64,/9j/4AAQ',
                ],
            });
            const create = call(0);
            expect(create.url).toBe(
                'https://api-singapore.klingai.com/v1/images/omni-image',
            );
            expect(create.body).toMatchObject({
                model_name: model,
                aspect_ratio: 'auto',
                image_list: [
                    { image: 'https://example.com/a.png' },
                    { image: '/9j/4AAQ' },
                ],
            });
            expect(call(1).url).toBe(
                'https://api-singapore.klingai.com/v1/images/omni-image/task-1',
            );
        },
    );

    it('rejects more input images than the model takes before any fetch', async () => {
        await expect(
            generate({
                model: 'kling-v3',
                input_images: ['https://e.com/a.png', 'https://e.com/b.png'],
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns the sample image in test mode without calling Kling', async () => {
        const url = await generate({ test_mode: true });
        expect(url).toMatch(/^https:\/\//);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('retries a transient poll failure', async () => {
        mockFlow(
            envelope(undefined, 5000, 500),
            envelope(task('processing')),
            envelope(succeeded),
        );
        await expect(generate({})).resolves.toBe('https://kling.example/1.png');
        expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
});

// -- Billing ---------------------------------------------------------

describe('KlingImageProvider billing', () => {
    it('meters one image at the tier rate', async () => {
        mockFlow(envelope(succeeded));
        await generate({ model: 'kling-v3-omni', quality: '4k' });
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('kling-image-generation:kling-v3-omni:4k');
        expect(amount).toBe(1);
        expect(cost).toBe(5.6 * 1_000_000);
    });

    it('bills Image 2.1 image-to-image at its own rate', async () => {
        mockFlow(envelope(succeeded));
        await generate({
            model: 'kling-v2-1',
            input_image: 'https://example.com/a.png',
        });
        const [, usageType, , cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe(
            'kling-image-generation:kling-v2-1:1k:image-to-image',
        );
        expect(cost).toBe(2.8 * 1_000_000);

        incrementUsageSpy.mockClear();
        fetchSpy.mockReset();
        mockFlow(envelope(succeeded));
        await generate({ model: 'kling-v2-1' });
        const [, textUsage, , textCost] = incrementUsageSpy.mock.calls[0]!;
        expect(textUsage).toBe('kling-image-generation:kling-v2-1:1k');
        expect(textCost).toBe(1.4 * 1_000_000);
    });

    it('rejects before calling Kling when credits run short', async () => {
        admitSpy.mockResolvedValueOnce(null);
        await expect(generate({})).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reports a content-policy failure as moderation_flagged, unbilled', async () => {
        mockFlow(
            envelope(
                task('failed', {
                    task_status_msg:
                        'Triggering the content risk control of the platform',
                }),
            ),
        );
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('reports any other failed task as upstream_failed, unbilled', async () => {
        mockFlow(
            envelope(task('failed', { task_status_msg: 'internal error' })),
        );
        await expect(generate({})).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// -- After the caller leaves -----------------------------------------

describe('KlingImageProvider after the caller leaves', () => {
    it('keeps polling after a disconnect and meters the finished image', async () => {
        mockFlow(envelope(task('processing')), envelope(succeeded));
        const url = await withTestActor(() => {
            const abort = new AbortController();
            abort.abort();
            Context.set('abortSignal', abort.signal);
            return makeProvider().generate({ prompt: 'a red apple' });
        });
        expect(url).toBe('https://kling.example/1.png');
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
    });

    it('meters an image that finishes after the window', async () => {
        fetchSpy.mockResolvedValueOnce(envelope(task('submitted')));
        const realNow = Date.now.bind(Date);
        let skew = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
        let finished = false;
        fetchSpy.mockImplementation(async () => {
            skew = 6 * 60 * 1000;
            return finished
                ? envelope(succeeded)
                : envelope(task('processing'));
        });

        let failure: unknown;
        try {
            await generate({ model: 'kling-v3-omni', quality: '4k' });
        } catch (e) {
            failure = e;
        }
        expect(failure).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
            message: 'Timed out waiting for Kling image generation to complete',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();

        finished = true;
        await vi.waitFor(() =>
            expect(incrementUsageSpy).toHaveBeenCalledTimes(1),
        );
        const [, usageType, amount, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('kling-image-generation:kling-v3-omni:4k');
        expect(amount).toBe(1);
        expect(cost).toBe(5.6 * 1_000_000);
    });
});
