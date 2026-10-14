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
 * Offline unit tests for the Gemini Omni video provider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis)
 * with Gemini and Together keys and drives the unified
 * `puter-video-generation` driver, so routing, file loading, credit holds,
 * usage recording and `puter_output_path` run end to end. Global `fetch` is
 * stubbed with canned countTokens and Interactions replies, and `secureFetch`
 * with a canned image, the real network egress points.
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

import type { Actor } from '../../../../core/actor.js';
import { Context, runWithContext } from '../../../../core/context.js';
import { PuterServer } from '../../../../server.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { UsageInput } from '../../../../services/metering/types.js';
import { setupTestServer } from '../../../../testUtil.js';
import { generateDefaultFsentries } from '../../../../util/userProvisioning.js';
import { callerError } from '../../../integrationTestUtil.js';
import { loadFileInput } from '../../../util/fileInput.js';
import type { IGenerateVideoParams } from '../../types.js';
import type { VideoGenerationDriver } from '../../VideoGenerationDriver.js';
import {
    GEMINI_OMNI_COUNT_TOKENS_MAX_RESPONSE_BYTES,
    GEMINI_OMNI_MAX_IMAGE_BYTES,
    GEMINI_OMNI_MAX_RESPONSE_BYTES,
} from './GeminiVideoProvider.js';

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));

vi.mock('../../../../util/secureHttp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../util/secureHttp.js')>()),
    secureFetch: secureFetchMock,
}));

const MODEL = 'gemini-omni-1.1-flash';
const PROVIDER = 'gemini-video-generation';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const INTERACTIONS_URL = `${API_BASE}/interactions`;
const COUNT_TOKENS_URL = `${API_BASE}/models/${MODEL}:countTokens`;
const SAMPLE_URL = 'https://assets.puter.site/txt2vid.mp4';
const PROMPT = 'A stationary red ball.';

// Mirrors the published rates: $1.50/M input, $9/M text output and
// thinking, $17.50/M video output.
const INPUT_RATE = 150;
const TEXT_RATE = 900;
const VIDEO_RATE = 1750;
const OUTPUT_ALLOWANCE = 65536;
const COUNTED_TOKENS = 18;
const holdFor = (inputTokens: number) =>
    inputTokens * INPUT_RATE +
    173760 * VIDEO_RATE +
    OUTPUT_ALLOWANCE * TEXT_RATE;
const HOLD = holdFor(COUNTED_TOKENS);

// A 1x1 PNG, and the head of an MP4 (an `ftyp` box with an `isom` brand).
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom', 'latin1'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2', 'latin1'),
    Buffer.from('mdat-frames', 'latin1'),
]);

// -- Test harness --

let server: PuterServer;
let videoDriver: VideoGenerationDriver;
let fetchSpy: MockInstance<typeof fetch>;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let batchSpy: MockInstance<MeteringService['batchIncrementUsages']>;

const generate = (args: Record<string, unknown> = {}) =>
    videoDriver.generate({
        prompt: PROMPT,
        model: MODEL,
        ...args,
    } as IGenerateVideoParams);

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            gemini: { apiKey: 'gemini-test-key' },
            'together-video-generation': { apiKey: 'tg-key' },
        },
    } as never);
    videoDriver = server.drivers.aiVideo as unknown as VideoGenerationDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('unexpected fetch')) as MockInstance<
        typeof fetch
    >;
    secureFetchMock.mockReset();
    secureFetchMock.mockRejectedValue(new Error('unexpected secureFetch'));
    // The full hold is more than a new account's allowance.
    hasCreditsSpy = vi
        .spyOn(server.services.metering, 'hasEnoughCredits')
        .mockResolvedValue(true);
    batchSpy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `gemini-video-${Math.random().toString(36).slice(2, 10)}`;
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
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

const withActor = <T>(actor: Actor, fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor }, fn));

/** A caller with no user id, enough for test mode and routing. */
const TEST_MODE_ACTOR: Actor = {
    user: { uuid: uuidv4(), username: 'gemini-video-test-mode' },
} as Actor;

const testMode = (args: Record<string, unknown> = {}) =>
    withActor(TEST_MODE_ACTOR, () => generate({ test_mode: true, ...args }));

const USAGE_720P = {
    total_input_tokens: 18,
    input_tokens_by_modality: [{ modality: 'text', tokens: 18 }],
    total_output_tokens: 58539,
    output_tokens_by_modality: [{ modality: 'video', tokens: 57920 }],
    total_thought_tokens: 418,
    total_tokens: 58975,
};

const USAGE_360P_IMAGE = {
    total_input_tokens: 1107,
    input_tokens_by_modality: [
        { modality: 'image', tokens: 1100 },
        { modality: 'text', tokens: 7 },
    ],
    total_output_tokens: 19960,
    output_tokens_by_modality: [{ modality: 'video', tokens: 19310 }],
    total_thought_tokens: 220,
    total_tokens: 21287,
};

