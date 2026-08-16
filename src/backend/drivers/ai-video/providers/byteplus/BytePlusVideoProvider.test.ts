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
 * Offline unit tests for BytePlusVideoProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs BytePlusVideoProvider directly against the
 * live wired `MeteringService`. Ark's task-based video API has no
 * SDK — the provider hits it via global `fetch`, which we stub;
 * that's the real network egress point.
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
import { BYTEPLUS_VIDEO_GENERATION_MODELS } from './models.js';
import { BytePlusVideoProvider } from './BytePlusVideoProvider.js';

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

const makeProvider = (
    config: { apiKey?: string; apiBaseUrl?: string } = {},
) =>
    new BytePlusVideoProvider(
        {
            apiKey: config.apiKey ?? 'test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
            pollIntervalMs: 1,
        },
        server.services.metering,
    );

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    remainingUsageSpy = vi.spyOn(
        server.services.metering,
        'getRemainingUsage',
    );
    // Plenty of credit unless a test says otherwise.
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

const succeededTask = (overrides: Record<string, unknown> = {}) => ({
    id: 'cgt-test-1',
    status: 'succeeded',
    content: { video_url: 'https://ark.example/video.mp4' },
    usage: { completion_tokens: 108_000, total_tokens: 108_000 },
    resolution: '720p',
    duration: 5,
    ...overrides,
});

/** Queue up the POST-create response followed by GET-poll responses. */
const mockTaskFlow = (...pollBodies: unknown[]) => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 'cgt-test-1' }));
    for (const body of pollBodies) {
        fetchSpy.mockResolvedValueOnce(jsonResponse(body));
    }
};

const sentBody = (callIndex = 0): Record<string, unknown> =>
    JSON.parse(
        (fetchSpy.mock.calls[callIndex]![1] as RequestInit).body as string,
    );

const findModel = (id: string) =>
    BYTEPLUS_VIDEO_GENERATION_MODELS.find((m) => m.id === id)!;

// -- Construction / catalog ------------------------------------------

describe('BytePlusVideoProvider construction and catalog', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new BytePlusVideoProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });

    it('does not call out at construction (lazy fetch)', () => {
        makeProvider();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('defaults to seedance 2.0 mini', () => {
        expect(makeProvider().getDefaultModel()).toBe(
            'dreamina-seedance-2-0-mini-260615',
        );
    });

    it('exposes the static catalog', async () => {
        expect(await makeProvider().models()).toBe(
            BYTEPLUS_VIDEO_GENERATION_MODELS,
        );
    });
});

// -- Gates -----------------------------------------------------------

describe('BytePlusVideoProvider.generate gates', () => {
    it('returns the canned sample URL in test_mode without network calls', async () => {
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'x', test_mode: true }),
        );
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws 400 on a missing or blank prompt', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: undefined as unknown as string,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws 402 BEFORE creating a task when even the shortest clip is unaffordable', async () => {
        remainingUsageSpy.mockResolvedValue(0);
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Request shape ---------------------------------------------------

describe('BytePlusVideoProvider.generate request shape', () => {
    it('POSTs a create-task request with text content and defaults', async () => {
        mockTaskFlow(succeededTask());
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'a kitten yawns' }),
        );

        expect(result).toBe('https://ark.example/video.mp4');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe(
            'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks',
        );
        expect((init as RequestInit).method).toBe('POST');
        expect(
            (init as RequestInit & { headers: Record<string, string> })
                .headers.Authorization,
        ).toBe('Bearer test-key');

        const body = sentBody();
        expect(body.model).toBe('dreamina-seedance-2-0-mini-260615');
        expect(body.content).toEqual([
            { type: 'text', text: 'a kitten yawns' },
        ]);
        expect(body.resolution).toBe('720p');
        expect(body.duration).toBe(5);
        expect(body.watermark).toBe(false);
        expect(body.generate_audio).toBe(true);

        // Poll goes to GET tasks/{id}.
        const [pollUrl, pollInit] = fetchSpy.mock.calls[1]!;
        expect(String(pollUrl)).toBe(
            'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/cgt-test-1',
        );
        expect((pollInit as RequestInit).method).toBe('GET');
    });

    it('resolves aliases, uppercases 4k, and clamps duration to the model range', async () => {
        mockTaskFlow(succeededTask({ resolution: '4k' }));
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-2-0',
                prompt: 'hi',
                resolution: '4k',
                seconds: 99,
            }),
        );
        const body = sentBody();
        expect(body.model).toBe('dreamina-seedance-2-0-260128');
        expect(body.resolution).toBe('4K');
        expect(body.duration).toBe(15);
    });

    // A clip shorter than the model's minimum is a duration to round up, not
    // an affordability problem — it used to surface as "insufficient funds".
    it('rounds a sub-minimum duration up to the shortest supported clip', async () => {
        mockTaskFlow(succeededTask({ resolution: '480p' }));
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-2-0-mini',
                prompt: 'hi',
                resolution: '480p',
                seconds: 2,
            }),
        );
        expect(sentBody().duration).toBe(4);
    });

    // `dims` is shared across a model family, so it can't be the gate for
    // what an individual model accepts.
    it('falls back to the default resolution when the model does not list it', async () => {
        mockTaskFlow(succeededTask({ resolution: '720p' }));
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-2-0-mini',
                prompt: 'hi',
                resolution: '1080p',
            }),
        );
        expect(sentBody().resolution).toBe('720p');
    });

    it('omits generate_audio for models without audio and passes seed for 1.x', async () => {
        mockTaskFlow(succeededTask({ resolution: '1080p' }));
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-1-0-pro',
                prompt: 'hi',
                seed: 11,
            }),
        );
        const body = sentBody();
        expect(body.generate_audio).toBeUndefined();
        expect(body.seed).toBe(11);
        expect(body.resolution).toBe('1080p');
    });

    it('derives a supported ratio from width/height and omits unsupported ones', async () => {
        mockTaskFlow(succeededTask());
        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                width: 1280,
                height: 720,
            }),
        );
        expect(sentBody().ratio).toBe('16:9');

        mockTaskFlow(succeededTask());
        await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', width: 999, height: 100 }),
        );
        expect(sentBody(2).ratio).toBeUndefined();
    });

    it('maps input_reference/last_frame to first/last frame roles', async () => {
        mockTaskFlow(succeededTask());
        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                input_reference: 'https://example.com/first.png',
                last_frame: 'https://example.com/last.png',
            }),
        );
        expect(sentBody().content).toEqual([
            { type: 'text', text: 'hi' },
            {
                type: 'image_url',
                image_url: { url: 'https://example.com/first.png' },
                role: 'first_frame',
            },
            {
                type: 'image_url',
                image_url: { url: 'https://example.com/last.png' },
                role: 'last_frame',
            },
        ]);
    });

    it('maps reference_images for the 2.0 series and rejects them elsewhere', async () => {
        mockTaskFlow(succeededTask());
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-2-0',
                prompt: 'hi',
                reference_images: ['https://example.com/ref.png'],
            }),
        );
        expect(sentBody().content).toContainEqual({
            type: 'image_url',
            image_url: { url: 'https://example.com/ref.png' },
            role: 'reference_image',
        });

        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    model: 'seedance-1-0-pro',
                    prompt: 'hi',
                    reference_images: ['https://example.com/ref.png'],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects last_frame without a first frame', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: 'hi',
                    last_frame: 'https://example.com/last.png',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Polling / outcomes ----------------------------------------------

