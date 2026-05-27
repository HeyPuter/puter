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
 * Offline unit tests for XAISpeechToTextDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) configured with an xAI API key, then drives
 * `server.drivers.aiSpeech2TxtXai` directly. xAI has no SDK — the
 * driver calls the REST `/v1/stt` endpoint via `fetch` — so global
 * `fetch` is spied for each request shape assertion. Audio inputs use
 * `data:` URLs through the live `loadFileInput`, and the FS-resolution
 * branch is exercised by writing a real file via `server.services.fs.write`.
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

import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { XAISpeechToTextDriver } from './XAISpeechToTextDriver.js';

// Mirror the driver's per-second cost so test expectations stay in lockstep
// with the real value rather than restating an arbitrary literal.
const UCENTS_PER_SECOND = 2778;

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: XAISpeechToTextDriver;
let fetchSpy: MockInstance<typeof fetch>;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            xai: { apiKey: 'xai-test-key' },
        },
    } as never);
    driver = server.drivers.aiSpeech2TxtXai as unknown as XAISpeechToTextDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `xai-stt-${Math.random().toString(36).slice(2, 10)}`;
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

const dataUrl = (buffer: Buffer, mime: string) =>
    `data:${mime};base64,${buffer.toString('base64')}`;

const sttResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

// ── getReportedCosts ────────────────────────────────────────────────

describe('XAISpeechToTextDriver.getReportedCosts', () => {
    it('reports a single per-second line item at the documented xAI rate', () => {
        const reported = driver.getReportedCosts();
        expect(reported).toEqual([
            {
                usageType: 'xai:stt:second',
                ucentsPerUnit: UCENTS_PER_SECOND,
                unit: 'second',
                source: 'driver:aiSpeech2Txt/xai',
            },
        ]);
    });
});

// ── list_models ─────────────────────────────────────────────────────

