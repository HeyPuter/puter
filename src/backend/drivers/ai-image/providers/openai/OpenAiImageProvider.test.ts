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
 * Offline unit tests for OpenAiImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs OpenAiImageProvider directly against the
 * live wired `MeteringService`. The OpenAI SDK is mocked at the
 * module boundary; that's the real network egress point. Covers the
 * gpt-image-* models (token-priced), gpt-image-2 (open-ended size
 * with the runtime-clamping normalizer), and image-to-image editing
 * via `input_images` (the `images.edit` endpoint).
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
import { OPEN_AI_IMAGE_GENERATION_MODELS } from './models.js';
import { OpenAiImageProvider } from './OpenAiImageProvider.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { generateMock, editMock, toFileMock, openAICtor } = vi.hoisted(() => ({
    generateMock: vi.fn(),
    editMock: vi.fn(),
    toFileMock: vi.fn(async (data: unknown, name: unknown, opts: unknown) => ({
        __file: true,
        name,
        type: (opts as { type?: string } | undefined)?.type,
        data,
    })),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.images = { generate: generateMock, edit: editMock };
        this.chat = { completions: { create: vi.fn() } };
    });
    return {
        OpenAI: OpenAICtor,
        default: { OpenAI: OpenAICtor },
        toFile: toFileMock,
    };
});

// Stub the URL→base64 fetch so URL inputs stay offline; keep the rest real.
const { fetchImageAsBase64Mock } = vi.hoisted(() => ({
    fetchImageAsBase64Mock: vi.fn(),
}));

vi.mock('../../inputImage.js', async (orig) => ({
    ...(await orig<typeof import('../../inputImage.js')>()),
    fetchImageAsBase64: fetchImageAsBase64Mock,
}));

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

const makeProvider = () =>
    new OpenAiImageProvider({ apiKey: 'test-key' }, server.services.metering);

beforeEach(() => {
    generateMock.mockReset();
    editMock.mockReset();
    fetchImageAsBase64Mock.mockReset();
    openAICtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    batchIncrementUsagesSpy = vi.spyOn(
        server.services.metering,
        'batchIncrementUsages',
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('OpenAiImageProvider construction', () => {
    it('constructs the OpenAI SDK with the configured api key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Model catalog ───────────────────────────────────────────────────

describe('OpenAiImageProvider model catalog', () => {
    it('returns gpt-image-1-mini as the default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('gpt-image-1-mini');
    });

    it('no longer exposes any dall-e models', () => {
        const provider = makeProvider();
        expect(
            provider.models().some((m) => m.id.startsWith('dall-e')),
        ).toBe(false);
    });

    it('exposes the static OPEN_AI_IMAGE_GENERATION_MODELS list verbatim', () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(OPEN_AI_IMAGE_GENERATION_MODELS);
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('OpenAiImageProvider.generate test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.generate({ prompt: 'something', test_mode: true }),
        );
        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('OpenAiImageProvider.generate argument validation', () => {
    it('throws 400 when prompt is not a string', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.generate({ prompt: undefined as unknown as string }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('OpenAiImageProvider.generate credit gate', () => {
    it('throws 402 BEFORE hitting OpenAI when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);
        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'gpt-image-1-mini',
                    prompt: 'hi',
                    ratio: { w: 1024, h: 1024 },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── Output extraction ──────────────────────────────────────────────

describe('OpenAiImageProvider.generate output extraction', () => {
    const gptResponse = (data: unknown) => ({
        data,
        usage: {
            input_tokens: 100,
            output_tokens: 800,
            input_tokens_details: {
                text_tokens: 100,
                image_tokens: 0,
                cached_tokens: 0,
            },
        },
    });

    it('returns response.data[0].url when the SDK returns a url', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(
            gptResponse([{ url: 'https://oai.example/img.png' }]),
        );

        const result = await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1-mini',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            }),
        );

        expect(result).toBe('https://oai.example/img.png');
    });

    it('falls back to a base64 data URL when SDK returns b64_json instead of url', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(gptResponse([{ b64_json: 'AAAA' }]));

        const result = await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1-mini',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            }),
        );

        expect(result).toBe('data:image/png;base64,AAAA');
    });
});

// ── input_images / edit endpoint ───────────────────────────────────

describe('OpenAiImageProvider.generate input_images (edit endpoint)', () => {
    const editResponse = {
        data: [{ b64_json: 'AAAA' }],
        usage: {
            input_tokens: 600,
            output_tokens: 800,
            input_tokens_details: {
                text_tokens: 40,
                image_tokens: 560,
                cached_tokens: 0,
            },
        },
    };

    const PNG = 'data:image/png;base64,iVBORw0KGgo=';

    it('routes input_images to images.edit (not generate) with image files set', async () => {
        const provider = makeProvider();
        editMock.mockResolvedValueOnce(editResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1',
                prompt: 'add a hat',
                ratio: { w: 1024, h: 1024 },
                input_images: [PNG, PNG],
            }),
        );

        expect(generateMock).not.toHaveBeenCalled();
        expect(editMock).toHaveBeenCalledTimes(1);
        const sent = editMock.mock.calls[0]![0];
        expect(sent.model).toBe('gpt-image-1');
        expect(sent.prompt).toBe('add a hat');
        // Two input images → array of uploadables.
        expect(Array.isArray(sent.image)).toBe(true);
        expect(sent.image).toHaveLength(2);
    });

    it('meters an :input line at the image_input token rate when the edit response reports image tokens', async () => {
        const provider = makeProvider();
        editMock.mockResolvedValueOnce(editResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1',
                prompt: 'add a hat',
                ratio: { w: 1024, h: 1024 },
                input_images: [PNG],
            }),
        );

        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const inputEntry = (
            entries as Array<{ usageType: string; costOverride: number }>
        ).find((e) => e.usageType.endsWith(':input'));
        expect(inputEntry?.usageType).toBe(
            'openai:gpt-image-1:low:1024x1024:input',
        );
        // gpt-image-1: text_input=500, image_input=1000 (cents/1M tokens).
        // 40 text + 560 image tokens → (40*500 + 560*1000)/1e6 cents.
        const expectedCents = (40 * 500 + 560 * 1000) / 1_000_000;
        expect(inputEntry?.costOverride).toBe(Math.ceil(expectedCents * 1_000_000));
    });

    it('folds singular input_image into the edit path with a single uploadable', async () => {
        const provider = makeProvider();
        editMock.mockResolvedValueOnce(editResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1-mini',
                prompt: 'add a hat',
                ratio: { w: 1024, h: 1024 },
                input_image: PNG,
            }),
        );

        expect(editMock).toHaveBeenCalledTimes(1);
        const sent = editMock.mock.calls[0]![0];
        // Single image → not wrapped in an array.
        expect(Array.isArray(sent.image)).toBe(false);
        expect((sent.image as { __file?: boolean }).__file).toBe(true);
    });

    it('fetches an http(s) URL input and sends the bytes to images.edit', async () => {
        const provider = makeProvider();
        editMock.mockResolvedValueOnce(editResponse);
        fetchImageAsBase64Mock.mockResolvedValueOnce({
            base64: 'iVBORw0KGgo=',
            mime: 'image/png',
        });

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1',
                prompt: 'add a hat',
                ratio: { w: 1024, h: 1024 },
                input_images: ['https://example.com/in.png'],
            }),
        );

        expect(fetchImageAsBase64Mock).toHaveBeenCalledWith(
            'https://example.com/in.png',
        );
        expect(generateMock).not.toHaveBeenCalled();
        expect(editMock).toHaveBeenCalledTimes(1);
        const sent = editMock.mock.calls[0]![0];
        expect((sent.image as { __file?: boolean }).__file).toBe(true);
    });
});

// ── gpt-image (token-priced) request shape & metering ──────────────

describe('OpenAiImageProvider.generate gpt-image-* request shape', () => {
    const gptResponse = {
        data: [{ b64_json: 'AAAA' }],
        usage: {
            input_tokens: 100,
            output_tokens: 800,
            input_tokens_details: {
                text_tokens: 100,
                image_tokens: 0,
                cached_tokens: 0,
            },
        },
    };

    it('uses quality:size pricing key and defaults quality to "low" on the wire', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(gptResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.model).toBe('gpt-image-1');
        expect(sent.size).toBe('1024x1024');
        // No caller-supplied quality → provider sends 'low'.
        expect(sent.quality).toBe('low');
    });

    it('meters input + output as two batched line items at token rates', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(gptResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-1',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
            }),
        );

        // gpt-image-1 rates: text_input=500, image_output=4000 (cents/1M tokens).
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const types = (
            entries as Array<{ usageType: string }>
        ).map((e) => e.usageType);
        expect(types).toEqual(
            expect.arrayContaining([
                'openai:gpt-image-1:low:1024x1024:input',
                'openai:gpt-image-1:low:1024x1024:output',
            ]),
        );
    });
});