const videoBlock = (bytes: Buffer = MP4) => ({
    type: 'video',
    mime_type: 'video/mp4',
    data: bytes.toString('base64'),
});

/** A completed reply; `usage` given as undefined leaves the field out. */
const interaction = (
    opts: {
        status?: string;
        content?: unknown[];
        steps?: unknown[];
        usage?: unknown;
    } = {},
) => ({
    status: opts.status ?? 'completed',
    steps: opts.steps ?? [
        { type: 'model_output', content: opts.content ?? [videoBlock()] },
    ],
    ...('usage' in opts ? { usage: opts.usage } : { usage: USAGE_720P }),
});

/** Queues the countTokens reply, then the Interactions reply. */
const reply = (
    body: unknown = interaction(),
    count: unknown = { totalTokens: COUNTED_TOKENS },
) => {
    fetchSpy
        .mockResolvedValueOnce(Response.json(count))
        .mockResolvedValueOnce(Response.json(body));
};

const sent = (call: number) => {
    const [url, init] = fetchSpy.mock.calls[call]!;
    return {
        url: String(url),
        method: init?.method,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
    };
};

const metered = (): UsageInput[] =>
    batchSpy.mock.calls.flatMap(([, usages]) => usages);

/** Records each credit hold taken, its options, and its release. */
const trackHolds = (order: string[] = []) => {
    const metering = server.services.metering;
    const realReserve = metering.reserveCredits.bind(metering);
    const held: { amount: number; ttlMs?: number }[] = [];
    const released = vi.fn();
    vi.spyOn(metering, 'reserveCredits').mockImplementation(
        async (actor, amount, opts) => {
            held.push({ amount, ttlMs: opts?.ttlMs });
            const hold = await realReserve(actor, amount, opts);
            return {
                ...hold,
                release: async () => {
                    order.push('release');
                    released();
                    await hold.release();
                },
            };
        },
    );
    return { held, released };
};

/** A body that streams past `maxBytes` without declaring its length. */
const oversizedBody = (maxBytes: number) => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let sentBytes = 0;
    return new Response(
        new ReadableStream({
            pull(controller) {
                if (sentBytes > maxBytes) {
                    controller.close();
                    return;
                }
                sentBytes += chunk.byteLength;
                controller.enqueue(chunk);
            },
        }),
    );
};

const pngDataUri = `data:image/png;base64,${PNG_BASE64}`;

// -- Catalog and routing --

describe('GeminiVideoProvider catalog', () => {
    it('lists Gemini Omni with per-token cent rates and no duration or size ladder', async () => {
        const model = (await videoDriver.models()).find(
            (m) => m.provider === PROVIDER,
        );
        expect(model).toMatchObject({
            id: MODEL,
            puterId: `google:google/${MODEL}`,
            name: 'Gemini Omni 1.1 Flash',
            costs_currency: 'usd-cents',
            output_cost_key: 'output:video',
            costs: {
                input: 0.00015,
                'output:text': 0.0009,
                'output:video': 0.00175,
            },
            promptLength: { min: 1, max: 4000 },
        });
        expect(model?.durationSeconds).toBeUndefined();
        expect(model?.dimensions).toBeUndefined();
        expect(await videoDriver.list()).toContain(`google:google/${MODEL}`);
    });

    it('reports one cost line per usage type it records', () => {
        expect(
            videoDriver
                .getReportedCosts()
                .filter((c) => c.source === `driver:aiVideo/${PROVIDER}`),
        ).toEqual([
            {
                usageType: `${PROVIDER}:${MODEL}:input`,
                costValue: 0.00015,
                source: `driver:aiVideo/${PROVIDER}`,
            },
            {
                usageType: `${PROVIDER}:${MODEL}:output:text`,
                costValue: 0.0009,
                source: `driver:aiVideo/${PROVIDER}`,
            },
            {
                usageType: `${PROVIDER}:${MODEL}:output:video`,
                costValue: 0.00175,
                source: `driver:aiVideo/${PROVIDER}`,
            },
        ]);
    });

    it('registers the gemini-video-generation driver alias', () => {
        expect(videoDriver.driverAliases).toContain(PROVIDER);
    });
});