describe('XAISpeechToTextDriver.list_models', () => {
    it('returns the single xai-stt entry with diarization support', async () => {
        const models = await driver.list_models();
        expect(models).toHaveLength(1);
        expect(models[0]).toEqual({
            id: 'xai-stt',
            name: 'xAI Speech to Text',
            type: 'transcription',
            response_formats: ['json'],
            supports_prompt: false,
            supports_logprobs: false,
            supports_diarization: true,
        });
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('XAISpeechToTextDriver test_mode', () => {
    it('returns the canned sample for transcribe, bypassing all I/O', async () => {
        const result = (await driver.transcribe({
            file: undefined,
            test_mode: true,
        })) as { text: string; model: string; words: unknown[] };

        expect(result.text).toMatch(/sample transcription/i);
        expect(result.model).toBe('xai-stt');
        expect(Array.isArray(result.words)).toBe(true);
        // No file required, no actor required, no fetch / metering hit.
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('returns the canned sample for translate (same alias, no fetch)', async () => {
        const result = (await driver.translate({
            file: undefined,
            test_mode: true,
        })) as { model: string };
        expect(result.model).toBe('xai-stt');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('XAISpeechToTextDriver argument validation', () => {
    it('throws 400 when file is missing', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.transcribe({ file: undefined })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ── Missing API key ─────────────────────────────────────────────────

describe('XAISpeechToTextDriver missing API key', () => {
    it('throws 500 internal_error when no xAI key is configured', async () => {
        // Boot a separate server WITHOUT an xAI provider entry so the
        // driver leaves its key unset. test_mode and validation paths
        // are unaffected — only the network branch should reject.
        const bareServer = await setupTestServer();
        try {
            const bareDriver =
                bareServer.drivers.aiSpeech2TxtXai as unknown as XAISpeechToTextDriver;
            await expect(
                bareDriver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ).rejects.toMatchObject({
                statusCode: 500,
                legacyCode: 'internal_error',
            });
        } finally {
            await bareServer.shutdown();
        }
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('XAISpeechToTextDriver credit gate', () => {
    it('throws 402 BEFORE hitting xAI when actor lacks credits', async () => {
        hasCreditsSpy.mockResolvedValueOnce(false);
        const { actor } = await makeUser();

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('audio-bytes'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('asks hasEnoughCredits for estimated seconds × per-second ucents', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        // 32000 bytes / 16000 bytes-per-second ⇒ 2s estimated.
        const audio = Buffer.alloc(32000, 0);
        await withActor(actor, () =>
            driver.transcribe({ file: dataUrl(audio, 'audio/mp3') }),
        );

        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(UCENTS_PER_SECOND * 2);
    });

    it('estimates 60 seconds for URL inputs (we cannot inspect size locally)', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        await withActor(actor, () =>
            driver.transcribe({ file: 'https://example.com/clip.mp3' }),
        );

        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(UCENTS_PER_SECOND * 60);
    });
});

// ── Audio input handling ────────────────────────────────────────────

describe('XAISpeechToTextDriver audio input handling', () => {
    it('decodes a base64 data URL and POSTs it as the multipart `file` field', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'hello world', duration: 1 }),
        );

        const audioBytes = Buffer.from('fake-mp3-bytes');
        await withActor(actor, () =>
            driver.transcribe({ file: dataUrl(audioBytes, 'audio/mp3') }),
        );

        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe('https://api.x.ai/v1/stt');
        const initObj = init as RequestInit;
        expect(initObj.method).toBe('POST');
        expect((initObj.headers as Record<string, string>).Authorization).toBe(
            'Bearer xai-test-key',
        );
        // multipart body — `file` is present, `url` is not.
        const form = initObj.body as FormData;
        expect(form).toBeInstanceOf(FormData);
        expect(form.get('url')).toBeNull();
        const filePart = form.get('file');
        expect(filePart).toBeInstanceOf(Blob);
        const blob = filePart as Blob;
        expect(blob.type).toBe('audio/mp3');
        const sent = Buffer.from(await blob.arrayBuffer());
        expect(sent.equals(audioBytes)).toBe(true);
    });

    it('forwards an HTTP(S) URL as the `url` field and skips local FS read', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        await withActor(actor, () =>
            driver.transcribe({ file: 'https://example.com/audio.mp3' }),
        );

        const form = (fetchSpy.mock.calls[0]![1] as RequestInit)
            .body as FormData;
        expect(form.get('url')).toBe('https://example.com/audio.mp3');
        expect(form.get('file')).toBeNull();
    });

    it('resolves an FS path through the live FSService and preserves filename/mime', async () => {
        const { actor, userId } = await makeUser();
        const audioBytes = Buffer.from('fs-backed-audio-data');
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: `/${actor.user.username}/clip.mp3`,
                size: audioBytes.byteLength,
                contentType: 'audio/mpeg',
            },
            fileContent: audioBytes,
        });

        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        await withActor(actor, () =>
            driver.transcribe({
                file: { path: `/${actor.user.username}/clip.mp3` },
            }),
        );

        const form = (fetchSpy.mock.calls[0]![1] as RequestInit)
            .body as FormData;
        const filePart = form.get('file') as File;
        expect(filePart).toBeInstanceOf(Blob);
        expect(filePart.type).toBe('audio/mpeg');
        // FormData.append(name, blob, filename) — Blob becomes a File with .name.
        expect(filePart.name).toBe('clip.mp3');
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('XAISpeechToTextDriver request shape', () => {
    it('forwards language / format / diarize / multichannel / channels / audio_format / sample_rate', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                language: 'en',
                format: true,
                diarize: true,
                multichannel: true,
                channels: 2,
                audio_format: 'pcm',
                sample_rate: 16000,
            }),
        );

        const form = (fetchSpy.mock.calls[0]![1] as RequestInit)
            .body as FormData;
        expect(form.get('language')).toBe('en');
        expect(form.get('format')).toBe('true');
        expect(form.get('diarize')).toBe('true');
        expect(form.get('multichannel')).toBe('true');
        expect(form.get('channels')).toBe('2');
        expect(form.get('audio_format')).toBe('pcm');
        expect(form.get('sample_rate')).toBe('16000');
    });

    it('omits optional fields when the caller does not supply them', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        );

        const form = (fetchSpy.mock.calls[0]![1] as RequestInit)
            .body as FormData;
        expect(form.get('language')).toBeNull();
        expect(form.get('format')).toBeNull();
        expect(form.get('diarize')).toBeNull();
        expect(form.get('multichannel')).toBeNull();
        expect(form.get('channels')).toBeNull();
        expect(form.get('audio_format')).toBeNull();
        expect(form.get('sample_rate')).toBeNull();
    });

    it('routes translate() to the same /v1/stt endpoint as transcribe()', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 1 }),
        );

        await withActor(actor, () =>
            driver.translate({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        );

        expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://api.x.ai/v1/stt');
    });
});

// ── Response shape ──────────────────────────────────────────────────

describe('XAISpeechToTextDriver response shape', () => {
    it('forwards the parsed xAI JSON response verbatim', async () => {
        const { actor } = await makeUser();
        const upstream = {
            text: 'hello world',
            language: 'English',
            duration: 2.5,
            words: [{ text: 'hello', start: 0, end: 1 }],
        };
        fetchSpy.mockResolvedValueOnce(sttResponse(upstream));

        const result = await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        );

        expect(result).toEqual(upstream);
    });
});

// ── Metering ────────────────────────────────────────────────────────

describe('XAISpeechToTextDriver metering', () => {
    it('meters ceil(duration) seconds × per-second ucents using the API duration', async () => {
        const { actor } = await makeUser();
        // Upstream reports 3.2s → driver should ceil to 4s.
        fetchSpy.mockResolvedValueOnce(
            sttResponse({ text: 'ok', duration: 3.2 }),
        );

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        );

        const sttCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === 'xai:stt:second',
        );
        expect(sttCalls).toHaveLength(1);
        const [actorArg, , count, cost] = sttCalls[0]!;
        expect((actorArg as Actor).user.id).toBe(actor.user.id);
        expect(count).toBe(4);
        expect(cost).toBe(UCENTS_PER_SECOND * 4);
    });

    it('falls back to the byte-based estimate when the API omits duration', async () => {
        const { actor } = await makeUser();
        // 32000 bytes → estimated 2s; upstream omits `duration`.
        fetchSpy.mockResolvedValueOnce(sttResponse({ text: 'ok' }));

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.alloc(32000, 0), 'audio/mp3'),
            }),
        );

        const sttCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === 'xai:stt:second',
        );
        expect(sttCalls).toHaveLength(1);
        const [, , count, cost] = sttCalls[0]!;
        expect(count).toBe(2);
        expect(cost).toBe(UCENTS_PER_SECOND * 2);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('XAISpeechToTextDriver error paths', () => {
    it('maps upstream 4xx to HttpError 400 upstream_bad_request and skips metering', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response('bad request', { status: 400 }),
        );

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 5xx to HttpError 400 upstream_provider_unavailable', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(new Response('oops', { status: 503 }));

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_provider_unavailable',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 401/403 to HttpError 500 upstream_auth_failed', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response('forbidden', { status: 403 }),
        );

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 500,
            legacyCode: 'upstream_auth_failed',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 429 to HttpError 429 upstream_rate_limited', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response('slow down', { status: 429 }),
        );

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'upstream_rate_limited',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('tags upstream errors with provider=xai and the original status', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response('boom', { status: 502 }),
        );

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({
            fields: { provider: 'xai', upstreamStatus: 502 },
        });
    });

    it('lets fetch network errors bubble so the driver boundary can decide', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockRejectedValueOnce(new Error('connection reset'));

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toThrow('connection reset');
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
