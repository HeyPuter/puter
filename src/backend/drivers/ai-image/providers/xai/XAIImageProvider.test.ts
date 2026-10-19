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
 * Offline unit tests for XAIImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs XAIImageProvider directly against the live wired `MeteringService`
 * so the recording side is exercised end-to-end. xAI's image API is
 * OpenAI-compatible so the OpenAI SDK is mocked at the module boundary; that's
 * the real network egress point.
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
import { SYSTEM_ACTOR, makeActor } from '../../../../core/actor.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import {
    expectedIdentifierFields,
    makeActorMatrix,
    sentIdentifierFields,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { withAiCostFactor } from '../../../util/aiCostFactor.js';
import { CATALOG_TTL_MS } from '../../../ai-chat/utils/cachedRemoteCatalog.js';
import liveCatalog from './fixtures/image-generation-models.json';
import { XAI_IMAGE_GENERATION_MODELS } from './models.js';
import { XAIImageProvider } from './XAIImageProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { generateMock, postMock, openAICtor, axiosGetMock } = vi.hoisted(() => ({
    generateMock: vi.fn(),
    postMock: vi.fn(),
    openAICtor: vi.fn(),
    axiosGetMock: vi.fn(),
}));

// The pricing catalog is the provider's other network egress point.
vi.mock('axios', () => ({ default: { get: axiosGetMock } }));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.images = { generate: generateMock };
        // Low-level post() is how the provider reaches xAI's JSON edit endpoint.
        this.post = postMock;
        // Some sibling providers boot through the same SDK module.
        this.chat = { completions: { create: vi.fn() } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let batchIncrementUsagesSpy: MockInstance<
    MeteringService['batchIncrementUsages']
>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

/** Metering as the driver hands it to its providers. */
const aiMetering = () =>
    withAiCostFactor(
        server.services.metering,
        server.clients.event,
        'ai-image',
    );

const makeProvider = () =>
    new XAIImageProvider({ apiKey: 'test-key' }, aiMetering());

beforeEach(() => {
    generateMock.mockReset();
    postMock.mockReset();
    openAICtor.mockReset();
    axiosGetMock.mockReset();
    axiosGetMock.mockRejectedValue(new Error('Catalog unavailable'));
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    batchIncrementUsagesSpy = vi.spyOn(
        server.services.metering,
        'batchIncrementUsages',
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('XAIImageProvider construction', () => {
    it('points the OpenAI SDK at the xAI base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://api.x.ai/v1',
        });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () => new XAIImageProvider({ apiKey: '' }, aiMetering()),
        ).toThrow(/API key/i);
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('XAIImageProvider model catalog', () => {
    it('returns grok-imagine-image as the default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('grok-imagine-image');
    });

    it('serves the curated catalog verbatim when pricing is unavailable', async () => {
        const provider = makeProvider();
        expect(await provider.models()).toBe(XAI_IMAGE_GENERATION_MODELS);
    });

    it('no longer exposes the deprecated grok-2-image model', async () => {
        const provider = makeProvider();
        expect(
            (await provider.models()).some((m) => m.id === 'grok-2-image'),
        ).toBe(false);
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('XAIImageProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({
                prompt: 'something',
                test_mode: true,
            }),
        );

        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('XAIImageProvider.generate user identifier', () => {
    it.each([
        { app: undefined, expected: 'puter-u42' },
        { app: { uid: 'app-123' }, expected: 'puter-u42-app-123' },
    ])('sends $expected to xAI', async ({ app, expected }) => {
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://x.ai/img/1' }],
        });
        await withTestActor(
            () => makeProvider().generate({ prompt: 'a tiny red dot' }),
            makeActor({
                user: { id: 42, uuid: 'u42', username: 'alice' },
                app,
            }),
        );
        expect(generateMock.mock.calls[0]![0].user).toBe(expected);
    });
});

describe('XAIImageProvider.generate argument validation', () => {
    it('throws 400 when prompt is missing or non-string', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: undefined as unknown as string }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        await expect(
            withTestActor(() => provider.generate({ prompt: '   ' })),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('XAIImageProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting xAI when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() =>
                provider.generate({ prompt: 'a tiny red dot' }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        expect(generateMock).not.toHaveBeenCalled();
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });

    const perImage =
        XAI_IMAGE_GENERATION_MODELS[0].costs['output:1k'] * 1_000_000;
    const holdUser = (name: string) =>
        makeActor({
            user: {
                id: 51,
                uuid: `xai-${name}-${Math.random().toString(36).slice(2)}`,
                username: name,
            },
        });

    // Usage lands only once a generation finishes, so a request that starts
    // meanwhile has to see the first one's cost already committed.
    it('refuses a concurrent generation the balance only covers once', async () => {
        const provider = makeProvider();
        const actor = holdUser('concurrent');
        const metering = server.services.metering;
        const remaining = await metering.getRemainingUsage(actor);
        await metering.incrementUsage(
            actor,
            'test:prior-spend',
            1,
            remaining - perImage * 1.5,
        );

        let finishFirst: () => void = () => {};
        generateMock
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishFirst = () =>
                            resolve({ data: [{ url: 'https://x.ai/img/1' }] });
                    }),
            )
            .mockResolvedValue({ data: [{ url: 'https://x.ai/img/2' }] });
        const first = withTestActor(
            () => provider.generate({ prompt: 'first' }),
            actor,
        );
        await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));

        await expect(
            withTestActor(() => provider.generate({ prompt: 'second' }), actor),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateMock).toHaveBeenCalledTimes(1);

        finishFirst();
        expect(await first).toBe('https://x.ai/img/1');
        // The hold stays until the usage write lands.
        await vi.waitFor(async () =>
            expect(
                await server.stores.creditHold.outstanding(actor.user!.uuid),
            ).toBe(0),
        );
    });

    it('holds at the model cost factor', async () => {
        const provider = makeProvider();
        const actor = holdUser('factor');
        const asked: string[] = [];
        const doubled = (key: string, event: { factor: number }) => {
            asked.push(key);
            event.factor = 2;
        };
        let heldDuringCall = -1;
        generateMock.mockImplementationOnce(async () => {
            heldDuringCall = await server.stores.creditHold.outstanding(
                actor.user!.uuid,
            );
            return { data: [{ url: 'https://x.ai/img/1' }] };
        });

        server.clients.event.on('ai.cost.factor.*', doubled);
        try {
            await withTestActor(
                () => provider.generate({ prompt: 'hi' }),
                actor,
            );
        } finally {
            server.clients.event.off('ai.cost.factor.*', doubled);
        }

        expect(asked).toContain(
            'ai.cost.factor.ai-image.xai:grok-imagine-image',
        );
        expect(heldDuringCall).toBe(perImage * 2);
    });

    it('releases the hold when xAI fails', async () => {
        const provider = makeProvider();
        const actor = holdUser('fail');
        generateMock.mockRejectedValueOnce(new Error('upstream down'));

        await expect(
            withTestActor(() => provider.generate({ prompt: 'hi' }), actor),
        ).rejects.toThrow('upstream down');
        expect(
            await server.stores.creditHold.outstanding(actor.user!.uuid),
        ).toBe(0);
    });
});

