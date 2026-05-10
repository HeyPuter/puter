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
 * Offline unit tests for ElevenLabsTTSProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs ElevenLabsTTSProvider directly against the
 * live wired `MeteringService`. ElevenLabs has no SDK — the provider
 * uses `fetch` — so the global `fetch` is spied for each request shape
 * assertion. The companion integration test
 * (ElevenLabsTTSProvider.integration.test.ts) covers the real API.
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
import { ElevenLabsTTSProvider } from './ElevenLabsTTSProvider.js';
import { ELEVENLABS_TTS_COSTS } from './costs.js';

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let fetchSpy: MockInstance<typeof fetch>;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (
    extras: Partial<{
        apiBaseUrl: string;
        defaultVoiceId: string;
    }> = {},
) =>
    new ElevenLabsTTSProvider(server.services.metering, {
        apiKey: 'test-key',
        ...extras,
    });

const audioResponse = (body = 'audio-bytes', contentType = 'audio/mpeg') =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } });

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Voice / engine catalog ──────────────────────────────────────────

describe('ElevenLabsTTSProvider catalog', () => {
    it('listVoices fetches /v1/voices and normalises the response', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    voices: [
                        {
                            voice_id: 'voice-a',
                            name: 'Voice A',
                            description: 'desc',
                            category: 'cat',
                            labels: { gender: 'female' },
                        },
                        // Missing id/name → filtered out.
                        { description: 'nameless' },
                    ],
                }),
                { status: 200 },
            ),
        );

        const voices = await provider.listVoices();
        expect(voices).toHaveLength(1);
        expect(voices[0]).toMatchObject({
            id: 'voice-a',
            name: 'Voice A',
            provider: 'elevenlabs',
            category: 'cat',
            labels: { gender: 'female' },
        });
        expect(voices[0].supported_models).toEqual(
            expect.arrayContaining([
                'eleven_multilingual_v2',
                'eleven_flash_v2_5',
            ]),
        );

        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe('https://api.elevenlabs.io/v1/voices');
        expect((init as RequestInit).headers).toMatchObject({
            'xi-api-key': 'test-key',
        });
    });

    it('listVoices uses a custom apiBaseUrl when configured', async () => {
        const provider = makeProvider({ apiBaseUrl: 'https://custom.example' });
        fetchSpy.mockResolvedValueOnce(
            new Response('{"voices":[]}', { status: 200 }),
        );
        await provider.listVoices();
        const [url] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe('https://custom.example/v1/voices');
    });

    it('listEngines returns the documented model list with provider=elevenlabs', async () => {
        const provider = makeProvider();
        const engines = await provider.listEngines();
        const ids = engines.map((e) => e.id);
        expect(ids).toEqual(
            expect.arrayContaining([
                'eleven_multilingual_v2',
                'eleven_flash_v2_5',
                'eleven_turbo_v2_5',
                'eleven_v3',
            ]),
        );
        for (const engine of engines) {
            expect(engine.provider).toBe('elevenlabs');
        }
    });
});

// ── Reported costs ──────────────────────────────────────────────────

