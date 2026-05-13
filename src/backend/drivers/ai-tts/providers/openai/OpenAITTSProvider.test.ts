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
 * Offline unit tests for OpenAITTSProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs OpenAITTSProvider directly against the live
 * wired `MeteringService` so the recording side runs end-to-end. The
 * OpenAI SDK is mocked at the module boundary — that's the real
 * network egress point. The companion integration test
 * (OpenAITTSProvider.integration.test.ts) covers the real API.
 */

import { Readable } from 'node:stream';
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
import { OpenAITTSProvider } from './OpenAITTSProvider.js';
import { OPENAI_TTS_COSTS } from './costs.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────

const { speechCreateMock, openAICtor } = vi.hoisted(() => ({
    speechCreateMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.audio = { speech: { create: speechCreateMock } };
        // Sibling providers in the same PuterServer poke other namespaces
        // during boot — keep them happy with stubs.
        this.chat = { completions: { create: vi.fn() } };
        this.images = { generate: vi.fn() };
    });
    // Two consumer shapes coexist in the codebase:
    //   - `import OpenAI from 'openai'; new OpenAI(...)`   (TTS provider)
    //   - `import openai from 'openai'; new openai.OpenAI(...)` (Ollama chat)
    // The default export has to satisfy both, so attach `.OpenAI` onto
    // the constructor itself before returning.
    (OpenAICtor as unknown as { OpenAI: unknown }).OpenAI = OpenAICtor;
    return { OpenAI: OpenAICtor, default: OpenAICtor };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () =>
    new OpenAITTSProvider(server.services.metering, { apiKey: 'test-key' });

const mockAudioResponse = (bytes = 'opus-audio') => ({
    arrayBuffer: async () =>
        new Uint8Array(Buffer.from(bytes)).buffer as ArrayBuffer,
});

beforeEach(() => {
    speechCreateMock.mockReset();
    openAICtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('OpenAITTSProvider construction', () => {
    it('constructs the OpenAI SDK with the configured api key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });
});

// ── Voice / engine catalog ──────────────────────────────────────────

describe('OpenAITTSProvider catalog', () => {
    it('lists every documented voice with provider=openai and supported_models', async () => {
        const provider = makeProvider();
        const voices = await provider.listVoices();
        expect(voices.length).toBeGreaterThan(0);
        for (const voice of voices) {
            expect(voice.provider).toBe('openai');
            expect(voice.supported_models).toEqual(
                expect.arrayContaining(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']),
            );
        }
        // Default voice id is present.
        expect(voices.find((v) => v.id === 'alloy')).toBeDefined();
    });

    it('lists every documented engine with pricing_per_million_chars', async () => {
        const provider = makeProvider();
        const engines = await provider.listEngines();
        const ids = engines.map((e) => e.id);
        expect(ids).toEqual(
            expect.arrayContaining(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']),
        );
        // tts-1-hd is the only model with a different rate.
        const hd = engines.find((e) => e.id === 'tts-1-hd')!;
        expect(hd.pricing_per_million_chars).toBe(30);
    });
});

// ── Reported costs ──────────────────────────────────────────────────

describe('OpenAITTSProvider.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-character line item', () => {
        const provider = makeProvider();
        const reported = provider.getReportedCosts();
        expect(reported).toHaveLength(Object.keys(OPENAI_TTS_COSTS).length);
        for (const [model, ucentsPerUnit] of Object.entries(OPENAI_TTS_COSTS)) {
            expect(reported).toContainEqual({
                usageType: `openai:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/openai',
            });
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('OpenAITTSProvider.synthesize test_mode', () => {
    it('returns the canned sample URL without hitting credits or the SDK', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.synthesize({ text: 'hi', test_mode: true }),
        );
        expect(result).toEqual({
            url: 'https://puter-sample-data.puter.site/tts_example.mp3',
            content_type: 'audio',
        });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(speechCreateMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('OpenAITTSProvider.synthesize argument validation', () => {
    it('throws 400 when text is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.synthesize({ text: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.synthesize({ text: '   ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() =>
                provider.synthesize({
                    text: undefined as unknown as string,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(speechCreateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when the model is not in the catalog', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', model: 'tts-fake' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(speechCreateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when the voice is not in the catalog', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', voice: 'fake-voice' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(speechCreateMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('OpenAITTSProvider.synthesize credit gate', () => {
    it('throws 402 BEFORE hitting OpenAI when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(speechCreateMock).not.toHaveBeenCalled();
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('OpenAITTSProvider.synthesize request shape', () => {
    it('forwards model + voice + text and defaults to gpt-4o-mini-tts/alloy', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        await withTestActor(() => provider.synthesize({ text: 'hello world' }));

        const sent = speechCreateMock.mock.calls[0]![0];
        expect(sent.model).toBe('gpt-4o-mini-tts');
        expect(sent.voice).toBe('alloy');
        expect(sent.input).toBe('hello world');
        // No optional fields supplied — they should not be on the payload.
        expect('instructions' in sent).toBe(false);
        expect('response_format' in sent).toBe(false);
    });

    it('forwards instructions and response_format when supplied', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                model: 'tts-1-hd',
                voice: 'echo',
                instructions: 'Speak with a warm tone',
                response_format: 'wav',
            }),
        );

        const sent = speechCreateMock.mock.calls[0]![0];
        expect(sent.model).toBe('tts-1-hd');
        expect(sent.voice).toBe('echo');
        expect(sent.instructions).toBe('Speak with a warm tone');
        expect(sent.response_format).toBe('wav');
    });

    it('maps response_format to the matching audio content-type', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        const result = (await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                response_format: 'flac',
            }),
        )) as { stream: Readable; content_type: string; chunked: boolean };

        expect(result.content_type).toBe('audio/flac');
        expect(result.chunked).toBe(true);
        expect(result.stream).toBeInstanceOf(Readable);
    });

    it('falls back to audio/mpeg when response_format is omitted (mp3 default)', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as { content_type: string };

        expect(result.content_type).toBe('audio/mpeg');
    });

    it('falls back to audio/mpeg when response_format is an unknown codec', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        const result = (await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                response_format: 'totally-fake-codec',
            }),
        )) as { content_type: string };

        expect(result.content_type).toBe('audio/mpeg');
    });
});

// ── Streaming output ────────────────────────────────────────────────

describe('OpenAITTSProvider.synthesize streaming output', () => {
    it('returns the upstream audio bytes as a readable stream', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse('AAA-BBB'));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as { stream: Readable };

        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk as Buffer);
        }
        expect(Buffer.concat(chunks).toString()).toBe('AAA-BBB');
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('OpenAITTSProvider.synthesize metering', () => {
    it('meters character count × per-model ucents for the chosen model', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        const text = 'hello';
        await withTestActor(() =>
            provider.synthesize({ text, model: 'tts-1-hd', voice: 'alloy' }),
        );

        // tts-1-hd costs 3000 ucents/char × 5 chars = 15000 ucents.
        const expectedCost = OPENAI_TTS_COSTS['tts-1-hd'] * text.length;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('openai:tts-1-hd:character');
        expect(count).toBe(text.length);
        expect(cost).toBe(expectedCost);
    });

    it('asks for hasEnoughCredits with the same total it later meters', async () => {
        const provider = makeProvider();
        speechCreateMock.mockResolvedValueOnce(mockAudioResponse());

        const text = 'hi there';
        await withTestActor(() =>
            provider.synthesize({ text, model: 'tts-1' }),
        );

        const expectedCost = OPENAI_TTS_COSTS['tts-1'] * text.length;
        // First call to hasEnoughCredits should match the metered cost.
        const creditCall = hasCreditsSpy.mock.calls[0]!;
        expect(creditCall[1]).toBe(expectedCost);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('OpenAITTSProvider.synthesize error paths', () => {
    it('propagates upstream OpenAI errors and does not meter when the call rejects', async () => {
        const provider = makeProvider();
        const sdkError = new Error('upstream blew up');
        speechCreateMock.mockRejectedValueOnce(sdkError);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toBe(sdkError);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
