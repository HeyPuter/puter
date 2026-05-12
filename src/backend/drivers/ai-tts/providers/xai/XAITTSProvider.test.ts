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
 * Offline unit tests for XAITTSProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs XAITTSProvider directly against the live
 * wired `MeteringService`. xAI has no SDK — the provider calls the
 * REST endpoint via `fetch` — so global `fetch` is spied for each
 * request shape assertion.
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
import { XAITTSProvider } from './XAITTSProvider.js';
import { XAI_TTS_COSTS } from './costs.js';

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
    new XAITTSProvider(server.services.metering, { apiKey: 'test-key' });

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

// ── Construction ────────────────────────────────────────────────────

describe('XAITTSProvider construction', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new XAITTSProvider(server.services.metering, {
                    apiKey: '',
                }),
        ).toThrow(/API key/i);
    });
});

// ── Voice / engine catalog ──────────────────────────────────────────

describe('XAITTSProvider catalog', () => {
    it('listVoices returns the documented xAI voices with provider=xai', async () => {
        const provider = makeProvider();
        const voices = await provider.listVoices();
        const ids = voices.map((v) => v.id);
        expect(ids).toEqual(
            expect.arrayContaining(['eve', 'ara', 'rex', 'sal', 'leo']),
        );
        for (const voice of voices) {
            expect(voice.provider).toBe('xai');
        }
    });

    it('listEngines reports a single xai-tts engine with pricing_per_million_chars', async () => {
        const provider = makeProvider();
        const engines = await provider.listEngines();
        expect(engines).toHaveLength(1);
        expect(engines[0]).toMatchObject({
            id: 'xai-tts',
            provider: 'xai',
            pricing_per_million_chars: 1500,
        });
    });
});

// ── Reported costs ──────────────────────────────────────────────────

describe('XAITTSProvider.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-character line item', () => {
        const provider = makeProvider();
        const reported = provider.getReportedCosts();
        expect(reported).toHaveLength(Object.keys(XAI_TTS_COSTS).length);
        for (const [model, ucentsPerUnit] of Object.entries(XAI_TTS_COSTS)) {
            expect(reported).toContainEqual({
                usageType: `xai:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/xai',
            });
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('XAITTSProvider.synthesize test_mode', () => {
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

describe('XAITTSProvider.synthesize argument validation', () => {
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

    it('throws 400 when text exceeds 15,000 characters', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'x'.repeat(15_001) }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('XAITTSProvider.synthesize credit gate', () => {
    it('throws 402 BEFORE hitting xAI when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('XAITTSProvider.synthesize request shape', () => {
    it('POSTs to /v1/tts with Bearer auth and default voice/language', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() => provider.synthesize({ text: 'hello' }));

        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe('https://api.x.ai/v1/tts');
        const initObj = init as RequestInit;
        expect(initObj.method).toBe('POST');
        expect((initObj.headers as Record<string, string>).Authorization).toBe(
            'Bearer test-key',
        );
        const body = JSON.parse(initObj.body as string);
        expect(body).toEqual({
            text: 'hello',
            voice_id: 'eve', // DEFAULT_VOICE
            language: 'en',
        });
    });

    it('forwards voice and language overrides to the API', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({ text: 'hi', voice: 'leo', language: 'es' }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.voice_id).toBe('leo');
        expect(body.language).toBe('es');
    });

    it('wraps response_format/output_format as { codec } on the wire', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({ text: 'hi', output_format: 'wav' }),
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
        );
        expect(body.output_format).toEqual({ codec: 'wav' });
    });

    it('maps codec to the canonical content-type on the response', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse('x', 'audio/wav'));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi', output_format: 'wav' }),
        )) as { content_type: string };

        expect(result.content_type).toBe('audio/wav');
    });

    it('returns audio/mpeg by default when no output_format is supplied', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse('x', 'audio/mpeg'));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as { content_type: string };

        expect(result.content_type).toBe('audio/mpeg');
    });
});

// ── Streaming output ────────────────────────────────────────────────

describe('XAITTSProvider.synthesize streaming output', () => {
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
        expect(result.stream).toBeInstanceOf(Readable);

        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk as Buffer);
        }
        expect(Buffer.concat(chunks).toString()).toBe('AAA-BBB');
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('XAITTSProvider.synthesize metering', () => {
    it('meters character count × per-char ucents under xai:xai-tts:character', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        const text = 'hello world';
        await withTestActor(() => provider.synthesize({ text }));

        const expectedCost = XAI_TTS_COSTS['xai-tts'] * text.length;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('xai:xai-tts:character');
        expect(count).toBe(text.length);
        expect(cost).toBe(expectedCost);
    });

    it('asks for hasEnoughCredits with the same total it later meters', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(audioResponse());

        const text = 'hi there';
        await withTestActor(() => provider.synthesize({ text }));

        const expectedCost = XAI_TTS_COSTS['xai-tts'] * text.length;
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(expectedCost);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('XAITTSProvider.synthesize error paths', () => {
    it('wraps non-OK upstream responses as HttpError 502', async () => {
        const provider = makeProvider();
        fetchSpy.mockResolvedValueOnce(
            new Response('bad request', { status: 400 }),
        );

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 502 });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('wraps fetch network errors as HttpError 502 (not a thrown ENOTFOUND)', async () => {
        const provider = makeProvider();
        fetchSpy.mockRejectedValueOnce(new Error('connection reset'));

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 502 });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