// ── Model resolution ────────────────────────────────────────────────

describe('XAIImageProvider.generate model resolution', () => {
    const sampleResponse = { data: [{ url: 'https://x.ai/img/1' }] };

    it('falls back to the default model when given an unknown id', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'totally-not-a-real-model',
                prompt: 'hi',
            }),
        );

        expect(generateMock.mock.calls[0]![0].model).toBe('grok-imagine-image');
    });

    it('resolves an alias to its canonical id', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(sampleResponse);

        await withTestActor(() =>
            provider.generate({
                // grok-image is an alias of grok-imagine-image.
                model: 'grok-image',
                prompt: 'hi',
            }),
        );

        expect(generateMock.mock.calls[0]![0].model).toBe('grok-imagine-image');
    });
});

// ── Successful generation ───────────────────────────────────────────

describe('XAIImageProvider.generate success path', () => {
    it('returns the URL from response.data[0].url and meters one image at the 1k output rate', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://x.ai/img/abc' }],
        });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'a small red dot',
            }),
        );

        expect(result).toBe('https://x.ai/img/abc');
        // No input images → generate endpoint, not the edit endpoint.
        expect(postMock).not.toHaveBeenCalled();

        const grok = XAI_IMAGE_GENERATION_MODELS.find(
            (m) => m.id === 'grok-imagine-image',
        )!;
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        expect(entries).toHaveLength(1);
        const out = (
            entries as Array<{ usageType: string; costOverride: number }>
        )[0];
        expect(out.usageType).toBe('xai:grok-imagine-image:output:1k');
        expect(out.costOverride).toBe(grok.costs['output:1k'] * 1_000_000);
    });

    it('sends the actor uuid and effective app uid as the user field', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValue({
            data: [{ url: 'https://x.ai/img/abc' }],
        });

        for (const actor of makeActorMatrix()) {
            await withTestActor(
                () =>
                    provider.generate({
                        model: 'grok-imagine-image',
                        prompt: 'a small red dot',
                    }),
                actor,
            );
        }

        const fields = ['user'];
        expect(sentIdentifierFields(generateMock.mock.calls, fields)).toEqual(
            expectedIdentifierFields(fields),
        );
    });

    it('uses the 2k output rate when quality is "2k"', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://x.ai/img/2k' }],
        });

        await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'hi',
                quality: '2k',
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.resolution).toBe('2k');
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        expect((entries as Array<{ usageType: string }>)[0].usageType).toBe(
            'xai:grok-imagine-image:output:2k',
        );
    });

    it('falls back to a base64 data URL when response carries b64_json', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({
            data: [{ b64_json: 'AAAA' }],
        });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'a small red dot',
            }),
        );

        expect(result).toBe('data:image/png;base64,AAAA');
    });

    it('throws when the SDK returns no usable image data', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({ data: [{}] });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'grok-imagine-image',
                    prompt: 'a small red dot',
                }),
            ),
        ).rejects.toThrow(/Failed to extract image URL/);

        // Failure path must NOT meter usage.
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});

