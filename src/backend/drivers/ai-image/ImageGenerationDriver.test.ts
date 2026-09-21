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
 * Offline unit tests for ImageGenerationDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) with
 * API keys for every image provider so the driver registers and indexes them
 * all. Then drives `server.drivers.aiImage` directly. Provider SDKs are mocked
 * at the module boundary so the driver routes are exercised without real
 * network egress. Aligns with AGENTS.md: "Prefer test server over mocking
 * deps."
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
import { setupTestServer } from '../../testUtil.js';
import { CLOUDFLARE_IMAGE_GENERATION_MODELS } from './providers/cloudflare/models.js';
import { GEMINI_IMAGE_GENERATION_MODELS } from './providers/gemini/models.js';
import { OPEN_AI_IMAGE_GENERATION_MODELS } from './providers/openai/models.js';
import { REPLICATE_IMAGE_GENERATION_MODELS } from './providers/replicate/models.js';
import { TOGETHER_IMAGE_GENERATION_MODELS } from './providers/together/models.js';
import { XAI_IMAGE_GENERATION_MODELS } from './providers/xai/models.js';
import { ImageGenerationDriver } from './ImageGenerationDriver.js';
import { ReplicateImageGenerationProvider } from './providers/replicate/ReplicateImageGenerationProvider.js';

// ── SDK mocks ──────────────────────────────────────────────────────
//
// These boot during PuterServer.start() since each provider's
// constructor instantiates the SDK. We don't drive the SDKs from the
// driver-level tests — what we care about is the driver's routing.
// Each `generate` mock resolves to a sentinel URL the test inspects.

const { openaiImagesGenerateMock, openaiImagesEditMock } = vi.hoisted(() => ({
    openaiImagesGenerateMock: vi.fn(),
    openaiImagesEditMock: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.images = {
            generate: openaiImagesGenerateMock,
            edit: openaiImagesEditMock,
        };
        // xAI provider reaches its JSON edit endpoint through the SDK's post().
        this.post = vi.fn();
        this.chat = { completions: { create: vi.fn() } };
        this.moderations = { create: vi.fn() };
        this.responses = { create: vi.fn() };
    });
    return {
        OpenAI: OpenAICtor,
        default: { OpenAI: OpenAICtor },
        toFile: vi.fn(async () => ({ __file: true })),
    };
});

const { googleAIGenerateContentMock, googleAIGenerateImagesMock } = vi.hoisted(
    () => ({
        googleAIGenerateContentMock: vi.fn(),
        googleAIGenerateImagesMock: vi.fn(),
    }),
);

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.models = {
            generateContent: googleAIGenerateContentMock,
            generateImages: googleAIGenerateImagesMock,
        };
    });
    return { GoogleGenAI };
});

const { togetherImagesGenerateMock } = vi.hoisted(() => ({
    togetherImagesGenerateMock: vi.fn(),
}));

vi.mock('together-ai', () => {
    const Together = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.images = { generate: togetherImagesGenerateMock };
        this.chat = { completions: { create: vi.fn() } };
        this.models = { list: vi.fn() };
    });
    return { Together, default: Together };
});

const { createPredictionMock } = vi.hoisted(() => ({
    createPredictionMock: vi.fn(),
}));

vi.mock('replicate', () => {
    const Replicate = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.predictions = { create: createPredictionMock, cancel: vi.fn() };
    });
    return { default: Replicate };
});

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));

vi.mock('../../util/secureHttp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util/secureHttp.js')>()),
    secureFetch: secureFetchMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: ImageGenerationDriver;
let fetchSpy: MockInstance<typeof fetch>;
let eventEmitSpy: MockInstance<(...args: unknown[]) => unknown>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'openai-image-generation': { apiKey: 'oai-key' },
            'gemini-image-generation': { apiKey: 'gem-key' },
            'together-image-generation': { apiKey: 'tg-key' },
            'cloudflare-image-generation': {
                apiToken: 'cf-token',
                accountId: 'acct',
            },
            'xai-image-generation': { apiKey: 'xai-key' },
            'replicate-image-generation': { apiKey: 'rp-key' },
        },
    } as never);
    driver = server.drivers.aiImage as unknown as ImageGenerationDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    openaiImagesGenerateMock.mockReset();
    openaiImagesEditMock.mockReset();
    googleAIGenerateContentMock.mockReset();
    googleAIGenerateImagesMock.mockReset();
    togetherImagesGenerateMock.mockReset();
    createPredictionMock.mockReset();
    secureFetchMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    eventEmitSpy = vi.spyOn(server.clients.event, 'emit') as MockInstance<
        (...args: unknown[]) => unknown
    >;
});

afterEach(() => {
    vi.restoreAllMocks();
});