describe('BytePlusVideoProvider.generate polling and outcomes', () => {
    it('keeps polling while the task is queued/running', async () => {
        mockTaskFlow(
            { id: 'cgt-test-1', status: 'queued' },
            { id: 'cgt-test-1', status: 'running' },
            succeededTask(),
        );
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi' }),
        );
        expect(result).toBe('https://ark.example/video.mp4');
        expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 create + 3 polls
    });

    it('throws 400 upstream_failed when the task fails, without metering', async () => {
        mockTaskFlow({
            id: 'cgt-test-1',
            status: 'failed',
            error: { code: 'moderation', message: 'blocked' },
        });
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 400, message: 'blocked' });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 5xx on create to a 502', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ error: { message: 'boom' } }, 500),
        );
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 502 });
    });
});

// -- Metering --------------------------------------------------------

describe('BytePlusVideoProvider.generate metering', () => {
    it('bills the tokens the task reports at the resolution rate', async () => {
        mockTaskFlow(succeededTask({ resolution: '1080p' }));
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-2-0',
                prompt: 'hi',
                resolution: '1080p',
            }),
        );
        const model = findModel('dreamina-seedance-2-0-260128');
        const rate = model.costs!['video_tokens:1080p'];
        expect(incrementUsageSpy).toHaveBeenCalledWith(
            expect.anything(),
            'byteplus-video-generation:dreamina-seedance-2-0-260128:video_tokens:1080p',
            108_000,
            108_000 * rate * 1_000_000,
        );
    });

    it('bills seedance 1.5 pro at the silent rate when generate_audio is false', async () => {
        mockTaskFlow(succeededTask());
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedance-1-5-pro',
                prompt: 'hi',
                generate_audio: false,
            }),
        );
        expect(sentBody().generate_audio).toBe(false);
        const model = findModel('seedance-1-5-pro-251215');
        const rate = model.costs!['video_tokens:silent'];
        expect(incrementUsageSpy).toHaveBeenCalledWith(
            expect.anything(),
            'byteplus-video-generation:seedance-1-5-pro-251215:video_tokens:silent',
            108_000,
            108_000 * rate * 1_000_000,
        );
    });

    it('clamps the clip to what remaining credit buys', async () => {
        // seedance 2.0 mini @720p: 1280×720×24/1024 = 21600 tokens/s at
        // 0.00035¢/token → 7.56¢/s. Grant ~15¢ ≈ 2s... below the 4s
        // minimum → 402. Grant ~40¢ → 5s requested, affordable.
        const perSecondMicroCents = 21_600 * 0.00035 * 1_000_000;
        remainingUsageSpy.mockResolvedValue(4.5 * perSecondMicroCents);
        mockTaskFlow(succeededTask());
        await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', seconds: 10 }),
        );
        expect(sentBody().duration).toBe(4);

        remainingUsageSpy.mockResolvedValue(2 * perSecondMicroCents);
        await expect(
            withTestActor(() =>
                makeProvider().generate({ prompt: 'hi', seconds: 10 }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });
    });
});