// ── gpt-image-2 size normalizer ────────────────────────────────────

describe('OpenAiImageProvider.generate gpt-image-2 size normalizer', () => {
    const gptResponse = {
        data: [{ b64_json: 'AAAA' }],
        usage: {
            input_tokens: 1,
            output_tokens: 1,
            input_tokens_details: {
                text_tokens: 1,
                image_tokens: 0,
                cached_tokens: 0,
            },
        },
    };

    it('snaps undersized ratios into the [655360, 8294400] pixel budget on multiples of 16', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(gptResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                ratio: { w: 64, h: 64 }, // way under MIN_PIXELS
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        const [w, h] = (sent.size as string).split('x').map(Number);
        // multiples of 16
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        // edges within bounds and inside the pixel budget
        expect(w).toBeGreaterThanOrEqual(16);
        expect(h).toBeGreaterThanOrEqual(16);
        const pixels = w * h;
        expect(pixels).toBeGreaterThanOrEqual(655_360);
        expect(pixels).toBeLessThanOrEqual(8_294_400);
    });

    it('clamps long:short ratio to <= 3:1', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(gptResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                ratio: { w: 4000, h: 200 }, // 20:1
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        const [w, h] = (sent.size as string).split('x').map(Number);
        const ratio = Math.max(w, h) / Math.min(w, h);
        expect(ratio).toBeLessThanOrEqual(3);
    });

    it('caps each edge at 3840', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(gptResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'gpt-image-2',
                prompt: 'hi',
                ratio: { w: 99999, h: 1024 },
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        const [w, h] = (sent.size as string).split('x').map(Number);
        expect(w).toBeLessThanOrEqual(3840);
        expect(h).toBeLessThanOrEqual(3840);
    });
});

// ── Output extraction error ────────────────────────────────────────

describe('OpenAiImageProvider.generate output extraction error', () => {
    it('throws 400 when SDK returns no usable image data', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({ data: [{}] });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'gpt-image-1-mini',
                    prompt: 'hi',
                    ratio: { w: 1024, h: 1024 },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});