const withActor = <T>(fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR }, fn));

const withDriverName = <T>(driverName: string, fn: () => T | Promise<T>) =>
    Promise.resolve(
        runWithContext({ actor: SYSTEM_ACTOR, driverName }, fn),
    );

// ── Authentication ──────────────────────────────────────────────────

describe('ImageGenerationDriver.generate authentication', () => {
    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('ImageGenerationDriver.generate argument validation', () => {
    it('throws 400 when given a model id that no registered provider knows', async () => {
        await expect(
            withActor(() =>
                driver.generate({
                    model: 'totally-not-a-real-model-anywhere',
                    prompt: 'hi',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Catalog & list ──────────────────────────────────────────────────

// Providers hand these catalogs to the driver by module-level reference, so
// #buildModelMap must never write through to them: an in-place id
// normalization or puterId append would accumulate across map builds. Cloned
// at import time, before beforeAll boots the server that builds the map.
// (Same regression as in ChatCompletionDriver.test.ts.)
const pristineCatalogs = structuredClone({
    CLOUDFLARE_IMAGE_GENERATION_MODELS,
    GEMINI_IMAGE_GENERATION_MODELS,
    OPEN_AI_IMAGE_GENERATION_MODELS,
    REPLICATE_IMAGE_GENERATION_MODELS,
    TOGETHER_IMAGE_GENERATION_MODELS,
    XAI_IMAGE_GENERATION_MODELS,
});

describe('ImageGenerationDriver model catalog', () => {
    it('does not mutate the catalog objects providers hand back', () => {
        expect({
            CLOUDFLARE_IMAGE_GENERATION_MODELS,
            GEMINI_IMAGE_GENERATION_MODELS,
            OPEN_AI_IMAGE_GENERATION_MODELS,
            REPLICATE_IMAGE_GENERATION_MODELS,
            TOGETHER_IMAGE_GENERATION_MODELS,
            XAI_IMAGE_GENERATION_MODELS,
        }).toEqual(pristineCatalogs);
    });

    it('models() returns a deduped list across providers, sorted by provider then id', async () => {
        const all = await driver.models();
        // Every catalog id from at least one provider must be reachable.
        const ids = all.map((m) => m.id);
        // OpenAI catalog: gpt-image-2 should be present.
        expect(ids).toContain('gpt-image-2');
        // xAI catalog: grok-imagine-image should be present.
        expect(ids).toContain('grok-imagine-image');
    });

    it('list() returns ids/puterIds sorted', async () => {
        const ids = await driver.list();
        const sorted = [...ids].sort();
        expect(ids).toEqual(sorted);
    });

    it('getReportedCosts emits per-cost-key line items namespaced by provider:model:costKey', () => {
        const reported = driver.getReportedCosts() as Array<{
            usageType: string;
            costValue: number;
            source: string;
        }>;
        // gpt-image-2 has a low:1024x1024 cost line — must surface in reportedCosts.
        const gptLine = reported.find(
            (r) =>
                r.usageType ===
                'openai-image-generation:gpt-image-2:low:1024x1024',
        );
        expect(gptLine).toBeDefined();
        expect(gptLine?.costValue).toBe(
            OPEN_AI_IMAGE_GENERATION_MODELS.find(
                (m) => m.id === 'gpt-image-2',
            )!.costs['low:1024x1024'],
        );
        expect(gptLine?.source).toBe('driver:aiImage/openai-image-generation');
    });
});

// ── Provider routing ────────────────────────────────────────────────

describe('image model data policy', () => {
    it('omits excluded routes from discovery and reported costs', async () => {
        expect((await driver.models()).some((model) => model.excludedForDataPolicy)).toBe(false);
        expect((await driver.list()).some((id) => id.startsWith('togetherai:'))).toBe(false);
        expect(driver.getReportedCosts().some((cost) =>
            String(cost.usageType).startsWith('together-image-generation:'),
        )).toBe(false);
    });

    it.each(TOGETHER_IMAGE_GENERATION_MODELS)(
        'blocks the excluded route $id and its aliases before calling the provider',
        async (model) => {
            for (const id of [model.id, ...(model.aliases ?? [])]) {
                await expect(withActor(() => driver.generate({
                    provider: 'together', model: id, prompt: 'hi', test_mode: true,
                }))).rejects.toMatchObject({
                    statusCode: 400,
                    message: expect.stringContaining('required third-party data sharing'),
                });
            }
            expect(togetherImagesGenerateMock).not.toHaveBeenCalled();
            expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
            expect(createPredictionMock).not.toHaveBeenCalled();
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it.each(['together', ' TOGETHER-IMAGE-GENERATION '])(
        'rejects the excluded default for provider %s', async (provider) => {
            await expect(withActor(() => driver.generate({
                provider, prompt: 'hi', test_mode: true,
            }))).rejects.toThrow('required third-party data sharing');
        },
    );

    it('rejects an excluded default selected through the legacy driver name', async () => {
        await expect(withDriverName('together-image-generation', () =>
            driver.generate({ prompt: 'hi', test_mode: true }),
        )).rejects.toThrow('required third-party data sharing');
    });

    it('keeps a shared alias available through an allowed route', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({ data: [{ url: 'https://oai/img.png' }] });
        await withActor(() => driver.generate({ model: 'gpt-image-2', prompt: 'hi' }));
        expect(openaiImagesGenerateMock).toHaveBeenCalledOnce();
        expect(togetherImagesGenerateMock).not.toHaveBeenCalled();
    });

    it('skips an excluded provider when choosing the deployment default', async () => {
        const limitedDriver = new ImageGenerationDriver({
            providers: {
                'together-image-generation': { apiKey: 'tg-key' },
                'cloudflare-image-generation': { apiToken: 'cf-token', accountId: 'acct' },
            },
        } as never, server.clients, server.stores, server.services);
        await limitedDriver.onServerStart();
        await withActor(() => limitedDriver.generate({ prompt: 'hi', test_mode: true }));
        expect(eventEmitSpy).toHaveBeenCalledWith('ai.log.image', expect.objectContaining({
            service_used: 'cloudflare-image-generation',
        }), {});
    });

    it('also blocks routes that train on customer content', async () => {
        const fixture = {
            ...OPEN_AI_IMAGE_GENERATION_MODELS[0],
            id: 'training-fixture',
            aliases: ['training-fixture-alias'],
            excludedForDataPolicy: 'training' as const,
        };
        OPEN_AI_IMAGE_GENERATION_MODELS.push(fixture);
        try {
            const isolatedDriver = new ImageGenerationDriver(
                { providers: { 'openai-image-generation': { apiKey: 'oai-key' } } } as never,
                server.clients, server.stores, server.services,
            );
            await isolatedDriver.onServerStart();
            await expect(withActor(() => isolatedDriver.generate({
                model: 'training-fixture-alias', prompt: 'hi', test_mode: true,
            }))).rejects.toThrow('training on customer content');
            expect(await isolatedDriver.list()).not.toContain('training-fixture');
            expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
        } finally {
            OPEN_AI_IMAGE_GENERATION_MODELS.pop();
        }
    });
});

describe('ImageGenerationDriver.generate provider routing', () => {
    it('uses the default provider when called through the main driver', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/default.png' }],
        });
        await withDriverName('ai-image', () =>
            driver.generate({ prompt: 'a landscape' }),
        );
        expect(openaiImagesGenerateMock).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-image-2' }),
        );
    });

    it('rejects an excluded model regardless of caller casing', async () => {
        await expect(withActor(() =>
            driver.generate({
                model: 'togetherai:qwen/qwen-image',
                prompt: 'a landscape',
            }),
        )).rejects.toThrow('required third-party data sharing');
        expect(togetherImagesGenerateMock).not.toHaveBeenCalled();
    });

    it.each(['openai', 'gemini', 'cloudflare', 'xai', 'replicate'])(
        'resolves the short provider name %s with its default model',
        async (provider) => {
            await withDriverName('ai-image', () =>
                driver.generate({
                    provider,
                    prompt: 'a landscape',
                    test_mode: true,
                }),
            );
            expect(eventEmitSpy).toHaveBeenCalledWith(
                'ai.log.image',
                expect.objectContaining({
                    service_used: `${provider}-image-generation`,
                }),
                {},
            );
        },
    );

    it('keeps legacy driver hints as preferences for a known model', async () => {
        openaiImagesGenerateMock.mockResolvedValue({
            data: [{ url: 'https://xai/image.png' }],
        });
        await withDriverName('openai-image-generation', () =>
            driver.generate({ model: 'grok-imagine-image', prompt: 'hi' }),
        );
        expect(openaiImagesGenerateMock.mock.calls[0][0].model).toBe(
            'grok-imagine-image',
        );
    });

    it.each(['AI-Image', ' ai-image '])(
        'normalizes the generic provider hint %s',
        async (provider) => {
            await withActor(() =>
                driver.generate({ provider, prompt: 'hi', test_mode: true }),
            );
            expect(eventEmitSpy).toHaveBeenCalledWith(
                'ai.log.image',
                expect.objectContaining({
                    service_used: 'openai-image-generation',
                }),
                {},
            );
        },
    );

    it('falls back to a known model when the provider preference does not offer it', async () => {
        await withActor(() =>
            driver.generate({
                provider: 'gemini',
                model: 'gpt-image-2',
                prompt: 'hi',
                test_mode: true,
            }),
        );
        expect(eventEmitSpy).toHaveBeenCalledWith(
            'ai.log.image',
            expect.objectContaining({
                service_used: 'openai-image-generation',
            }),
            {},
        );
    });

    it.each([
        'black-forest-labs/FLUX.1-schnell',
        'FLUX.1-schnell',
        'togetherai:black-forest-labs/FLUX.1-schnell',
    ])(
        'does not redirect the retired Together alias %s to another provider',
        async (model) => {
            await expect(
                withActor(() =>
                    driver.generate({ model, prompt: 'hi', test_mode: true }),
                ),
            ).rejects.toThrow(
                'no longer available through together-image-generation',
            );
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it('does not let a provider hint resurrect a retired alias', async () => {
        await expect(
            withActor(() =>
                driver.generate({
                    provider: 'cloudflare',
                    model: 'black-forest-labs/FLUX.1-schnell',
                    prompt: 'hi',
                    test_mode: true,
                }),
            ),
        ).rejects.toThrow('no longer available through together-image-generation');
        expect(eventEmitSpy).not.toHaveBeenCalledWith(
            'ai.log.image',
            expect.anything(),
            expect.anything(),
        );
    });

    it('does not redirect unavailable Replicate Phoenix callers to another provider', async () => {
        await expect(withActor(() => driver.generate({
            model: 'phoenix-1.0', provider: 'cloudflare', prompt: 'hi', test_mode: true,
        }))).rejects.toThrow('no longer available through replicate-image-generation');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each(['gpt-image-1', 'gpt-image-1-mini', 'GPT-Image-1.5'])(
        'keeps the deprecated OpenAI id %s routable until its shutdown date',
        async (model) => {
            openaiImagesGenerateMock.mockResolvedValueOnce({ data: [{ url: 'https://oai/img.png' }] });
            await withActor(() => driver.generate({ model, prompt: 'hi' }));
            expect(openaiImagesGenerateMock).toHaveBeenCalledOnce();
            expect(openaiImagesGenerateMock.mock.calls[0]![0].model).toBe(model.toLowerCase());
        },
    );

    it('hides delisted models from discovery but still reports their costs', async () => {
        const listed = await driver.list();
        const ids = (await driver.models()).map((m) => m.id);
        for (const id of ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5']) {
            expect(ids).not.toContain(id);
            expect(listed).not.toContain(`openai:openai/${id}`);
        }
        expect(driver.getReportedCosts().some((cost) =>
            String(cost.usageType).startsWith('openai-image-generation:gpt-image-1-mini:'),
        )).toBe(true);
    });

    it('reports an id Puter never offered as not found', async () => {
        await expect(withActor(() => driver.generate({
            model: 'chatgpt-image-latest', prompt: 'hi', test_mode: true,
        }))).rejects.toThrow('Model not found: chatgpt-image-latest');
    });

    it.each(['openai/gpt-image-2', 'openai/gpt-image-1.5'])(
        'routes the vendor-prefixed id %s to OpenAI unless Replicate is asked for',
        async (model) => {
            eventEmitSpy.mockClear();
            await withActor(() => driver.generate({ model, prompt: 'hi', test_mode: true }));
            expect(eventEmitSpy).toHaveBeenCalledWith('ai.log.image', expect.objectContaining({
                service_used: 'openai-image-generation',
            }), {});
            for (const pinned of [{ model, provider: 'replicate' }, { model: `replicate:${model}` }]) {
                eventEmitSpy.mockClear();
                await withActor(() => driver.generate({ ...pinned, prompt: 'hi', test_mode: true }));
                expect(eventEmitSpy, JSON.stringify(pinned)).toHaveBeenCalledWith('ai.log.image', expect.objectContaining({
                    service_used: 'replicate-image-generation',
                }), {});
            }
        },
    );

    it('explains why an unavailable Replicate model is refused', async () => {
        await expect(withActor(() => driver.generate({
            model: 'quiverai/arrow-1.1', prompt: 'hi', test_mode: true,
        }))).rejects.toThrow('Replicate generation fails even with the minimal input schema.');
    });

    it('names a retired provider default instead of "undefined"', async () => {
        const schnell = REPLICATE_IMAGE_GENERATION_MODELS.find((m) => m.id === 'black-forest-labs/flux-schnell')!;
        REPLICATE_IMAGE_GENERATION_MODELS.push({ ...schnell, unavailableReason: 'fixture outage.' });
        const defaultSpy = vi.spyOn(ReplicateImageGenerationProvider.prototype, 'getDefaultModel')
            .mockReturnValue('Black-Forest-Labs/FLUX-Schnell');
        try {
            const isolatedDriver = new ImageGenerationDriver(
                { providers: { 'replicate-image-generation': { apiKey: 'rp-key' } } } as never,
                server.clients, server.stores, server.services,
            );
            await isolatedDriver.onServerStart();
            const error = await withActor(() => isolatedDriver.generate({
                provider: 'replicate', prompt: 'hi', test_mode: true,
            })).then(() => null, (e: Error) => e);
            expect(error?.message).toMatch(/flux-schnell is no longer available through replicate-image-generation; fixture outage\./i);
            expect(error?.message).not.toContain('undefined');
        } finally {
            defaultSpy.mockRestore();
            REPLICATE_IMAGE_GENERATION_MODELS.pop();
        }
    });

    it('omits the aliases key from catalog entries that declare none', async () => {
        const entries = await driver.models();
        const withoutAliases = entries.filter((m) => !Object.hasOwn(m, 'aliases'));
        expect(withoutAliases.length).toBeGreaterThan(0);
        for (const entry of entries) {
            if (Object.hasOwn(entry, 'aliases')) expect(Array.isArray(entry.aliases)).toBe(true);
        }
    });

    it('keeps Cloudflare Schnell reachable through its own id and puterId', async () => {
        for (const model of [
            '@cf/black-forest-labs/flux-1-schnell',
            'workers-ai:black-forest-labs/flux.1-schnell',
        ]) {
            eventEmitSpy.mockClear();
            await withActor(() =>
                driver.generate({ model, prompt: 'hi', test_mode: true }),
            );
            expect(eventEmitSpy, model).toHaveBeenCalledWith(
                'ai.log.image',
                expect.objectContaining({
                    service_used: 'cloudflare-image-generation',
                }),
                {},
            );
        }
    });

    it('never lists a retired alias on any provider entry', async () => {
        for (const model of await driver.models()) {
            for (const alias of model.aliases ?? []) {
                expect(alias.toLowerCase()).not.toBe(
                    'black-forest-labs/flux.1-schnell',
                );
            }
        }
    });

    it('keeps canonical and provider-prefixed model IDs independent from shared aliases', async () => {
        const catalogs = {
            'openai-image-generation': OPEN_AI_IMAGE_GENERATION_MODELS,
            'gemini-image-generation': GEMINI_IMAGE_GENERATION_MODELS,
            'together-image-generation': TOGETHER_IMAGE_GENERATION_MODELS.filter((model) => !model.excludedForDataPolicy),
            'cloudflare-image-generation': CLOUDFLARE_IMAGE_GENERATION_MODELS,
            'xai-image-generation': XAI_IMAGE_GENERATION_MODELS,
            'replicate-image-generation': REPLICATE_IMAGE_GENERATION_MODELS.filter((model) => !model.unavailableReason),
        };
        // A vendor's own spelling (`openai/x`) beats a reseller's exact id, so
        // Replicate's `openai/*` entries route to OpenAI without a hint.
        const firstParty = new Map(OPEN_AI_IMAGE_GENERATION_MODELS.map((model) => [
            model.puterId!.replace(/^[^:/]+:/, '').toLowerCase(),
            { model_used: model.id, service_used: 'openai-image-generation' },
        ]));
        for (const [provider, models] of Object.entries(catalogs)) {
            for (const model of models) {
                for (const id of new Set(
                    [model.id, model.puterId].filter(Boolean),
                )) {
                    eventEmitSpy.mockClear();
                    await withDriverName('ai-image', () =>
                        driver.generate({
                            model: id,
                            prompt: 'a landscape',
                            test_mode: true,
                        }),
                    );
                    expect(eventEmitSpy, id).toHaveBeenCalledWith(
                        'ai.log.image',
                        expect.objectContaining(
                            firstParty.get(id.toLowerCase()) ?? {
                                model_used: model.id,
                                service_used: provider,
                            },
                        ),
                        {},
                    );
                }
            }
        }
    });

    it('routes a known gpt-image-2 model id to the OpenAI image provider', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });

        const result = await withActor(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        );

        expect(result).toBe('https://oai/img.png');
        expect(openaiImagesGenerateMock).toHaveBeenCalledTimes(1);
        // Other provider mocks must NOT have been touched.
        expect(togetherImagesGenerateMock).not.toHaveBeenCalled();
        expect(createPredictionMock).not.toHaveBeenCalled();
    });

    it('routes a known grok-imagine-image id to the xAI image provider (also OpenAI-SDK shaped)', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://xai/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                model: 'grok-imagine-image',
                prompt: 'hi',
            } as never),
        );

        // xAI's provider also uses the OpenAI mock — assert via the call args.
        const sent = openaiImagesGenerateMock.mock.calls[0]![0];
        expect(sent.model).toBe('grok-imagine-image');
        expect(sent.prompt).toBe('hi');
    });

    it('lowercases model lookups so case variants resolve (GPT-Image-2 → gpt-image-2)', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                model: 'GPT-Image-2',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        );

        expect(openaiImagesGenerateMock).toHaveBeenCalledTimes(1);
    });

    it('falls through to the requested provider via Context.driverName when args.provider is not supplied', async () => {
        // We're not setting args.provider; Context.driverName takes its place.
        createPredictionMock.mockResolvedValueOnce({
            id: 'prediction-1',
            status: 'succeeded',
            output: ['https://rp/img.png'],
        });

        // Replicate's flux-schnell is the only registered model under id
        // `black-forest-labs/flux-schnell` matched solely by Replicate's catalog.
        const result = await withDriverName('replicate-image-generation', () =>
            driver.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
            } as never),
        );

        expect(result).toBe('https://rp/img.png');
        expect(createPredictionMock).toHaveBeenCalledTimes(1);
    });
});