describe('ElevenLabsTTSProvider.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-character line item', () => {
        const provider = makeProvider();
        const reported = provider.getReportedCosts();
        expect(reported).toHaveLength(Object.keys(ELEVENLABS_TTS_COSTS).length);
        for (const [model, ucentsPerUnit] of Object.entries(
            ELEVENLABS_TTS_COSTS,
        )) {
            expect(reported).toContainEqual({
                usageType: `elevenlabs:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/elevenlabs',
            });
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize test_mode', () => {
    it('returns the canned sample URL without hitting credits or fetch', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.synthesize({ text: 'hi', test_mode: true }),
        );
        expect(result).toEqual({
            url: 'https://puter-sample-data.puter.site/tts_example.mp3',
            content_type: 'audio',
        });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize argument validation', () => {
    it('throws 400 when text is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.synthesize({ text: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.synthesize({ text: '  ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: undefined as unknown as string }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize credit gate', () => {
    it('throws 402 BEFORE hitting ElevenLabs when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize request shape', () => {
    it('POSTs to /v1/text-to-speech/<voice> with defaults when none supplied', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() => provider.synthesize({ text: 'hello' }));

        const [url, init] = fetchSpy.mock.calls[0]!;
        // Default voice id is the documented Rachel sample.
        expect(String(url)).toBe(
            'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',
        );
        const initObj = init as RequestInit;
        expect(initObj.method).toBe('POST');
        expect((initObj.headers as Record<string, string>)['xi-api-key']).toBe(
            'test-key',
        );
        const body = JSON.parse(initObj.body as string);
        expect(body).toEqual({
            text: 'hello',
            model_id: 'eleven_multilingual_v2',
            output_format: 'mp3_44100_128',
        });
    });

    it('routes to the configured defaultVoiceId when no voice arg is supplied', async () => {
        const provider = makeProvider({ defaultVoiceId: 'custom-voice-id' });
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() => provider.synthesize({ text: 'hi' }));

        const [url] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe(
            'https://api.elevenlabs.io/v1/text-to-speech/custom-voice-id',
        );
    });

    it('prefers output_format over response_format when both are set', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                output_format: 'mp3_22050_32',
                response_format: 'mp3_44100_128',
            }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.output_format).toBe('mp3_22050_32');
    });

    it('falls back to response_format when output_format is absent', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                response_format: 'pcm_44100',
            }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.output_format).toBe('pcm_44100');
    });

    it('attaches voice_settings (snake_case preferred) to the payload', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                voice_settings: { stability: 0.9 },
                // camelCase fallback shouldn't override the snake_case one.
                voiceSettings: { stability: 0.1 },
            }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.voice_settings).toEqual({ stability: 0.9 });
    });

    it('falls back to camelCase voiceSettings when snake_case is absent', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                voiceSettings: { stability: 0.42 },
            }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.voice_settings).toEqual({ stability: 0.42 });
    });
});

// ── Streaming output ────────────────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize streaming output', () => {
    it('returns the upstream audio bytes as a readable stream', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse('AAA-BBB'));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as {
            stream: Readable;
            content_type: string;
            chunked: boolean;
        };

        expect(result.chunked).toBe(true);
        expect(result.content_type).toBe('audio/mpeg');
        expect(result.stream).toBeInstanceOf(Readable);

        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk as Buffer);
        }
        expect(Buffer.concat(chunks).toString()).toBe('AAA-BBB');
    });

    it('uses the response content-type header when present', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse('x', 'audio/wav'));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as { content_type: string };

        expect(result.content_type).toBe('audio/wav');
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize metering', () => {
    it('meters character count × per-model ucents using the namespaced usage key', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        const text = 'hello';
        await withTestActor(() =>
            provider.synthesize({ text, model: 'eleven_flash_v2_5' }),
        );

        const expectedCost = ELEVENLABS_TTS_COSTS['eleven_flash_v2_5'] * text.length;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('elevenlabs:eleven_flash_v2_5:character');
        expect(count).toBe(text.length);
        expect(cost).toBe(expectedCost);
    });

    it('asks for hasEnoughCredits with the same total it later meters', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        const text = 'hi there';
        await withTestActor(() =>
            provider.synthesize({ text, model: 'eleven_multilingual_v2' }),
        );

        const expectedCost =
            ELEVENLABS_TTS_COSTS['eleven_multilingual_v2'] * text.length;
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(expectedCost);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('ElevenLabsTTSProvider.synthesize error paths', () => {
    it('wraps non-OK upstream responses as HttpError 502', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response('{"error":"bad voice"}', {
                status: 422,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 502 });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('propagates fetch rejection without metering', async () => {
        const provider = makeProvider();
        const netErr = new Error('connection reset');
        fetchSpy.mockRejectedValueOnce(netErr);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toBe(netErr);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
