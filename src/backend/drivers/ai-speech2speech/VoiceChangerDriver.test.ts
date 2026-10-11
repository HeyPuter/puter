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
 * Offline unit tests for VoiceChangerDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) configured with an ElevenLabs API key, then drives
 * `server.drivers.aiSpeech2Speech` directly. ElevenLabs is reached
 * over plain `fetch` rather than an SDK, so we stub the global fetch
 * for provider calls. Web inputs use the live `loadFileInput` and
 * `secureFetch`, with undici mocked at the network boundary.
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
import type { VoiceChangerDriver } from './VoiceChangerDriver.js';
import { callerError, readStreamResult } from '../integrationTestUtil.js';
import { VOICE_CHANGER_COSTS } from './costs.js';

const { webFetchMock } = vi.hoisted(() => ({ webFetchMock: vi.fn() }));
vi.mock('undici', async (importOriginal) => ({
    ...(await importOriginal<typeof import('undici')>()),
    fetch: webFetchMock,
}));

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: VoiceChangerDriver;
let fetchSpy: MockInstance<typeof fetch>;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            elevenlabs: { apiKey: 'eleven-test-key' },
        },
    } as never);
    driver = server.drivers.aiSpeech2Speech as unknown as VoiceChangerDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    webFetchMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `vc-${Math.random().toString(36).slice(2, 10)}`;
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

const okResponse = (body: ArrayBuffer, contentType = 'audio/mpeg') =>
    new Response(body, {
        status: 200,
        headers: { 'content-type': contentType },
    });

// ── getReportedCosts ────────────────────────────────────────────────