// ── Ratio normalization ────────────────────────────────────────────

describe('ImageGenerationDriver.generate ratio normalization', () => {
    it('normalises explicit width/height into ratio (and clears the legacy keys)', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                width: 1024,
                height: 1536,
            } as never),
        );

        // Provider received a size derived from the ratio normalization.
        const sent = openaiImagesGenerateMock.mock.calls[0]![0];
        expect(sent.size).toBe('1024x1536');
    });

    it('parses aspect_ratio "w:h" into ratio when width/height are absent', async () => {
        googleAIGenerateContentMock.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ inlineData: {
                data: 'aW1n', mimeType: 'image/png',
            } }] } }],
        });

        await withActor(() =>
            driver.generate({
                provider: 'gemini',
                model: 'gemini-3-pro-image',
                prompt: 'hi',
                aspect_ratio: '16:9',
                quality: '1K',
            } as never),
        );

        const sent = googleAIGenerateContentMock.mock.calls[0]![0];
        expect(sent.config.imageConfig.aspectRatio).toBe('16:9');
    });
});

// ── Audit log ──────────────────────────────────────────────────────

describe('ImageGenerationDriver.generate audit log', () => {
    it('emits an ai.log.image event with actor, model, and resolved provider BEFORE the upstream call', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            } as never),
        );

        const aiLogCall = eventEmitSpy.mock.calls.find(
            ([eventName]) => eventName === 'ai.log.image',
        );
        expect(aiLogCall).toBeDefined();
        const [, payload] = aiLogCall!;
        const p = payload as Record<string, unknown>;
        expect(p.model_used).toBe('gpt-image-2');
        expect(p.service_used).toBe('openai-image-generation');
        // completionId is a fresh uuid-style string per call.
        expect(typeof p.completionId).toBe('string');
        expect((p.completionId as string).length).toBeGreaterThan(0);
    });

    it('still emits the audit log when the upstream provider call fails (logs precede the network round-trip)', async () => {
        const apiError = new Error('upstream blew up');
        openaiImagesGenerateMock.mockRejectedValueOnce(apiError);

        await expect(
            withActor(() =>
                driver.generate({
                    model: 'gpt-image-2',
                    prompt: 'hi',
                    ratio: { w: 1024, h: 1024 },
                } as never),
            ),
        ).rejects.toThrow();

        // Audit log fires before the throw.
        const aiLogCalls = eventEmitSpy.mock.calls.filter(
            ([eventName]) => eventName === 'ai.log.image',
        );
        expect(aiLogCalls.length).toBe(1);
    });
});