// ── Image-to-image editing (input_images) ───────────────────────────

describe('XAIImageProvider.generate input_images (edit endpoint)', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const editResponse = { data: [{ url: 'https://x.ai/img/edited' }] };

    it('routes input_images to POST /v1/images/edits (not generate) with a single image object', async () => {
        const provider = makeProvider();
        postMock.mockResolvedValueOnce(editResponse);

        const result = await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'add a hat',
                input_images: [PNG],
            }),
        );

        expect(result).toBe('https://x.ai/img/edited');
        expect(generateMock).not.toHaveBeenCalled();
        expect(postMock).toHaveBeenCalledTimes(1);
        const [path, opts] = postMock.mock.calls[0]!;
        expect(path).toBe('/images/edits');
        const body = (opts as { body: Record<string, unknown> }).body;
        expect(body.model).toBe('grok-imagine-image');
        // Single image → object, not an array.
        expect(body.image).toEqual({ type: 'image_url', url: PNG });
    });

    it('sends the actor user identifier on the edit request like generation does', async () => {
        const provider = makeProvider();
        postMock.mockResolvedValueOnce(editResponse);

        await withTestActor(
            () =>
                provider.generate({
                    model: 'grok-imagine-image',
                    prompt: 'add a hat',
                    input_images: [PNG],
                }),
            makeActorMatrix()[1],
        );

        const body = (
            postMock.mock.calls[0]![1] as { body: Record<string, unknown> }
        ).body;
        expect(body.user).toBe('puter-u42-app-abc');
    });

    it('sends an array of image objects for multi-image edits with all five references', async () => {
        const provider = makeProvider();
        postMock.mockResolvedValueOnce(editResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'merge them',
                input_images: [PNG, PNG, PNG, PNG, PNG],
            }),
        );
        const body = (
            postMock.mock.calls[0]![1] as { body: Record<string, unknown> }
        ).body;
        expect(Array.isArray(body.image)).toBe(true);
        expect(body.image).toHaveLength(5);
    });

    it('meters output + media_input per input image on edits', async () => {
        const provider = makeProvider();
        postMock.mockResolvedValueOnce(editResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'add a hat',
                input_images: [PNG, PNG],
            }),
        );

        const grok = XAI_IMAGE_GENERATION_MODELS.find(
            (m) => m.id === 'grok-imagine-image',
        )!;
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const types = (entries as Array<{ usageType: string }>).map(
            (e) => e.usageType,
        );
        expect(types).toEqual(
            expect.arrayContaining([
                'xai:grok-imagine-image:output:1k',
                'xai:grok-imagine-image:media_input',
            ]),
        );
        const media = (
            entries as Array<{
                usageType: string;
                usageAmount: number;
                costOverride: number;
            }>
        ).find((e) => e.usageType.endsWith(':media_input'))!;
        expect(media.usageAmount).toBe(2);
        expect(media.costOverride).toBe(grok.costs.media_input * 2 * 1_000_000);
    });

    it('folds singular input_image into the edit path', async () => {
        const provider = makeProvider();
        postMock.mockResolvedValueOnce(editResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'grok-imagine-image',
                prompt: 'add a hat',
                input_image: PNG,
            }),
        );

        expect(postMock).toHaveBeenCalledTimes(1);
        const body = (
            postMock.mock.calls[0]![1] as { body: Record<string, unknown> }
        ).body;
        expect(body.image).toEqual({ type: 'image_url', url: PNG });
    });
});