describe('GeminiVideoProvider routing', () => {
    // Gemini refuses `seconds` even in test mode, so that rejection proves a
    // call reached it rather than Together.
    const reachesGemini = (call: Promise<unknown>) =>
        expect(call).rejects.toMatchObject({
            statusCode: 400,
            message: 'seconds is not supported by Gemini Omni',
        });

    it.each([
        MODEL,
        `google:google/${MODEL}`,
        `google/${MODEL}`,
        ` ${MODEL.toUpperCase()} `,
    ])('routes model %s to Gemini', async (model) => {
        await reachesGemini(testMode({ model, seconds: 5 }));
    });

    it.each(['provider', 'driver'] as const)(
        'rejects a Together model when Gemini is pinned by %s',
        async (selection) => {
            const model = (await videoDriver.models()).find(
                (entry) => entry.provider === 'together-video-generation',
            )!.id;
            await expect(Promise.resolve(runWithContext({
                actor: TEST_MODE_ACTOR,
                ...(selection === 'driver' ? { driverName: PROVIDER } : {}),
            }, () => videoDriver.generate({
                prompt: PROMPT,
                model,
                test_mode: true,
                ...(selection === 'provider' ? { provider: PROVIDER } : {}),
            })))).rejects.toMatchObject({
                statusCode: 400,
                message: `Model not found: ${model}`,
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it('allows an unpinned Together model when Gemini is configured', async () => {
        const model = (await videoDriver.models()).find(
            (entry) => entry.provider === 'together-video-generation',
        )!.id;
        await expect(withActor(TEST_MODE_ACTOR, () => videoDriver.generate({
            prompt: PROMPT, model, test_mode: true,
        }))).resolves.toBe(SAMPLE_URL);
    });

    it('keeps Together as the default when both are configured', async () => {
        await expect(
            Promise.resolve(
                runWithContext({ actor: TEST_MODE_ACTOR }, () =>
                    videoDriver.generate({
                        prompt: PROMPT,
                        seconds: 5,
                        test_mode: true,
                    }),
                ),
            ),
        ).resolves.toBe(SAMPLE_URL);
    });

    it('routes the gemini-video-generation driver name and provider to Gemini Omni', async () => {
        const call = (args: Record<string, unknown>, driverName?: string) =>
            Promise.resolve(
                runWithContext(
                    {
                        actor: TEST_MODE_ACTOR,
                        ...(driverName ? { driverName } : {}),
                    },
                    () =>
                        videoDriver.generate({
                            prompt: PROMPT,
                            test_mode: true,
                            ...args,
                        } as IGenerateVideoParams),
                ),
            );
        await reachesGemini(call({ seconds: 5 }, PROVIDER));
        await reachesGemini(call({ seconds: 5, provider: PROVIDER }));
        expect(await call({}, PROVIDER)).toBe(SAMPLE_URL);
    });
});

describe('GeminiVideoProvider registration', () => {
    it('is not registered without a gemini key', async () => {
        const bare = await setupTestServer({
            providers: { 'together-video-generation': { apiKey: 'tg-key' } },
        } as never);
        try {
            const driver = bare.drivers.aiVideo as unknown as VideoGenerationDriver;
            expect(
                (await driver.models()).some((m) => m.provider === PROVIDER),
            ).toBe(false);
            await expect(withActor(TEST_MODE_ACTOR, () => driver.generate({
                prompt: PROMPT, provider: PROVIDER,
            }))).rejects.toMatchObject({ statusCode: 400 });
            await expect(Promise.resolve(runWithContext({
                actor: TEST_MODE_ACTOR, driverName: PROVIDER,
            }, () => driver.generate({ prompt: PROMPT })))).rejects.toMatchObject({
                statusCode: 400,
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            await bare.shutdown();
        }
    });

    it('is not registered for a custom Gemini endpoint, so its key never reaches Google', async () => {
        const custom = await setupTestServer({
            providers: {
                gemini: {
                    apiKey: 'proxy-test-key',
                    apiBaseUrl: 'https://proxy.example/v1',
                },
                'together-video-generation': { apiKey: 'tg-key' },
            },
        } as never);
        try {
            const driver = custom.drivers.aiVideo as unknown as VideoGenerationDriver;
            expect(
                (await driver.models()).some((m) => m.provider === PROVIDER),
            ).toBe(false);
            await expect(withActor(TEST_MODE_ACTOR, () => driver.generate({
                prompt: PROMPT, provider: PROVIDER,
            }))).rejects.toMatchObject({ statusCode: 400 });
            await expect(Promise.resolve(runWithContext({
                actor: TEST_MODE_ACTOR, driverName: PROVIDER,
            }, () => driver.generate({ prompt: PROMPT })))).rejects.toMatchObject({
                statusCode: 400,
            });
            expect(fetchSpy).not.toHaveBeenCalled();
            await expect(
                withActor(TEST_MODE_ACTOR, () =>
                    driver.generate({ prompt: PROMPT, model: MODEL }),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                message: `Model not found: ${MODEL}`,
            });
            await expect(Promise.resolve(runWithContext({
                actor: TEST_MODE_ACTOR, driverName: PROVIDER,
            }, () => driver.generate({ prompt: PROMPT })))).rejects.toMatchObject({
                statusCode: 400,
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            await custom.shutdown();
        }
    });
});

// -- test_mode --

describe('GeminiVideoProvider test_mode', () => {
    it('returns the sample clip without network, credits or metering', async () => {
        expect(await testMode()).toBe(SAMPLE_URL);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('validates an image input shape without loading it', async () => {
        expect(await testMode({ input_reference: pngDataUri })).toBe(
            SAMPLE_URL,
        );
        expect(secureFetchMock).not.toHaveBeenCalled();
        await expect(
            testMode({ input_reference: 42 }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// -- Option validation --

describe('GeminiVideoProvider option validation', () => {
    it.each([
        ['seconds', 8],
        ['seconds', '8'],
        ['duration', 8],
        ['fps', 24],
        ['steps', 20],
        ['guidance_scale', 7],
        ['seed', 1],
        ['negative_prompt', 'blur'],
        ['output_quality', 90],
        ['generate_audio', false],
        ['generate_audio', true],
        ['frame_images', [{ input_image: pngDataUri, frame: 0 }]],
        ['last_frame', pngDataUri],
        ['reference_images', [pngDataUri]],
        ['reference_images', []],
        ['metadata', { a: 1 }],
    ])('refuses %s=%j, test mode included', async (key, value) => {
        const { actor } = await makeUser();
        for (const test_mode of [true, false]) {
            await expect(
                withActor(actor, () => generate({ [key]: value, test_mode })),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
                message: `${key} is not supported by Gemini Omni`,
            });
        }
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts output_format video/mp4 and refuses any other', async () => {
        expect(await testMode({ output_format: 'video/mp4' })).toBe(SAMPLE_URL);
        for (const output_format of ['mp4', 'MP4', 'video/webm']) {
            await expect(testMode({ output_format })).rejects.toMatchObject({
                statusCode: 400,
                message: 'output_format must be video/mp4',
            });
        }
    });

    it('accepts a 4,000-character prompt and refuses a longer one', async () => {
        expect(await testMode({ prompt: 'a'.repeat(4000) })).toBe(SAMPLE_URL);
        await expect(
            testMode({ prompt: 'a'.repeat(4001) }),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'prompt must be at most 4000 characters',
        });
    });

    it.each([
        ['an unpublished resolution', { size: '480p' }],
        ['an unpublished pixel size', { size: '1024x576' }],
        ['a square size', { size: '720x720' }],
        ['a size with spaces', { size: '1280 x 720' }],
        ['a non-string size', { size: 720 }],
        ['an empty resolution', { resolution: ' ' }],
        ['conflicting size and resolution', { size: '720p', resolution: '1080p' }],
        ['width without height', { width: 1280 }],
        ['height without width', { height: 720 }],
        ['an unpublished width and height', { width: 1000, height: 500 }],
        ['string width and height', { width: '1280', height: '720' }],
        ['width and height against a pixel size', { size: '1280x720', width: 1920, height: 1080 }],
        ['width and height against a resolution', { size: '720p', width: 640, height: 360 }],
        ['a flipped width and height', { size: '1280x720', width: 720, height: 1280 }],
    ])('refuses %s, test mode included', async (_label, args) => {
        await expect(testMode(args)).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Request shape --

describe('GeminiVideoProvider request shape', () => {
    it('counts tokens, then sends an unstored unary 720p 16:9 interaction', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () => generate());

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const count = sent(0);
        expect(count.url).toBe(COUNT_TOKENS_URL);
        expect(count.method).toBe('POST');
        expect(count.headers).toEqual({
            'x-goog-api-key': 'gemini-test-key',
            'Content-Type': 'application/json',
        });
        expect(count.body).toEqual({
            contents: [{ parts: [{ text: PROMPT }] }],
        });

        const request = sent(1);
        expect(request.url).toBe(INTERACTIONS_URL);
        expect(request.headers['x-goog-api-key']).toBe('gemini-test-key');
        expect(request.body).toEqual({
            model: MODEL,
            input: PROMPT,
            response_format: {
                type: 'video',
                resolution: '720p',
                aspect_ratio: '16:9',
            },
            generation_config: { max_output_tokens: 65536 },
            store: false,
            background: false,
            stream: false,
        });
    });

    it.each([
        [{ size: '360x640' }, '360p', '9:16'],
        [{ size: '640x360' }, '360p', '16:9'],
        [{ resolution: '360p' }, '360p', '16:9'],
        [{ size: '720x1280' }, '720p', '9:16'],
        [{ size: '1080P' }, '1080p', '16:9'],
        [{ size: '1080x1920' }, '1080p', '9:16'],
        [{ size: '4K' }, '4k', '16:9'],
        [{ size: '2160x3840' }, '4k', '9:16'],
        [{ width: 360, height: 640 }, '360p', '9:16'],
        [{ size: '720p', width: 720, height: 1280 }, '720p', '9:16'],
        [{ size: '1920x1080', resolution: '1920X1080' }, '1080p', '16:9'],
    ])(
        'sends %j as %s at %s, untouched by the driver',
        async (args, resolution, aspectRatio) => {
            const { actor } = await makeUser();
            reply();
            await withActor(actor, () => generate(args));
            expect(sent(1).body.response_format).toEqual({
                type: 'video',
                resolution,
                aspect_ratio: aspectRatio,
            });
        },
    );

    it('sends a data URI image first, with the image-to-video task', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () =>
            generate({ input_reference: pngDataUri, size: '360x640' }),
        );
        expect(sent(0).body).toEqual({
            contents: [
                {
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'image/png',
                                data: PNG_BASE64,
                            },
                        },
                        { text: PROMPT },
                    ],
                },
            ],
        });
        expect(sent(1).body).toMatchObject({
            input: [
                { type: 'image', mime_type: 'image/png', data: PNG_BASE64 },
                { type: 'text', text: PROMPT },
            ],
            generation_config: {
                max_output_tokens: 65536,
                video_config: { task: 'image_to_video' },
            },
        });
    });

    it('takes raw base64 and an image URL', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () => generate({ input_reference: PNG_BASE64 }));
        expect(sent(1).body.input[0]).toEqual({
            type: 'image',
            mime_type: 'image/png',
            data: PNG_BASE64,
        });

        secureFetchMock.mockResolvedValueOnce(
            new Response(PNG, { headers: { 'content-type': 'image/png' } }),
        );
        reply();
        await withActor(actor, () =>
            generate({ input_reference: 'https://example.com/frame.png' }),
        );
        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://example.com/frame.png',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(sent(3).body.input[0].data).toBe(PNG_BASE64);
    });

    it("reads the caller's own Puter file", async () => {
        const { actor, userId } = await makeUser();
        const path = `/${actor.user.username}/frame.png`;
        await server.services.fs.write(userId, {
            fileMetadata: { path, size: PNG.byteLength, contentType: 'image/png' },
            fileContent: PNG,
        });
        reply();
        await withActor(actor, () => generate({ input_reference: path }));
        expect(sent(1).body.input[0].data).toBe(PNG_BASE64);
    });

    it("refuses another user's Puter file before calling Gemini", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const path = `/${owner.actor.user.username}/private.png`;
        await server.services.fs.write(owner.userId, {
            fileMetadata: { path, size: PNG.byteLength, contentType: 'image/png' },
            fileContent: PNG,
        });
        const err = await withActor(intruder.actor, () =>
            generate({ input_reference: path }),
        ).then(
            () => null,
            (e: unknown) => e,
        );
        expect([403, 404]).toContain(
            (err as { statusCode?: number } | null)?.statusCode,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses an image over 5 MiB with 413 before any call', async () => {
        const { actor } = await makeUser();
        const big = Buffer.alloc(GEMINI_OMNI_MAX_IMAGE_BYTES + 1);
        PNG.copy(big);
        await expect(
            withActor(actor, () =>
                generate({
                    input_reference: `data:image/png;base64,${big.toString('base64')}`,
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'input_too_large',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['text bytes', `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`],
        ['a GIF', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
    ])('refuses %s as the image', async (_label, input_reference) => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => generate({ input_reference })),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'input_reference must be a PNG, JPEG or WebP image',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('bounds countTokens at 30 seconds and the generation at 10 minutes', async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () => generate());
        expect(timeoutSpy).toHaveBeenCalledWith(30_000);
        expect(timeoutSpy).toHaveBeenCalledWith(600_000);
    });
});

// -- Response --

describe('GeminiVideoProvider response', () => {
    it('returns the MP4 as a data URI', async () => {
        const { actor } = await makeUser();
        reply();
        expect(await withActor(actor, () => generate())).toBe(
            `data:video/mp4;base64,${MP4.toString('base64')}`,
        );
    });

    it('returns the last video and ignores thought and text blocks', async () => {
        const { actor } = await makeUser();
        const last = Buffer.concat([MP4, Buffer.from('-last')]);
        reply(
            interaction({
                steps: [
                    { type: 'thought', content: [videoBlock(Buffer.from('x'))] },
                    {
                        type: 'model_output',
                        content: [
                            videoBlock(),
                            { type: 'text', text: 'Here is your clip.' },
                            videoBlock(last),
                        ],
                    },
                ],
            }),
        );
        expect(await withActor(actor, () => generate())).toBe(
            `data:video/mp4;base64,${last.toString('base64')}`,
        );
    });

    it('saves the clip to puter_output_path', async () => {
        const { actor } = await makeUser();
        const path = `/${actor.user.username}/omni.mp4`;
        reply();
        await withActor(actor, () => generate({ puter_output_path: path }));
        const saved = await withActor(actor, () =>
            loadFileInput(server.stores, server.services.fs, actor, path),
        );
        expect(saved.buffer.equals(MP4)).toBe(true);
        expect(saved.mimeType).toBe('video/mp4');
    });

    it('fails a reply with no video as 400 upstream_bad_request without charging', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        reply(interaction({ content: [{ type: 'text', text: 'No.' }] }));
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['a non-MP4 MIME type', { ...videoBlock(), mime_type: 'video/webm' }],
        ['a URI instead of bytes', { type: 'video', mime_type: 'video/mp4', uri: 'https://example.com/v.mp4' }],
        ['invalid base64', { type: 'video', mime_type: 'video/mp4', data: 'not base64!' }],
        ['bytes that are not an MP4', videoBlock(Buffer.from('plain bytes!'))],
    ])('fails a video with %s as 502 without charging', async (_label, block) => {
        const { actor } = await makeUser();
        reply(interaction({ content: [block] }));
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 502,
            message: 'Gemini video generation returned a malformed video',
        });
        expect(batchSpy).not.toHaveBeenCalled();
        expect(secureFetchMock).not.toHaveBeenCalled();
    });

    it.each(['incomplete', 'failed', 'cancelled', 'in_progress'])(
        'fails a %s interaction as 502 without charging',
        async (status) => {
            const { actor } = await makeUser();
            const { released } = trackHolds();
            reply(interaction({ status }));
            expect(await callerError(() => generate(), actor)).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
            });
            expect(released).toHaveBeenCalledTimes(1);
            expect(batchSpy).not.toHaveBeenCalled();
        },
    );

    it('stops reading a reply over 64 MiB', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 18 }))
            .mockResolvedValueOnce(
                oversizedBody(GEMINI_OMNI_MAX_RESPONSE_BYTES),
            );
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
            message: `Gemini video generation response exceeds ${64 * 1024 * 1024} bytes`,
        });
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it.each([
        [400, 400, 'upstream_bad_request'],
        [401, 500, 'upstream_auth_failed'],
        [429, 429, 'upstream_rate_limited'],
        [503, 400, 'upstream_provider_unavailable'],
    ])(
        'maps an upstream %i to %i %s and releases the hold',
        async (upstreamStatus, statusCode, legacyCode) => {
            const { actor } = await makeUser();
            const { released } = trackHolds();
            fetchSpy
                .mockResolvedValueOnce(Response.json({ totalTokens: 18 }))
                .mockResolvedValueOnce(
                    Response.json(
                        { error: { code: upstreamStatus, message: 'Failed' } },
                        { status: upstreamStatus },
                    ),
                );
            expect(await callerError(() => generate(), actor)).toMatchObject({
                statusCode,
                legacyCode,
                fields: { provider: 'gemini', upstreamStatus },
            });
            expect(released).toHaveBeenCalledTimes(1);
            expect(batchSpy).not.toHaveBeenCalled();
        },
    );

    it('surfaces a generation timeout as 504 and releases the hold', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 18 }))
            .mockRejectedValueOnce(
                new DOMException(
                    'The operation was aborted due to timeout',
                    'TimeoutError',
                ),
            );
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('aborts the generation when the caller disconnects, and releases the hold', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        const abort = new AbortController();
        let upstreamSignal: AbortSignal | undefined;
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 18 }))
            .mockImplementationOnce(
                (_url, init) =>
                    new Promise((_resolve, reject) => {
                        upstreamSignal = init!.signal!;
                        upstreamSignal.addEventListener(
                            'abort',
                            () => reject(upstreamSignal!.reason),
                            { once: true },
                        );
                        abort.abort();
                    }),
            );

        await expect(
            withActor(actor, () => {
                Context.set('abortSignal', abort.signal);
                return generate();
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(upstreamSignal?.aborted).toBe(true);
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });
});

