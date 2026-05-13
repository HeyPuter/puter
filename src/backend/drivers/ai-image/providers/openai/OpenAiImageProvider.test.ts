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
 * three model families the provider supports differently: dall-e-2/3
 * (per-size pricing), gpt-image-* (token-priced), and gpt-image-2
 * (open-ended size with the runtime-clamping normalizer).
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

const { generateMock, openAICtor } = vi.hoisted(() => ({
    generateMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.images = { generate: generateMock };
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

const makeProvider = () =>
    new OpenAiImageProvider({ apiKey: 'test-key' }, server.services.metering);

beforeEach(() => {
    generateMock.mockReset();
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
    it('returns dall-e-2 as the default', () => {
        const provider = makeProvider();
        expect(provider.getDefaultModel()).toBe('dall-e-2');
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

    it('throws 400 when DALL-E model + invalid quality+size combo cannot be priced', async () => {
        const provider = makeProvider();
        // dall-e-3 has no `2048x2048` cost entry; allowedRatios will snap to
        // 1024x1024 first allowed entry though, so to trigger this we use a
        // model with allowedRatios containing the mismatched ratio. We pass
        // dall-e-2 with 256x256 but inject a hd quality (no hd:256 cost key).
        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'dall-e-2',
                    prompt: 'hi',
                    ratio: { w: 256, h: 256 },
                    quality: 'hd',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateMock).not.toHaveBeenCalled();
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
                    model: 'dall-e-2',
                    prompt: 'hi',
                    ratio: { w: 256, h: 256 },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateMock).not.toHaveBeenCalled();
    });
});

// ── DALL-E request shape & metering ────────────────────────────────

describe('OpenAiImageProvider.generate DALL-E request shape', () => {
    const dalleResponse = {
        data: [{ url: 'https://oai.example/img.png' }],
        usage: undefined, // DALL-E responses don't include usage details.
    };

    it('forwards model + size verbatim and snaps invalid ratios to the first allowedRatio', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(dalleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'dall-e-2',
                prompt: 'a tiny red dot',
                ratio: { w: 999, h: 999 }, // not in allowedRatios; falls back to 256x256
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.model).toBe('dall-e-2');
        expect(sent.size).toBe('256x256');
        // DALL-E 2 doesn't accept `quality` so the provider must omit it
        // unless it's the literal 'hd' override (DALL-E 3).
        expect('quality' in sent).toBe(false);
    });

    it('forwards quality=hd only for DALL-E 3', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(dalleResponse);

        await withTestActor(() =>
            provider.generate({
                model: 'dall-e-3',
                prompt: 'hi',
                ratio: { w: 1024, h: 1024 },
                quality: 'hd',
            }),
        );

        const sent = generateMock.mock.calls[0]![0];
        expect(sent.model).toBe('dall-e-3');
        expect(sent.quality).toBe('hd');
    });

    it('returns response.data[0].url and meters one output line at the size cents rate', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce(dalleResponse);

        const result = await withTestActor(() =>
            provider.generate({
                model: 'dall-e-2',
                prompt: 'hi',
                ratio: { w: 256, h: 256 },
            }),
        );

        expect(result).toBe('https://oai.example/img.png');

        // dall-e-2 256x256 cost = 1.6 cents → 1_600_000 microcents.
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const outputEntry = (
            entries as Array<{ usageType: string; costOverride: number }>
        ).find((e) => e.usageType.endsWith(':output'));
        expect(outputEntry?.usageType).toBe(
            'openai:dall-e-2:256x256:output',
        );
        expect(outputEntry?.costOverride).toBe(Math.ceil(1.6 * 1_000_000));
    });

    it('falls back to a base64 data URL when SDK returns b64_json instead of url', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({
            data: [{ b64_json: 'AAAA' }],
        });

        const result = await withTestActor(() =>
            provider.generate({
                model: 'dall-e-2',
                prompt: 'hi',
                ratio: { w: 256, h: 256 },
            }),
        );

        expect(result).toBe('data:image/png;base64,AAAA');
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

describe('OpenAiImageProvider.generate output extraction', () => {
    it('throws 400 when SDK returns no usable image data', async () => {
        const provider = makeProvider();
        generateMock.mockResolvedValueOnce({ data: [{}] });

        await expect(
            withTestActor(() =>
                provider.generate({
                    model: 'dall-e-2',
                    prompt: 'hi',
                    ratio: { w: 256, h: 256 },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});