describe('XAIImageProvider quality and reference limits', () => {
    it.each([
        ['1k', 'low', 4],
        ['2k', 'low', 6],
        ['1k', 'medium', 6],
        ['2k', 'medium', 8],
    ])(
        'sends and meters v2 resolution %s with quality %s',
        async (resolution, quality, cents) => {
            generateMock.mockResolvedValueOnce({
                data: [{ url: 'https://x.ai/image.png' }],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    prompt: 'a landscape',
                    model: 'grok-imagine-image-2.0',
                    resolution: String(resolution),
                    quality: String(quality),
                }),
            );
            expect(generateMock).toHaveBeenCalledWith(
                expect.objectContaining({ resolution, quality }),
            );
            expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual([
                expect.objectContaining({
                    costOverride: Number(cents) * 1_000_000,
                }),
            ]);
        },
    );

    it.each(['Medium', ' MEDIUM '])(
        'accepts v2 quality casing %s without lowering quality',
        async (quality) => {
            generateMock.mockResolvedValueOnce({
                data: [{ url: 'https://x.ai/image.png' }],
            });
            await withTestActor(() =>
                makeProvider().generate({
                    model: 'grok-imagine-image-2.0',
                    prompt: 'hi',
                    quality,
                }),
            );
            expect(generateMock.mock.calls[0][0].quality).toBe('medium');
            expect(
                batchIncrementUsagesSpy.mock.calls[0][1][0].costOverride,
            ).toBe(6_000_000);
        },
    );

    it.each([
        'grok-imagine-image-quality',
        'x-ai/grok-imagine-image-quality',
        'grok-imagine-image-quality-20260403',
        'grok-imagine-image-quality-latest',
        'grok-imagine-image-pro',
    ])('drops the retired %s instead of redirecting it', async (model) => {
        const names = (await makeProvider().models()).flatMap((m) => [
            m.id,
            ...(m.aliases ?? []),
        ]);
        expect(names).not.toContain(model);
    });

    it('resolves v2 auto quality to medium for edits', async () => {
        postMock.mockResolvedValueOnce({
            data: [{ url: 'https://x.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'a landscape',
                model: 'grok-imagine-image-2.0',
                input_images: ['https://example.com/input.png'],
                quality: 'auto',
            }),
        );
        expect(postMock).toHaveBeenCalledWith('/images/edits', {
            body: expect.objectContaining({
                quality: 'medium',
                resolution: '1k',
            }),
        });
        expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual([
            expect.objectContaining({ costOverride: 6_000_000 }),
            expect.objectContaining({
                costOverride: 1_000_000,
                usageAmount: 1,
            }),
        ]);
    });

    it('rejects six references before spending credits', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: 'a landscape',
                    input_images: Array(6).fill(
                        'https://example.com/input.png',
                    ),
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(postMock).not.toHaveBeenCalled();
    });
});

describe('generated image MIME labels', () => {
    it('labels JPEG bytes from a base64 response as JPEG', async () => {
        const base64 = '/9j/4AAQSkZJRgABAQ';
        generateMock.mockResolvedValueOnce({ data: [{ b64_json: base64 }] });
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi' }),
        );
        expect(result).toBe(`data:image/jpeg;base64,${base64}`);
    });
});

describe('xAI option validation', () => {
    it.each([
        { quality: 42 },
        { quality: {} },
        { resolution: 2048 },
        { resolution: [] },
    ])('rejects malformed options %j before charging', async (options) => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({ prompt: 'hi', ...options } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
    });
});

