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
 * Offline unit tests for SpeechifyTTSProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs SpeechifyTTSProvider directly against the live
 * wired `MeteringService`. Speechify has no SDK here — the provider
 * calls the REST endpoint via `fetch` — so global `fetch` is spied for
 * each request shape assertion.
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
import { SpeechifyTTSProvider } from './SpeechifyTTSProvider.js';
import { SPEECHIFY_TTS_COSTS } from './costs.js';

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

const makeProvider = () =>
    new SpeechifyTTSProvider(server.services.metering, { apiKey: 'test-key' });

const audioResponse = (audioData = Buffer.from('audio-bytes').toString('base64'), audioFormat = 'mp3') =>
    new Response(JSON.stringify({ audio_data: audioData, audio_format: audioFormat }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Construction ────────────────────────────────────────────────────

describe('SpeechifyTTSProvider construction', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new SpeechifyTTSProvider(server.services.metering, {
                    apiKey: '',
                }),
        ).toThrow(/API key/i);
    });
});

// ── Voice / engine catalog ──────────────────────────────────────────

describe('SpeechifyTTSProvider catalog', () => {
    it('listVoices returns the documented Speechify voices with provider=speechify', async () => {
        const provider = makeProvider();
        const voices = await provider.listVoices();
        const ids = voices.map((v) => v.id);
        expect(ids).toEqual(
            expect.arrayContaining(['geffen_32', 'dominic_32', 'harper_32', 'hugh_32', 'imogen_32']),
        );
        for (const voice of voices) {
            expect(voice.provider).toBe('speechify');
        }
    });

    it('listEngines reports the Simba model family', async () => {
        const provider = makeProvider();
        const engines = await provider.listEngines();
        const ids = engines.map((e) => e.id);
        expect(ids).toEqual(
            expect.arrayContaining(['simba-3.2', 'simba-english', 'simba-multilingual']),
        );
        for (const engine of engines) {
            expect(engine.provider).toBe('speechify');
        }
    });
});

// ── Reported costs ──────────────────────────────────────────────────

describe('SpeechifyTTSProvider.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-character line item', () => {
        const provider = makeProvider();
        const reported = provider.getReportedCosts();
        expect(reported).toHaveLength(Object.keys(SPEECHIFY_TTS_COSTS).length);
        for (const [model, ucentsPerUnit] of Object.entries(SPEECHIFY_TTS_COSTS)) {
            expect(reported).toContainEqual({
                usageType: `speechify:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/speechify',
            });
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('SpeechifyTTSProvider.synthesize test_mode', () => {
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

describe('SpeechifyTTSProvider.synthesize argument validation', () => {
    it('throws 400 when text is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.synthesize({ text: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.synthesize({ text: '  ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws 400 for an unrecognized model', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', model: 'not-a-real-model' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('SpeechifyTTSProvider.synthesize credit gate', () => {
    it('throws 402 BEFORE hitting Speechify when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('SpeechifyTTSProvider.synthesize request shape', () => {
    it('POSTs to /v1/audio/speech with Bearer auth, Speechify-Caller header, and defaults', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() => provider.synthesize({ text: 'hello' }));

        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe('https://api.speechify.ai/v1/audio/speech');
        const initObj = init as RequestInit;
        expect(initObj.method).toBe('POST');
        const headers = initObj.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer test-key');
        expect(headers['Speechify-Caller']).toBe('puter');

        const body = JSON.parse(initObj.body as string);
        expect(body).toEqual({
            input: '<speak>hello</speak>',
            voice_id: 'geffen_32', // DEFAULT_VOICE
            model: 'simba-3.2', // DEFAULT_MODEL
            audio_format: 'mp3',
        });
    });

    it('forwards voice and model overrides to the API', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({ text: 'hi', voice: 'alec', model: 'simba-english' }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.voice_id).toBe('alec');
        expect(body.model).toBe('simba-english');
    });

    it('does not re-wrap text that is already SSML', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({ text: '<speak>already SSML</speak>' }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.input).toBe('<speak>already SSML</speak>');
    });

    it('decodes base64 audio_data into a readable byte stream', async () => {
        const provider = makeProvider();
        const raw = Buffer.from('AAA-BBB');
        fetchSpy.mockResolvedValueOnce(audioResponse(raw.toString('base64')));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as { stream: Readable; content_type: string; chunked: boolean };

        expect(result.chunked).toBe(true);
        expect(result.stream).toBeInstanceOf(Readable);

        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk as Buffer);
        }
        expect(Buffer.concat(chunks).equals(raw)).toBe(true);
    });

    it('maps audio_format to the canonical content-type', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            audioResponse(Buffer.from('x').toString('base64'), 'wav'),
        );

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi', output_format: 'wav' }),
        )) as { content_type: string };

        expect(result.content_type).toBe('audio/wav');
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('SpeechifyTTSProvider.synthesize metering', () => {
    it('meters character count × per-char ucents under speechify:<model>:character', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        const text = 'hello world';
        await withTestActor(() => provider.synthesize({ text }));

        const expectedCost = SPEECHIFY_TTS_COSTS['simba-3.2'] * text.length;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('speechify:simba-3.2:character');
        expect(count).toBe(text.length);
        expect(cost).toBe(expectedCost);
    });

    it('asks for hasEnoughCredits with the same total it later meters', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        const text = 'hi there';
        await withTestActor(() => provider.synthesize({ text }));

        const expectedCost = SPEECHIFY_TTS_COSTS['simba-3.2'] * text.length;
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(expectedCost);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('SpeechifyTTSProvider.synthesize error paths', () => {
    it('maps upstream 4xx to HttpError 400 upstream_bad_request', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response('bad request', { status: 400 }),
        );

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 5xx to HttpError 400 upstream_provider_unavailable', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(new Response('oops', { status: 503 }));

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_provider_unavailable',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 429 to HttpError 429 upstream_rate_limited', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(new Response('slow down', { status: 429 }));

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'upstream_rate_limited',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('throws 400 when the response has no audio_data', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('lets fetch network errors bubble so the driver boundary can decide', async () => {
        const provider = makeProvider();
        fetchSpy.mockRejectedValueOnce(new Error('connection reset'));

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toThrow('connection reset');
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