describe('VoiceChangerDriver.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-second line item', () => {
        const reported = driver.getReportedCosts();
        expect(reported).toHaveLength(Object.keys(VOICE_CHANGER_COSTS).length);
        for (const [usageType, ucentsPerUnit] of Object.entries(
            VOICE_CHANGER_COSTS,
        )) {
            expect(reported).toContainEqual({
                usageType,
                ucentsPerUnit,
                unit: 'second',
                source: 'driver:aiSpeech2Speech',
            });
        }
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('VoiceChangerDriver.convert argument validation', () => {
    it('returns the canned sample when test_mode is set, bypassing all I/O', async () => {
        const result = await driver.convert({
            audio: undefined,
            test_mode: true,
        });
        expect(result).toMatchObject({
            url: expect.stringContaining('puter-sample-data'),
            content_type: 'audio/mpeg',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.convert({
                audio: dataUrl(Buffer.from('audio'), 'audio/mpeg'),
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 when audio is missing', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.convert({ audio: undefined })),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('VoiceChangerDriver.convert credit gate', () => {
    it('throws 402 BEFORE hitting ElevenLabs when the actor lacks credits', async () => {
        const { actor } = await makeUser();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withActor(actor, () =>
                driver.convert({
                    audio: dataUrl(Buffer.from('a'.repeat(64000)), 'audio/mpeg'),
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Successful conversion ───────────────────────────────────────────

describe('VoiceChangerDriver.convert success path', () => {
    it('POSTs to ElevenLabs with the configured api key, default voice + model, and forwards the audio stream', async () => {
        const { actor } = await makeUser();
        const replyBytes = new TextEncoder().encode('audio-bytes');
        fetchSpy.mockResolvedValueOnce(okResponse(replyBytes.buffer));

        const buf = Buffer.from('input-audio');
        const result = (await withActor(actor, () =>
            driver.convert({
                audio: dataUrl(buf, 'audio/mpeg'),
            }),
        )) as { dataType: string; content_type: string; stream: NodeJS.ReadableStream };

        // Driver hit the ElevenLabs endpoint with the configured key.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchSpy.mock.calls[0]!;
        expect(String(calledUrl)).toMatch(/api\.elevenlabs\.io/);
        expect(String(calledUrl)).toMatch(
            /\/v1\/speech-to-speech\/21m00Tcm4TlvDq8ikWAM/,
        );
        // Default mp3_44100_128 output format threaded through search params.
        expect(String(calledUrl)).toMatch(/output_format=mp3_44100_128/);
        expect(init?.method).toBe('POST');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect((init?.headers as Record<string, string>)['xi-api-key']).toBe(
            'eleven-test-key',
        );

        // Form data carries the model_id + audio blob.
        const form = init?.body as FormData;
        expect(form.get('model_id')).toBe('eleven_multilingual_sts_v2');
        expect(form.get('audio')).toBeInstanceOf(Blob);

        // Returned shape is a Node stream the controller can pipe.
        expect(result.dataType).toBe('stream');
        expect(result.content_type).toBe('audio/mpeg');
        expect(typeof result.stream.pipe).toBe('function');
    });

    it('honours an explicit voice + model override', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            okResponse(new ArrayBuffer(0), 'audio/mpeg'),
        );

        await withActor(actor, () =>
            driver.convert({
                audio: dataUrl(Buffer.from('x'), 'audio/mpeg'),
                voice_id: 'voice-XYZ',
                model_id: 'eleven_english_sts_v2',
            }),
        );

        const [calledUrl, init] = fetchSpy.mock.calls[0]!;
        expect(String(calledUrl)).toMatch(
            /\/v1\/speech-to-speech\/voice-XYZ/,
        );
        const form = init?.body as FormData;
        expect(form.get('model_id')).toBe('eleven_english_sts_v2');
    });

    it('forwards optional knobs (voice_settings, seed, remove_background_noise, file_format, optimize_streaming_latency)', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            okResponse(new ArrayBuffer(0), 'audio/mpeg'),
        );

        await withActor(actor, () =>
            driver.convert({
                audio: dataUrl(Buffer.from('x'), 'audio/mpeg'),
                voice_settings: { stability: 0.5 },
                seed: 42,
                remove_background_noise: true,
                file_format: 'pcm_s16le_16',
                optimize_streaming_latency: 3,
                enable_logging: false,
            }),
        );

        const [calledUrl, init] = fetchSpy.mock.calls[0]!;
        const form = init?.body as FormData;
        expect(form.get('voice_settings')).toBe(
            JSON.stringify({ stability: 0.5 }),
        );
        expect(form.get('seed')).toBe('42');
        expect(form.get('remove_background_noise')).toBe('true');
        expect(form.get('file_format')).toBe('pcm_s16le_16');
        expect(String(calledUrl)).toMatch(/optimize_streaming_latency=3/);
        expect(String(calledUrl)).toMatch(/enable_logging=false/);
    });

    it('holds the estimated cost while ElevenLabs runs and releases it afterwards', async () => {
        const { actor } = await makeUser();
        let heldDuringCall = -1;
        fetchSpy.mockImplementationOnce(async () => {
            heldDuringCall = await server.stores.creditHold.outstanding(
                actor.user.uuid,
            );
            return okResponse(new ArrayBuffer(8), 'audio/mpeg');
        });

        // 32 KB audio at 16 kbit/s = 2 seconds.
        await readStreamResult(
            await withActor(actor, () =>
                driver.convert({
                    audio: dataUrl(Buffer.alloc(32_000), 'audio/mpeg'),
                }),
            ),
        );

        const perSecond =
            VOICE_CHANGER_COSTS['elevenlabs:eleven_multilingual_sts_v2:second'];
        expect(heldDuringCall).toBe(perSecond * 2);
        await vi.waitFor(async () =>
            expect(
                await server.stores.creditHold.outstanding(actor.user.uuid),
            ).toBe(0),
        );
    });

    it('meters one usage line at the per-second rate from costs.ts', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            okResponse(new ArrayBuffer(8), 'audio/mpeg'),
        );

        // 32 KB audio at 16 kbit/s = 2 seconds rounded up.
        const buf = Buffer.alloc(32_000);
        await readStreamResult(
            await withActor(actor, () =>
                driver.convert({ audio: dataUrl(buf, 'audio/mpeg') }),
            ),
        );

        const usageType = 'elevenlabs:eleven_multilingual_sts_v2:second';
        const perSecond = VOICE_CHANGER_COSTS[usageType];
        const expectedSeconds = Math.max(1, Math.ceil(32_000 / 16000));

        const calls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === usageType,
        );
        expect(calls).toHaveLength(1);
        const [actorArg, , count, cost] = calls[0]!;
        expect((actorArg as Actor).user.id).toBe(actor.user.id);
        expect(count).toBe(expectedSeconds);
        expect(cost).toBe(perSecond * expectedSeconds);
    });

    it('meters nothing when ElevenLabs breaks off before any audio', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(new Error('connection reset'));
                    },
                }),
                { status: 200, headers: { 'content-type': 'audio/mpeg' } },
            ),
        );

        const result = await withActor(actor, () =>
            driver.convert({
                audio: dataUrl(Buffer.alloc(32_000), 'audio/mpeg'),
            }),
        );
        await expect(readStreamResult(result)).rejects.toThrow();

        expect(incrementUsageSpy).not.toHaveBeenCalled();
        await vi.waitFor(async () =>
            expect(
                await server.stores.creditHold.outstanding(actor.user.uuid),
            ).toBe(0),
        );
    });
});

// ── Error mapping ───────────────────────────────────────────────────

describe('VoiceChangerDriver.convert error mapping', () => {
    it('maps upstream 4xx to HttpError 400 upstream_bad_request', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response(
                JSON.stringify({ detail: 'voice not found' }),
                {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );

        expect(
            await callerError(
                () =>
                    driver.convert({
                        audio: dataUrl(Buffer.from('x'), 'audio/mpeg'),
                        voice_id: 'missing-voice',
                    }),
                actor,
            ),
        ).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            fields: { provider: 'elevenlabs', upstreamStatus: 404 },
        });

        // No metering should be recorded on a failed call.
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('maps upstream 5xx to HttpError 400 upstream_provider_unavailable (skips alert)', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            new Response('boom', { status: 503 }),
        );

        expect(
            await callerError(
                () =>
                    driver.convert({
                        audio: dataUrl(Buffer.from('x'), 'audio/mpeg'),
                        voice_id: 'any-voice',
                    }),
                actor,
            ),
        ).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_provider_unavailable',
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

describe('VoiceChangerDriver.convert file inputs', () => {
    it.each([
        ['audio/wav; charset=binary', undefined, 'audio/wav'],
        ['application/octet-stream', 'pcm_s16le_16', 'application/octet-stream'],
    ])(
        'loads HTTPS audio with MIME %s through secureFetch',
        async (contentType, fileFormat, expectedMime) => {
            const { actor } = await makeUser();
            const bytes = Buffer.from('remote-audio');
            webFetchMock.mockResolvedValueOnce(
                new Response(bytes, {
                    headers: { 'content-type': contentType },
                }),
            );
            fetchSpy.mockResolvedValueOnce(okResponse(new ArrayBuffer(0)));

            await withActor(actor, () =>
                driver.convert({
                    audio: 'https://audio.example/sample.wav',
                    file_format: fileFormat,
                }),
            );

            expect(webFetchMock).toHaveBeenCalledExactlyOnceWith(
                'https://audio.example/sample.wav',
                expect.objectContaining({
                    redirect: 'manual',
                    dispatcher: expect.anything(),
                }),
            );
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const form = fetchSpy.mock.calls[0]![1]?.body as FormData;
            const audio = form.get('audio') as File;
            expect(audio.name).toBe('sample.wav');
            expect(audio.type).toBe(expectedMime);
            expect(Buffer.from(await audio.arrayBuffer())).toEqual(bytes);
            expect(form.get('file_format')).toBe(fileFormat ?? null);
        },
    );

    it.each(['declared', 'streamed'])(
        'rejects %s HTTPS audio over 25 MiB before calling the provider',
        async (sizeSource) => {
            const { actor } = await makeUser();
            const maxBytes = 25 * 1024 * 1024;
            const cancel = vi.fn();
            let chunk = 0;
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    controller.enqueue(
                        new Uint8Array(chunk++ === 0 ? maxBytes : 1),
                    );
                },
                cancel,
            });
            webFetchMock.mockResolvedValueOnce(
                new Response(body, {
                    headers:
                        sizeSource === 'declared'
                            ? { 'content-length': String(maxBytes + 1) }
                            : {},
                }),
            );

            await expect(
                withActor(actor, () =>
                    driver.convert({
                        audio: 'https://audio.example/oversized.wav',
                    }),
                ),
            ).rejects.toMatchObject({
                statusCode: 413,
                legacyCode: 'input_too_large',
            });

            expect(cancel).toHaveBeenCalled();
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(incrementUsageSpy).not.toHaveBeenCalled();
        },
    );

    it.each(['https://127.0.0.1/audio.wav', 'https://localhost/audio.wav'])(
        'rejects blocked URL %s before any network call',
        async (audio) => {
            const { actor } = await makeUser();
            await expect(
                withActor(actor, () => driver.convert({ audio })),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect(webFetchMock).not.toHaveBeenCalled();
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(incrementUsageSpy).not.toHaveBeenCalled();
        },
    );

    it('rejects HTTPS redirects without calling the provider', async () => {
        const { actor } = await makeUser();
        webFetchMock.mockResolvedValueOnce(
            new Response(null, {
                status: 302,
                headers: { location: 'https://127.0.0.1/audio.wav' },
            }),
        );
        await expect(
            withActor(actor, () =>
                driver.convert({
                    audio: 'https://audio.example/redirect',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        expect(webFetchMock).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it.each(['path', 'data URL'])(
        'preserves %s audio inputs',
        async (inputType) => {
            const { actor, userId } = await makeUser();
            const bytes = Buffer.from('existing-audio');
            const path = `/${actor.user.username}/Documents/sample.wav`;
            if (inputType === 'path') {
                await withActor(actor, () =>
                    server.services.fs.write(userId, {
                        fileMetadata: {
                            path,
                            size: bytes.byteLength,
                            contentType: 'audio/wav',
                        },
                        fileContent: bytes,
                    }),
                );
            }
            fetchSpy.mockResolvedValueOnce(okResponse(new ArrayBuffer(0)));
            await withActor(actor, () =>
                driver.convert({
                    audio:
                        inputType === 'path'
                            ? path
                            : dataUrl(bytes, 'audio/wav'),
                }),
            );

            expect(webFetchMock).not.toHaveBeenCalled();
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const form = fetchSpy.mock.calls[0]![1]?.body as FormData;
            const audio = form.get('audio') as File;
            expect(audio.type).toBe('audio/wav');
            expect(Buffer.from(await audio.arrayBuffer())).toEqual(bytes);
        },
    );
});