it.each([
    { app: undefined, expected: 'puter-u42' },
    { app: { uid: 'app-123' }, expected: 'puter-u42-app-123' },
])(
    'includes the user identifier $expected on xAI edits',
    async ({ app, expected }) => {
        postMock.mockResolvedValueOnce({
            data: [{ url: 'https://example.com/out.jpg' }],
        });
        await withTestActor(
            () =>
                makeProvider().generate({ prompt: 'hi', input_image: 'AQID' }),
            makeActor({
                user: { id: 42, uuid: 'u42', username: 'alice' },
                app,
            }),
        );
        expect(postMock).toHaveBeenCalledWith('/images/edits', {
            body: expect.objectContaining({
                user: expected,
                image: { type: 'image_url', url: 'data:image/png;base64,AQID' },
            }),
        });
    },
);

// ── Live pricing catalog ────────────────────────────────────────────

describe('XAIImageProvider live pricing', () => {
    type Tier = {
        quality: string;
        resolution: string;
        price_per_image: unknown;
    };
    type LiveModel = {
        id: string;
        image_price?: unknown;
        pricing?: unknown;
        aliases?: string[];
    };

    /**
     * The sanitized live response with the 2.0 matrix (and anything else)
     * swapped in.
     */
    const catalogWith = (
        pricing: unknown,
        extra: Partial<LiveModel> = {},
    ): { models: LiveModel[] } => ({
        models: liveCatalog.models.map((model) =>
            model.id === 'grok-imagine-image-2.0'
                ? { ...model, pricing, ...extra }
                : model,
        ),
    });
    /** A full 2.0 matrix in cents, in xAI's 1e-8 cent units. */
    const matrix = (cents: Record<string, number>): Tier[] =>
        Object.entries(cents).map(([tier, value]) => {
            const [quality, resolution] = tier.split(' ');
            return {
                quality,
                resolution,
                price_per_image: value * 100_000_000,
            };
        });
    const repriced = matrix({
        'low 1k': 4.5,
        'low 1.5k': 5.5,
        'low 2k': 6.5,
        'medium 1k': 7,
        'medium 1.5k': 8,
        'medium 2k': 9,
    });
    const v2Costs = async (provider: XAIImageProvider) =>
        (await provider.models()).find(
            (m) => m.id === 'grok-imagine-image-2.0',
        )!.costs;
    const curated = (id: string) =>
        XAI_IMAGE_GENERATION_MODELS.find((m) => m.id === id)!;
    const serve = (body: unknown) =>
        axiosGetMock.mockResolvedValueOnce({ data: body });
    const expire = () => vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
    const pricedActor = () =>
        makeActor({
            user: {
                id: 52,
                uuid: `xai-live-${Math.random().toString(36).slice(2)}`,
                username: 'live',
            },
        });

    it('fetches the image model list with the provider key under a size cap', async () => {
        serve(liveCatalog);
        await makeProvider().models();
        expect(axiosGetMock).toHaveBeenCalledWith(
            'https://api.x.ai/v1/image-generation-models',
            expect.objectContaining({
                headers: { Authorization: 'Bearer test-key' },
                signal: expect.any(AbortSignal),
                maxContentLength: 1024 * 1024,
            }),
        );
    });

    it('converts the live matrix from 1e-8 cent units, keeping curated input and v1 rates', async () => {
        serve(liveCatalog);
        const models = await makeProvider().models();
        expect(
            models.find((m) => m.id === 'grok-imagine-image-2.0')!.costs,
        ).toEqual({
            'output:1k:low': 4,
            'output:2k:low': 6,
            'output:1k:medium': 6,
            'output:2k:medium': 8,
            media_input: 1,
        });
        // No matrix for v1: its curated rates, ids, aliases and options stay.
        expect(models.find((m) => m.id === 'grok-imagine-image')).toBe(
            curated('grok-imagine-image'),
        );
        expect(models.map((m) => m.id)).toEqual(
            XAI_IMAGE_GENERATION_MODELS.map((m) => m.id),
        );
    });

    it('reprices only the 2.0 output tiers, preserving everything else', async () => {
        serve(catalogWith(repriced));
        const v2 = (await makeProvider().models()).find(
            (m) => m.id === 'grok-imagine-image-2.0',
        )!;
        const { costs, ...rest } = curated('grok-imagine-image-2.0');
        expect(v2).toEqual({
            ...rest,
            costs: {
                'output:1k:low': 4.5,
                'output:2k:low': 6.5,
                'output:1k:medium': 7,
                'output:2k:medium': 9,
                media_input: costs.media_input,
            },
        });
    });

    it.each([
        ['1k', 'low', 4.5],
        ['2k', 'low', 6.5],
        ['1k', 'medium', 7],
        ['2k', 'medium', 9],
        ['1k', 'auto', 4.5],
        ['2k', undefined, 6.5],
    ])(
        'holds and meters the live %s/%s rate',
        async (resolution, quality, cents) => {
            serve(catalogWith(repriced));
            const provider = makeProvider();
            await provider.models();
            const actor = pricedActor();
            let held = -1;
            generateMock.mockImplementationOnce(async () => {
                held = await server.stores.creditHold.outstanding(
                    actor.user!.uuid,
                );
                return { data: [{ url: 'https://x.ai/image.png' }] };
            });

            await withTestActor(
                () =>
                    provider.generate({
                        model: 'grok-imagine-image-2.0',
                        prompt: 'a landscape',
                        resolution,
                        quality,
                    }),
                actor,
            );

            const expectedQuality =
                quality === 'auto' || !quality ? 'low' : quality;
            expect(generateMock.mock.calls[0][0]).toMatchObject({
                resolution,
                quality: expectedQuality,
            });
            expect(held).toBe(cents * 1_000_000);
            expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual([
                {
                    usageType: `xai:grok-imagine-image-2.0:output:${resolution}:${expectedQuality}`,
                    usageAmount: 1,
                    costOverride: cents * 1_000_000,
                },
            ]);
        },
    );

    it('bills edits at the live output rate plus the curated input rate', async () => {
        serve(catalogWith(repriced));
        const provider = makeProvider();
        await provider.models();
        const actor = pricedActor();
        let held = -1;
        postMock.mockImplementationOnce(async () => {
            held = await server.stores.creditHold.outstanding(actor.user!.uuid);
            return { data: [{ url: 'https://x.ai/image.png' }] };
        });

        await withTestActor(
            () =>
                provider.generate({
                    model: 'grok-imagine-image-2.0',
                    prompt: 'add a hat',
                    input_images: [
                        'https://example.com/a.png',
                        'https://example.com/b.png',
                    ],
                    quality: 'auto',
                }),
            actor,
        );

        const media = curated('grok-imagine-image-2.0').costs.media_input;
        expect(held).toBe((7 + media * 2) * 1_000_000);
        expect(batchIncrementUsagesSpy.mock.calls[0][1]).toEqual([
            {
                usageType: 'xai:grok-imagine-image-2.0:output:1k:medium',
                usageAmount: 1,
                costOverride: 7_000_000,
            },
            {
                usageType: 'xai:grok-imagine-image-2.0:media_input',
                usageAmount: 2,
                costOverride: media * 2 * 1_000_000,
            },
        ]);
    });

    it('never bills from image_price', async () => {
        serve({
            models: liveCatalog.models.map(({ pricing: _, ...model }) => ({
                ...model,
                image_price: 999_999_999,
            })),
        });
        expect(await makeProvider().models()).toEqual(
            XAI_IMAGE_GENERATION_MODELS,
        );
    });

    it('accepts a zero price and identical duplicate tiers', async () => {
        serve(
            catalogWith([
                ...matrix({ 'low 1k': 0, 'low 2k': 6, 'medium 1k': 6 }),
                ...matrix({ 'medium 2k': 8, 'low 1k': 0 }),
            ]),
        );
        expect(await v2Costs(makeProvider())).toEqual({
            ...curated('grok-imagine-image-2.0').costs,
            'output:1k:low': 0,
        });
    });

    const tier = (
        price_per_image: unknown,
        quality = 'low',
        resolution = '1k',
    ) => ({
        quality,
        resolution,
        price_per_image,
    });
    const withLow1k = (bad: unknown) => [
        bad,
        ...repriced.filter(
            (entry) => !(entry.quality === 'low' && entry.resolution === '1k'),
        ),
    ];
    it.each([
        ['a string price', withLow1k(tier('400000000'))],
        ['a negative price', withLow1k(tier(-1))],
        ['a fractional price', withLow1k(tier(400000000.5))],
        ['an unsafe integer price', withLow1k(tier(2 ** 53))],
        ['a missing price', withLow1k({ quality: 'low', resolution: '1k' })],
        ['an unknown quality', [...repriced, tier(1, 'ultra')]],
        ['a malformed resolution', [...repriced, tier(1, 'low', '1024x1024')]],
        ['a non-object tier', [...repriced, null]],
        [
            'a missing billed tier',
            repriced.filter((t) => t.resolution !== '2k'),
        ],
        ['a conflicting duplicate tier', [...repriced, tier(1)]],
        ['a non-array matrix', { 'low 1k': 400000000 }],
    ])('keeps the previous 2.0 rates on %s', async (_label, pricing) => {
        serve(catalogWith(pricing));
        expect(await v2Costs(makeProvider())).toEqual(
            curated('grok-imagine-image-2.0').costs,
        );
    });

    it('ignores records that only share an alias or repeat the model id', async () => {
        serve({
            models: [
                ...liveCatalog.models.filter(
                    (m) => m.id !== 'grok-imagine-image-2.0',
                ),
                {
                    id: 'x-ai/grok-imagine-image-2.0',
                    aliases: ['grok-imagine-image-2.0'],
                    pricing: repriced,
                },
            ],
        });
        expect(await v2Costs(makeProvider())).toEqual(
            curated('grok-imagine-image-2.0').costs,
        );

        serve({
            models: [
                ...liveCatalog.models,
                { id: 'grok-imagine-image-2.0', pricing: repriced },
            ],
        });
        expect(await v2Costs(makeProvider())).toEqual(
            curated('grok-imagine-image-2.0').costs,
        );
    });

    it('keeps the last good rates through failures, empty lists and omissions', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const provider = makeProvider();
        serve(catalogWith(repriced));
        const good = await v2Costs(provider);
        expect(good['output:1k:low']).toBe(4.5);

        for (const next of [
            () => axiosGetMock.mockRejectedValueOnce(new Error('down')),
            () => serve({ models: [] }),
            () => serve({ data: liveCatalog.models }),
            () => serve('<html>'),
            () =>
                serve({
                    models: liveCatalog.models.filter(
                        (m) => m.id !== 'grok-imagine-image-2.0',
                    ),
                }),
            () => serve(catalogWith([tier(-1)])),
        ]) {
            expire();
            const before = axiosGetMock.mock.calls.length;
            next();
            expect(await v2Costs(provider)).toEqual(good);
            expect(axiosGetMock.mock.calls.length).toBe(before + 1);
        }

        // A later valid matrix replaces it.
        expire();
        serve(liveCatalog);
        expect((await v2Costs(provider))['output:1k:low']).toBe(4);
    });

    it('bills a request at the rates captured when it started', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const provider = makeProvider();
        serve(catalogWith(repriced));
        await provider.models();
        let finish: () => void = () => {};
        generateMock.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () =>
                        resolve({ data: [{ url: 'https://x.ai/image.png' }] });
                }),
        );

        const pending = withTestActor(
            () =>
                provider.generate({
                    model: 'grok-imagine-image-2.0',
                    prompt: 'a landscape',
                    quality: 'medium',
                    resolution: '2k',
                }),
            pricedActor(),
        );
        await vi.waitFor(() => expect(generateMock).toHaveBeenCalled());
        expire();
        serve(liveCatalog);
        expect((await v2Costs(provider))['output:2k:medium']).toBe(8);
        finish();
        await pending;

        expect(batchIncrementUsagesSpy.mock.calls[0][1][0].costOverride).toBe(
            9_000_000,
        );
    });

    it('bills from the catalog last handed out, not a fetch of its own', async () => {
        serve(catalogWith(repriced));
        generateMock.mockResolvedValueOnce({
            data: [{ url: 'https://x.ai/image.png' }],
        });
        await withTestActor(() =>
            makeProvider().generate({
                model: 'grok-imagine-image-2.0',
                prompt: 'a landscape',
            }),
        );
        expect(axiosGetMock).not.toHaveBeenCalled();
        expect(batchIncrementUsagesSpy.mock.calls[0][1][0].costOverride).toBe(
            curated('grok-imagine-image-2.0').costs['output:1k:low'] *
                1_000_000,
        );
    });
});