// ── puter_output_path ─────────────────────────────────────────────

describe('ImageGenerationDriver.generate puter_output_path', () => {
    const TEST_ACTOR: import('../../core/actor.js').Actor = {
        user: { uuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', id: 42, username: 'testuser' },
    };

    const withTestUser = <T>(fn: () => T | Promise<T>): Promise<T> =>
        Promise.resolve(runWithContext({ actor: TEST_ACTOR }, fn));

    it('throws 400 when puter_output_path resolves to root', async () => {
        await expect(
            withTestUser(() =>
                driver.generate({
                    model: 'gpt-image-2',
                    prompt: 'hi',
                    puter_output_path: '/',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when puter_output_path parent is root (e.g. /image.png)', async () => {
        await expect(
            withTestUser(() =>
                driver.generate({
                    model: 'gpt-image-2',
                    prompt: 'hi',
                    puter_output_path: '/image.png',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
    });

    it('throws 403 when ACL denies write access to the destination', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(false);

        await expect(
            withTestUser(() =>
                driver.generate({
                    model: 'gpt-image-2',
                    prompt: 'hi',
                    puter_output_path: '/testuser/somedir/image.png',
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });

        expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
    });

    it('ACL check runs BEFORE provider.generate so credits are not wasted on a denied path', async () => {
        const callOrder: string[] = [];
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockImplementation(async () => {
            callOrder.push('acl');
            return false;
        });
        openaiImagesGenerateMock.mockImplementation(async () => {
            callOrder.push('provider');
            return { data: [{ url: 'https://oai/img.png' }] };
        });

        await expect(
            withTestUser(() =>
                driver.generate({
                    model: 'gpt-image-2',
                    prompt: 'hi',
                    puter_output_path: '/testuser/dir/img.png',
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

        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });
        secureFetchMock.mockResolvedValueOnce(
            new Response(Buffer.from('fake-png'), {
                status: 200,
                headers: { 'content-type': 'image/png' },
            }),
        );

        await withTestUser(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                puter_output_path: '~/images/out.png',
            } as never),
        );

        expect(fsWriteSpy).toHaveBeenCalledTimes(1);
        const [, writeArg] = fsWriteSpy.mock.calls[0]!;
        expect(
            (writeArg as { fileMetadata: { path: string } }).fileMetadata.path,
        ).toBe('/testuser/images/out.png');
    });

    it('writes the generated image to FS and still returns the result URL', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(true);

        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        fsWriteSpy.mockResolvedValueOnce(undefined as never);

        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });
        secureFetchMock.mockResolvedValueOnce(
            new Response(Buffer.from('fake-png'), {
                status: 200,
                headers: { 'content-type': 'image/png' },
            }),
        );

        const result = await withTestUser(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                puter_output_path: '/testuser/photos/out.png',
            } as never),
        );

        expect(result).toBe('https://oai/img.png');
        expect(fsWriteSpy).toHaveBeenCalledTimes(1);
        const [userId, writeArg] = fsWriteSpy.mock.calls[0]!;
        expect(userId).toBe(42);
        const meta = (
            writeArg as {
                fileMetadata: {
                    path: string;
                    contentType: string;
                    overwrite: boolean;
                };
            }
        ).fileMetadata;
        expect(meta.path).toBe('/testuser/photos/out.png');
        expect(meta.contentType).toBe('image/png');
        expect(meta.overwrite).toBe(true);

        // The result URL is downloaded through the SSRF-guarded fetch, not
        // the unguarded global one — its body lands in the user's FS.
        expect(secureFetchMock).toHaveBeenCalledWith('https://oai/img.png', {
            skipProxy: true,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not forward puter_output_path to the upstream provider call', async () => {
        const aclCheckSpy = vi.spyOn(server.services.acl, 'check');
        aclCheckSpy.mockResolvedValueOnce(true);

        const fsWriteSpy = vi.spyOn(server.services.fs, 'write');
        fsWriteSpy.mockResolvedValueOnce(undefined as never);

        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });
        secureFetchMock.mockResolvedValueOnce(
            new Response(Buffer.from('fake-png'), {
                status: 200,
                headers: { 'content-type': 'image/png' },
            }),
        );

        await withTestUser(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                puter_output_path: '/testuser/dir/img.png',
            } as never),
        );

        const sent = openaiImagesGenerateMock.mock.calls[0]![0];
        expect(sent.puter_output_path).toBeUndefined();
    });

    it('throws 400 when actor has no user ID but puter_output_path is set', async () => {
        const noIdActor: import('../../core/actor.js').Actor = {
            user: { uuid: 'f0e1d2c3-b4a5-4968-8777-0a1b2c3d4e5f', username: 'noone' },
        };
        await expect(
            Promise.resolve(
                runWithContext({ actor: noIdActor }, () =>
                    driver.generate({
                        model: 'gpt-image-2',
                        prompt: 'hi',
                        puter_output_path: '/noone/dir/img.png',
                    } as never),
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
    });
});

describe('image dimension parsing at the driver boundary', () => {
    it.each([
        { w: 2048, h: 1024, kind: 'pixels' },
        { w: 'invalid', h: 1024, kind: 'pixels' },
    ])('ignores caller-supplied internal imageSize: %j', async (imageSize) => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });
        const args = {
            model: 'gpt-image-2',
            prompt: 'hi',
            imageSize,
        };
        const snapshot = structuredClone(args);
        await withActor(() => driver.generate(args as never));
        expect(openaiImagesGenerateMock).toHaveBeenCalledWith(
            expect.objectContaining({ size: '1024x1024' }),
        );
        expect(args).toEqual(snapshot);
        const logged = eventEmitSpy.mock.calls.find(
            (call) => call[0] === 'ai.log.image',
        )![1] as { parameters: Record<string, unknown> };
        expect(logged.parameters).not.toHaveProperty('imageSize');
    });

    it.each([
        { ratio: { w: 'invalid', h: 100 } },
        { ratio: { w: 0, h: 1 } },
        { quality: 42 },
        { resolution: [] },
        { width: 1024 },
    ])('rejects invalid options before a provider request: %j', (options) =>
        expect(
            withActor(() =>
                driver.generate({
                    model: 'grok-imagine-image',
                    prompt: 'hi',
                    ...options,
                } as never),
            ),
        ).rejects.toMatchObject({ statusCode: 400 }),
    );
});

it.each(['__proto__', 'constructor'])(
    'rejects inherited object keys as unknown models: %s',
    async (model) => {
        await expect(
            withActor(() =>
                driver.generate({ provider: 'openai', model, prompt: 'hi' }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message: `Model not found: ${model}`,
        });
        expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
    },
);

it('rejects an unavailable provider without a model before dispatch', async () => {
    await expect(
        withActor(() =>
            driver.generate({ provider: 'byteplus', prompt: 'hi' }),
        ),
    ).rejects.toMatchObject({
        statusCode: 400,
        legacyCode: 'bad_request',
        message: 'Image provider not available: byteplus',
    });
    expect(eventEmitSpy).not.toHaveBeenCalledWith(
        'ai.log.image',
        expect.anything(),
        expect.anything(),
    );
});

it('only advertises aliases that route to that entry without a provider hint', async () => {
    for (const model of await driver.models()) {
        for (const alias of model.aliases ?? []) {
            eventEmitSpy.mockClear();
            await expect(
                withActor(() =>
                    driver.generate({
                        model: alias,
                        prompt: 'hi',
                        test_mode: true,
                    }),
                ),
            ).resolves.toBe(
                'https://puter-sample-data.puter.site/image_example.png',
            );
            expect(eventEmitSpy, `${model.provider} ${alias}`).toHaveBeenCalledWith(
                'ai.log.image',
                expect.objectContaining({
                    model_used: model.id,
                    service_used: model.provider,
                }),
                {},
            );
        }
    }
});

it('lists a shared alias only on the provider that wins it', async () => {
    const owners = (await driver.models())
        .filter((model) => model.aliases?.includes('leonardo/lucid-origin'))
        .map((model) => model.provider);
    expect(owners).toEqual(['cloudflare-image-generation']);
});

it('rejects an excluded provider alias instead of falling back to another provider', async () => {
    await expect(withActor(() =>
        driver.generate({
            provider: 'together',
            model: 'gpt-image-2',
            prompt: 'hi',
        }),
    )).rejects.toThrow('required third-party data sharing');
    expect(togetherImagesGenerateMock).not.toHaveBeenCalled();
    expect(openaiImagesGenerateMock).not.toHaveBeenCalled();
});

it.each([
    { width: null, height: null },
    { aspect_ratio: null },
    { ratio: null, width: null, height: null, aspect_ratio: '' },
])('treats null dimension fields %j as absent', async (dimensions) => {
    await expect(
        withActor(() =>
            driver.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                test_mode: true,
                ...dimensions,
            } as never),
        ),
    ).resolves.toBe('https://puter-sample-data.puter.site/image_example.png');
});

it('leaves the caller args untouched and logs the normalized request', async () => {
    const args = {
        model: 'gpt-image-2',
        prompt: 'hi',
        width: 1024,
        height: 768,
        test_mode: true,
    };
    const snapshot = structuredClone(args);
    await withActor(() => driver.generate(args as never));
    expect(args).toEqual(snapshot);
    expect(eventEmitSpy).toHaveBeenCalledWith(
        'ai.log.image',
        expect.objectContaining({
            parameters: expect.objectContaining({
                model: 'gpt-image-2',
                provider: 'openai-image-generation',
                imageSize: { w: 1024, h: 768, kind: 'pixels' },
                ratio: { w: 1024, h: 768 },
            }),
        }),
        {},
    );
    const logged = eventEmitSpy.mock.calls.find(
        (call) => call[0] === 'ai.log.image',
    )![1] as { parameters: Record<string, unknown> };
    expect(logged.parameters).not.toHaveProperty('width');
    expect(logged.parameters).not.toHaveProperty('height');
});

it.each([undefined, null, '', '  ', 42, {}])(
    'rejects an invalid prompt %j before routing',
    async (prompt) => {
        await expect(
            withActor(() =>
                driver.generate({ prompt, model: 'no-such-model' } as never),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message: '`prompt` must be a non-empty string',
        });
    },
);