// -- countTokens preflight --

describe('GeminiVideoProvider countTokens preflight', () => {
    it.each([
        ['a missing count', {}],
        ['a zero count', { totalTokens: 0 }],
        ['a negative count', { totalTokens: -1 }],
        ['a fractional count', { totalTokens: 1.5 }],
        ['a string count', { totalTokens: '18' }],
        ['an unsafe count', { totalTokens: Number.MAX_SAFE_INTEGER + 1 }],
    ])(
        'fails %s as 502 before holding credit or generating',
        async (_label, count) => {
            const { actor } = await makeUser();
            const { held } = trackHolds();
            fetchSpy.mockResolvedValueOnce(Response.json(count));
            expect(await callerError(() => generate(), actor)).toMatchObject({
                statusCode: 502,
                message: 'Gemini token count returned an unusable count',
            });
            expect(held).toEqual([]);
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        },
    );

    it('refuses input over 131,072 tokens before holding credit', async () => {
        const { actor } = await makeUser();
        const { held } = trackHolds();
        fetchSpy.mockResolvedValueOnce(Response.json({ totalTokens: 131_073 }));
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            code: 'input_too_large',
        });
        expect(held).toEqual([]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('accepts input of exactly 131,072 tokens and holds for it', async () => {
        const { actor } = await makeUser();
        const { held } = trackHolds();
        reply(interaction(), { totalTokens: 131_072 });
        await withActor(actor, () => generate());
        expect(held[0]?.amount).toBe(holdFor(131_072));
    });

    it('stops reading a countTokens reply over 64 KiB', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            oversizedBody(GEMINI_OMNI_COUNT_TOKENS_MAX_RESPONSE_BYTES),
        );
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 502,
            message: `Gemini token count response exceeds ${64 * 1024} bytes`,
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('surfaces a countTokens timeout as 504', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockRejectedValueOnce(
            new DOMException(
                'The operation was aborted due to timeout',
                'TimeoutError',
            ),
        );
        expect(await callerError(() => generate(), actor)).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// -- Credit hold --

describe('GeminiVideoProvider credit hold', () => {
    it('throws 402 after counting tokens, before generating', async () => {
        const { actor } = await makeUser();
        hasCreditsSpy.mockResolvedValueOnce(false);
        fetchSpy.mockResolvedValueOnce(Response.json({ totalTokens: 18 }));
        await expect(
            withActor(actor, () => generate()),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(HOLD);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('holds input plus the output and thinking allowances for 11 minutes', async () => {
        const { actor } = await makeUser();
        const { held } = trackHolds();
        let heldDuringCall = -1;
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 18 }))
            .mockImplementationOnce(async () => {
                heldDuringCall = await server.stores.creditHold.outstanding(
                    actor.user.uuid,
                );
                return Response.json(interaction());
            });

        await withActor(actor, () => generate());

        // Input plus verified 4K video usage and a separate text allowance.
        expect(HOLD).toBe(363_065_100);
        expect(held).toEqual([{ amount: HOLD, ttlMs: 11 * 60 * 1000 }]);
        expect(heldDuringCall).toBe(HOLD);
        await vi.waitFor(async () =>
            expect(
                await server.stores.creditHold.outstanding(actor.user.uuid),
            ).toBe(0),
        );
    });

    it('records usage before releasing the hold', async () => {
        const { actor } = await makeUser();
        const order: string[] = [];
        trackHolds(order);
        batchSpy.mockRestore();
        const metering = server.services.metering;
        const realBatch = metering.batchIncrementUsages.bind(metering);
        vi.spyOn(metering, 'batchIncrementUsages').mockImplementation(
            async (...args) => {
                const result = await realBatch(...args);
                order.push('recorded');
                return result;
            },
        );
        reply();
        await withActor(actor, () => generate());
        expect(order).toEqual(['recorded', 'release']);
    });
});

// -- Usage settlement --

describe('GeminiVideoProvider usage', () => {
    it('charges the observed 720p usage: input, video, and other output plus thinking as text', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () => generate());
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(metered()).toEqual([
            {
                usageType: `${PROVIDER}:${MODEL}:input`,
                usageAmount: 18,
                costOverride: 18 * INPUT_RATE,
            },
            {
                usageType: `${PROVIDER}:${MODEL}:output:video`,
                usageAmount: 57920,
                costOverride: 57920 * VIDEO_RATE,
            },
            {
                usageType: `${PROVIDER}:${MODEL}:output:text`,
                usageAmount: 58539 - 57920 + 418,
                costOverride: (58539 - 57920 + 418) * TEXT_RATE,
            },
        ]);
    });

    it('settles verified 4K usage beyond the requested output cap', async () => {
        const { actor } = await makeUser();
        reply(interaction({ usage: {
            total_input_tokens: 14,
            total_output_tokens: 174289,
            output_tokens_by_modality: [{ modality: 'video', tokens: 173760 }],
            total_thought_tokens: 175,
        } }));
        await withActor(actor, () => generate({ size: '4k' }));
        expect(metered().map((u) => [u.usageAmount, u.costOverride])).toEqual([
            [14, 14 * INPUT_RATE],
            [173760, 173760 * VIDEO_RATE],
            [704, 704 * TEXT_RATE],
        ]);
    });

    it('charges image and text input at one rate, and settles above the estimated reservation', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                usage: {
                    total_input_tokens: 1107,
                    input_tokens_by_modality: USAGE_360P_IMAGE.input_tokens_by_modality,
                    total_output_tokens: 301_000,
                    output_tokens_by_modality: [
                        { modality: 'video', tokens: 300_000 },
                    ],
                    total_thought_tokens: 548,
                },
            }),
        );
        await withActor(actor, () =>
            generate({ input_reference: pngDataUri, size: '360x640' }),
        );
        expect(metered().map((u) => [u.usageAmount, u.costOverride])).toEqual([
            [1107, 1107 * INPUT_RATE],
            [300_000, 300_000 * VIDEO_RATE],
            [1548, 1548 * TEXT_RATE],
        ]);
    });

    it('charges the observed 360p image-to-video usage', async () => {
        const { actor } = await makeUser();
        reply(interaction({ usage: USAGE_360P_IMAGE }));
        await withActor(actor, () =>
            generate({ input_reference: pngDataUri, size: '360x640' }),
        );
        expect(metered().map((u) => u.usageAmount)).toEqual([
            1107, 19310, 19960 - 19310 + 220,
        ]);
    });

    it('sums video across modality entries and treats missing thinking as none', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                usage: {
                    total_input_tokens: 18,
                    total_output_tokens: 1000,
                    output_tokens_by_modality: [
                        { modality: 'VIDEO', tokens: 600 },
                        { modality: 'video', tokens: 300 },
                        { modality: 'audio', tokens: 40 },
                    ],
                },
            }),
        );
        await withActor(actor, () => generate());
        expect(metered().map((u) => u.usageAmount)).toEqual([18, 900, 100]);
    });

    it('leaves out a text line when all output is video and there is no thinking', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                usage: {
                    total_input_tokens: 18,
                    total_output_tokens: 900,
                    output_tokens_by_modality: [
                        { modality: 'video', tokens: 900 },
                    ],
                    total_thought_tokens: 0,
                },
            }),
        );
        await withActor(actor, () => generate());
        expect(metered().map((u) => u.usageType)).toEqual([
            `${PROVIDER}:${MODEL}:input`,
            `${PROVIDER}:${MODEL}:output:video`,
        ]);
    });

    it.each([
        ['missing usage', undefined],
        ['null usage', null],
        [
            'no output modality breakdown',
            { ...USAGE_720P, output_tokens_by_modality: undefined },
        ],
        [
            'no video modality',
            {
                ...USAGE_720P,
                output_tokens_by_modality: [{ modality: 'text', tokens: 10 }],
            },
        ],
        ['a missing input total', { ...USAGE_720P, total_input_tokens: undefined }],
        ['a missing output total', { ...USAGE_720P, total_output_tokens: undefined }],
        [
            'a negative video count',
            {
                ...USAGE_720P,
                output_tokens_by_modality: [{ modality: 'video', tokens: -1 }],
            },
        ],
        [
            'a fractional video count',
            {
                ...USAGE_720P,
                output_tokens_by_modality: [{ modality: 'video', tokens: 1.5 }],
            },
        ],
        [
            'a string video count',
            {
                ...USAGE_720P,
                output_tokens_by_modality: [{ modality: 'video', tokens: '57920' }],
            },
        ],
        ['video over the output total', { ...USAGE_720P, total_output_tokens: 57919 }],
        [
            'modalities that sum past the output total',
            {
                ...USAGE_720P,
                output_tokens_by_modality: [
                    { modality: 'video', tokens: 57920 },
                    { modality: 'text', tokens: 620 },
                ],
            },
        ],
        ['a negative thinking count', { ...USAGE_720P, total_thought_tokens: -1 }],
        ['a string input count', { ...USAGE_720P, total_input_tokens: '18' }],
        [
            'an unsafe cost',
            {
                ...USAGE_720P,
                total_output_tokens: Number.MAX_SAFE_INTEGER,
                output_tokens_by_modality: [
                    { modality: 'video', tokens: Number.MAX_SAFE_INTEGER },
                ],
            },
        ],
        [
            'an overflowing modality sum',
            {
                ...USAGE_720P,
                total_output_tokens: Number.MAX_SAFE_INTEGER,
                output_tokens_by_modality: [
                    { modality: 'video', tokens: Number.MAX_SAFE_INTEGER },
                    { modality: 'video', tokens: Number.MAX_SAFE_INTEGER },
                ],
            },
        ],
    ])(
        'fails %s as 502 without fabricating usage',
        async (_label, usage) => {
            const { actor } = await makeUser();
            const { released } = trackHolds();
            reply(interaction({ usage }));
            expect(await callerError(() => generate(), actor)).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
                message: 'Gemini video generation returned unusable usage',
            });
            expect(batchSpy).not.toHaveBeenCalled();
            expect(released).toHaveBeenCalledTimes(1);
        },
    );
});
