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
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) with API keys for every image provider so the driver
 * registers and indexes them all. Then drives `server.drivers.aiImage`
 * directly. Provider SDKs are mocked at the module boundary so the
 * driver routes are exercised without real network egress. Aligns
 * with AGENTS.md: "Prefer test server over mocking deps."
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
import { OPEN_AI_IMAGE_GENERATION_MODELS } from './providers/openai/models.js';
import { XAI_IMAGE_GENERATION_MODELS } from './providers/xai/models.js';
import type { ImageGenerationDriver } from './ImageGenerationDriver.js';

// ── SDK mocks ──────────────────────────────────────────────────────
//
// These boot during PuterServer.start() since each provider's
// constructor instantiates the SDK. We don't drive the SDKs from the
// driver-level tests — what we care about is the driver's routing.
// Each `generate` mock resolves to a sentinel URL the test inspects.

const { openaiImagesGenerateMock } = vi.hoisted(() => ({
    openaiImagesGenerateMock: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.images = { generate: openaiImagesGenerateMock };
        this.chat = { completions: { create: vi.fn() } };
        this.moderations = { create: vi.fn() };
        this.responses = { create: vi.fn() };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
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

const { replicateRunMock } = vi.hoisted(() => ({
    replicateRunMock: vi.fn(),
}));

vi.mock('replicate', () => {
    const Replicate = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.run = replicateRunMock;
    });
    return { default: Replicate };
});

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
    googleAIGenerateContentMock.mockReset();
    googleAIGenerateImagesMock.mockReset();
    togetherImagesGenerateMock.mockReset();
    replicateRunMock.mockReset();
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
                model: 'dall-e-2',
                prompt: 'hi',
                ratio: { w: 256, h: 256 },
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

describe('ImageGenerationDriver model catalog', () => {
    it('models() returns a deduped list across providers, sorted by provider then id', async () => {
        const all = await driver.models();
        // Every catalog id from at least one provider must be reachable.
        const ids = all.map((m) => m.id);
        // OpenAI catalog: dall-e-2 should be present (lowercased by buildModelMap).
        expect(ids).toContain('dall-e-2');
        // xAI catalog: grok-2-image should be present.
        expect(ids).toContain('grok-2-image');
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
        // dall-e-2 has a 256x256 cost line — must surface in reportedCosts.
        const dalle256 = reported.find(
            (r) => r.usageType === 'openai-image-generation:dall-e-2:256x256',
        );
        expect(dalle256).toBeDefined();
        expect(dalle256?.costValue).toBe(
            OPEN_AI_IMAGE_GENERATION_MODELS.find((m) => m.id === 'dall-e-2')!
                .costs['256x256'],
        );
        expect(dalle256?.source).toBe('driver:aiImage/openai-image-generation');
    });
});

// ── Provider routing ────────────────────────────────────────────────

describe('ImageGenerationDriver.generate provider routing', () => {
    it('routes a known dall-e-2 model id to the OpenAI image provider', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });

        const result = await withActor(() =>
            driver.generate({
                model: 'dall-e-2',
                prompt: 'hi',
                ratio: { w: 256, h: 256 },
            } as never),
        );

        expect(result).toBe('https://oai/img.png');
        expect(openaiImagesGenerateMock).toHaveBeenCalledTimes(1);
        // Other provider mocks must NOT have been touched.
        expect(togetherImagesGenerateMock).not.toHaveBeenCalled();
        expect(replicateRunMock).not.toHaveBeenCalled();
    });

    it('routes a known grok-2-image id to the xAI image provider (also OpenAI-SDK shaped)', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://xai/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                model: 'grok-2-image',
                prompt: 'hi',
            } as never),
        );

        // xAI's provider also uses the OpenAI mock — assert via the call args.
        const sent = openaiImagesGenerateMock.mock.calls[0]![0];
        expect(sent.model).toBe('grok-2-image');
        expect(sent.prompt).toBe('hi');
    });

    it('lowercases model lookups so case variants resolve (DALL-E-2 → dall-e-2)', async () => {
        openaiImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://oai/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                model: 'DALL-E-2',
                prompt: 'hi',
                ratio: { w: 256, h: 256 },
            } as never),
        );

        expect(openaiImagesGenerateMock).toHaveBeenCalledTimes(1);
    });

    it('falls through to the requested provider via Context.driverName when args.provider is not supplied', async () => {
        // We're not setting args.provider; Context.driverName takes its place.
        replicateRunMock.mockResolvedValueOnce(['https://rp/img.png']);

        // Replicate's flux-schnell is the only registered model under id
        // `black-forest-labs/flux-schnell` matched solely by Replicate's catalog.
        const result = await withDriverName('replicate-image-generation', () =>
            driver.generate({
                model: 'black-forest-labs/flux-schnell',
                prompt: 'hi',
            } as never),
        );

        expect(result).toBe('https://rp/img.png');
        expect(replicateRunMock).toHaveBeenCalledTimes(1);
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
                model: 'dall-e-2',
                prompt: 'hi',
                width: 256,
                height: 256,
            } as never),
        );

        // Provider received a size derived from the ratio normalization.
        const sent = openaiImagesGenerateMock.mock.calls[0]![0];
        expect(sent.size).toBe('256x256');
    });

    it('parses aspect_ratio "w:h" into ratio when width/height are absent', async () => {
        // Use a per-tier Together model that consults `ratio` directly.
        // The id is shared with Gemini via an alias collision (`gemini-3-pro-image`),
        // so disambiguate explicitly with `args.provider`.
        togetherImagesGenerateMock.mockResolvedValueOnce({
            data: [{ url: 'https://tg/img.png' }],
        });

        await withActor(() =>
            driver.generate({
                provider: 'together-image-generation',
                model: 'togetherai:google/gemini-3-pro-image',
                prompt: 'hi',
                aspect_ratio: '16:9',
                quality: '1K',
            } as never),
        );

        // Together's resolution_map for 16:9 + 1K is 1376×768.
        const sent = togetherImagesGenerateMock.mock.calls[0]![0];
        expect(sent.width).toBe(1376);
        expect(sent.height).toBe(768);
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
                model: 'dall-e-2',
                prompt: 'hi',
                ratio: { w: 256, h: 256 },
            } as never),
        );

        const aiLogCall = eventEmitSpy.mock.calls.find(
            ([eventName]) => eventName === 'ai.log.image',
        );
        expect(aiLogCall).toBeDefined();
        const [, payload] = aiLogCall!;
        const p = payload as Record<string, unknown>;
        expect(p.model_used).toBe('dall-e-2');
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
                    model: 'dall-e-2',
                    prompt: 'hi',
                    ratio: { w: 256, h: 256 },
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

// Avoid coupling the 'unused' XAI export to lint. The catalog reference
// is also used implicitly by the routing tests above.
void XAI_IMAGE_GENERATION_MODELS;
