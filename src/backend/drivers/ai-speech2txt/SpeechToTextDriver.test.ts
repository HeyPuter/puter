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
 * Offline unit tests for SpeechToTextDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) configured with an OpenAI API key, then drives
 * `server.drivers.aiSpeech2Txt` directly. The OpenAI SDK is mocked at
 * the module boundary — that's the real network egress point — so the
 * driver never reaches OpenAI. Audio inputs use `data:` URLs through
 * the live `loadFileInput`, and the FS-resolution branch is exercised
 * by writing a real file via `server.services.fs.write`. Aligns with
 * AGENTS.md: "Prefer test server over mocking deps."
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
import type { SpeechToTextDriver } from './SpeechToTextDriver.js';
import { SPEECH_TO_TEXT_COSTS } from './costs.js';

// ── OpenAI SDK mock ─────────────────────────────────────────────────
//
// The driver does `import OpenAI, { toFile } from 'openai'` and then
// calls `audio.transcriptions.create` / `audio.translations.create`.
// Mock the constructor + `toFile` so the driver never actually issues
// a network request and we can inspect the payload it would have sent.

const {
    transcriptionsCreateMock,
    translationsCreateMock,
    openAICtor,
    toFileMock,
} = vi.hoisted(() => ({
    transcriptionsCreateMock: vi.fn(),
    translationsCreateMock: vi.fn(),
    openAICtor: vi.fn(),
    // Capture the (buffer, filename, options) handed to `toFile` and
    // return a sentinel object so we can assert it was forwarded as
    // `payload.file` to the OpenAI call. Real toFile builds a multipart
    // FileLike which would otherwise leak into the assertions.
    toFileMock: vi.fn(
        async (
            buffer: unknown,
            filename: string,
            options?: { type?: string },
        ) => ({
            __mockFile: true,
            buffer,
            filename,
            type: options?.type,
        }),
    ),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.audio = {
            transcriptions: { create: transcriptionsCreateMock },
            translations: { create: translationsCreateMock },
            // Sibling TTS provider in the same PuterServer constructs
            // its own OpenAI client during boot — keep that namespace
            // populated so the boot doesn't crash on missing fields.
            speech: { create: vi.fn() },
        };
        this.chat = { completions: { create: vi.fn() } };
        this.images = { generate: vi.fn() };
        this.responses = { create: vi.fn() };
    });
    // Two consumer shapes coexist in the codebase:
    //   - `import OpenAI from 'openai'; new OpenAI(...)`            (this driver)
    //   - `import openai from 'openai'; new openai.OpenAI(...)`     (Ollama chat)
    // The default export has to satisfy both, so attach `.OpenAI` onto
    // the constructor itself before returning.
    (OpenAICtor as unknown as { OpenAI: unknown }).OpenAI = OpenAICtor;
    return {
        OpenAI: OpenAICtor,
        default: OpenAICtor,
        toFile: toFileMock,
    };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: SpeechToTextDriver;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'openai-speech-to-text': { apiKey: 'openai-test-key' },
        },
    } as never);
    driver = server.drivers.aiSpeech2Txt as unknown as SpeechToTextDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    transcriptionsCreateMock.mockReset();
    translationsCreateMock.mockReset();
    openAICtor.mockReset();
    toFileMock.mockClear();
    // Spy on metering — keep the real impl so its recording side runs,
    // but capture calls so per-test assertions can inspect them.
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `stt-${Math.random().toString(36).slice(2, 10)}`;
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

// ── getReportedCosts ────────────────────────────────────────────────

describe('SpeechToTextDriver.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-second line item', () => {
        const reported = driver.getReportedCosts();

        expect(reported).toHaveLength(Object.keys(SPEECH_TO_TEXT_COSTS).length);
        for (const [usageType, ucentsPerUnit] of Object.entries(
            SPEECH_TO_TEXT_COSTS,
        )) {
            expect(reported).toContainEqual({
                usageType,
                ucentsPerUnit,
                unit: 'second',
                source: 'driver:aiSpeech2Txt',
            });
        }
    });
});

// ── list_models ─────────────────────────────────────────────────────

describe('SpeechToTextDriver.list_models', () => {
    it('returns the full catalog with response_formats and capability flags', async () => {
        const models = await driver.list_models();
        const ids = models.map((m) => m.id);

        expect(ids).toEqual(
            expect.arrayContaining([
                'gpt-4o-mini-transcribe',
                'gpt-4o-transcribe',
                'gpt-4o-transcribe-diarize',
                'whisper-1',
            ]),
        );

        const miniTranscribe = models.find(
            (m) => m.id === 'gpt-4o-mini-transcribe',
        )!;
        expect(miniTranscribe.type).toBe('transcription');
        expect(miniTranscribe.supports_prompt).toBe(true);
        expect(miniTranscribe.supports_logprobs).toBe(true);
        expect(miniTranscribe.response_formats).toEqual(['json', 'text']);

        // whisper-1 is the only one we classify as "translation" since
        // it's the default model the driver picks for translate().
        const whisper = models.find((m) => m.id === 'whisper-1')!;
        expect(whisper.type).toBe('translation');
        expect(whisper.response_formats).toEqual(
            expect.arrayContaining(['json', 'text', 'srt', 'verbose_json', 'vtt']),
        );
        expect(
            (whisper as { supports_timestamp_granularities?: boolean })
                .supports_timestamp_granularities,
        ).toBe(true);

        const diarize = models.find(
            (m) => m.id === 'gpt-4o-transcribe-diarize',
        )!;
        expect(diarize.supports_prompt).toBe(false);
        expect(diarize.supports_logprobs).toBe(false);
        expect(
            (diarize as { supports_diarization?: boolean }).supports_diarization,
        ).toBe(true);
        expect(diarize.response_formats).toContain('diarized_json');
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('SpeechToTextDriver.transcribe test_mode', () => {
    it('returns the canned sample for transcribe, bypassing all I/O', async () => {
        const result = (await driver.transcribe({
            file: undefined,
            test_mode: true,
        })) as { text: string; model: string; language: string };

        expect(result.text).toMatch(/sample transcription/i);
        expect(result.language).toBe('en');
        // No file required, no actor required, no SDK / metering hit.
        expect(transcriptionsCreateMock).not.toHaveBeenCalled();
        expect(translationsCreateMock).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
        expect(result.model).toBe('gpt-4o-mini-transcribe');
    });

    it('returns the canned sample for translate with whisper-1 default', async () => {
        const result = (await driver.translate({
            file: undefined,
            test_mode: true,
        })) as { text: string; model: string };
        expect(result.model).toBe('whisper-1');
        expect(translationsCreateMock).not.toHaveBeenCalled();
    });

    it('echoes an explicit model in test_mode rather than the default', async () => {
        const result = (await driver.transcribe({
            file: undefined,
            test_mode: true,
            model: 'whisper-1',
        })) as { model: string };
        expect(result.model).toBe('whisper-1');
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('SpeechToTextDriver argument validation', () => {
    it('rejects streaming with 400 — not yet supported', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                    stream: true,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(transcriptionsCreateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when file is missing', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.transcribe({ file: undefined })),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 on an unknown model', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                    model: 'totally-not-real',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(transcriptionsCreateMock).not.toHaveBeenCalled();
    });

    it('throws 400 when response_format is not supported by the chosen model', async () => {
        const { actor } = await makeUser();
        // `srt` is whisper-only — not in the gpt-4o-mini-transcribe catalog.
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                    model: 'gpt-4o-mini-transcribe',
                    response_format: 'srt',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when prompt is supplied to a model that does not support it', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                    model: 'gpt-4o-transcribe-diarize',
                    prompt: 'context',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when logprobs is requested on a model that does not support it', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                    model: 'whisper-1',
                    logprobs: true,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('SpeechToTextDriver credit gate', () => {
    it('throws 402 BEFORE hitting OpenAI when actor lacks credits', async () => {
        hasCreditsSpy.mockResolvedValueOnce(false);
        const { actor } = await makeUser();

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('audio-bytes'), 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        expect(transcriptionsCreateMock).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// ── Audio input handling ────────────────────────────────────────────

describe('SpeechToTextDriver audio input handling', () => {
    it('decodes a base64 data URL and forwards the raw buffer to OpenAI', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({
            text: 'hello world',
        });

        const audioBytes = Buffer.from('fake-mp3-bytes');
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(audioBytes, 'audio/mp3'),
            }),
        );

        // toFile got the decoded buffer + mime type from the data URL.
        expect(toFileMock).toHaveBeenCalledTimes(1);
        const [toFileBuf, , toFileOpts] = toFileMock.mock.calls[0]!;
        expect(Buffer.isBuffer(toFileBuf)).toBe(true);
        expect((toFileBuf as Buffer).equals(audioBytes)).toBe(true);
        expect(toFileOpts).toEqual({ type: 'audio/mp3' });

        // That sentinel is what got forwarded as `payload.file`.
        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.file).toEqual({
            __mockFile: true,
            buffer: audioBytes,
            filename: expect.any(String),
            type: 'audio/mp3',
        });
    });

    it('resolves an FS path through the live FSService and preserves the filename', async () => {
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

        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'ok' });

        await withActor(actor, () =>
            driver.transcribe({
                file: { path: `/${actor.user.username}/clip.mp3` },
            }),
        );

        const [, toFileName, toFileOpts] = toFileMock.mock.calls[0]!;
        expect(toFileName).toBe('clip.mp3');
        expect(toFileOpts).toEqual({ type: 'audio/mpeg' });
    });

    it('rejects audio above the 25 MB cap via loadFileInput (413 storage_limit_reached)', async () => {
        const { actor } = await makeUser();
        // 25 MiB + 1 byte → exceeds MAX_AUDIO_FILE_SIZE; loadFileInput throws
        // 413 from assertMax (not 400 — this is a payload-size error, not a
        // bad request).
        const huge = Buffer.alloc(25 * 1024 * 1024 + 1, 0);
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(huge, 'audio/mp3'),
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 413 });
        expect(transcriptionsCreateMock).not.toHaveBeenCalled();
    });
});

// ── Model selection / payload shape ─────────────────────────────────

describe('SpeechToTextDriver model selection and payload shape', () => {
    it('defaults transcribe() to gpt-4o-mini-transcribe', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.model).toBe('gpt-4o-mini-transcribe');
        // translate endpoint must not be touched.
        expect(translationsCreateMock).not.toHaveBeenCalled();
    });

    it('defaults translate() to whisper-1 and hits the translations endpoint', async () => {
        const { actor } = await makeUser();
        translationsCreateMock.mockResolvedValueOnce({ text: 'x' });

        await withActor(actor, () =>
            driver.translate({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
            }),
        );

        const sent = translationsCreateMock.mock.calls[0]![0];
        expect(sent.model).toBe('whisper-1');
        expect(transcriptionsCreateMock).not.toHaveBeenCalled();
    });

    it('forwards optional fields (language, prompt, logprobs, temperature)', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
                language: 'en',
                prompt: 'transcribe this carefully',
                logprobs: true,
                temperature: 0.2,
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.language).toBe('en');
        expect(sent.prompt).toBe('transcribe this carefully');
        expect(sent.logprobs).toBe(true);
        expect(sent.temperature).toBe(0.2);
    });

    it('forwards timestamp_granularities only on whisper-1 (the model that supports it)', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'whisper-1',
                response_format: 'verbose_json',
                timestamp_granularities: ['word'],
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.timestamp_granularities).toEqual(['word']);
    });

    it('passes extra_body through verbatim for non-diarize models', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
                extra_body: { custom: 'value' },
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.extra_body).toEqual({ custom: 'value' });
    });
});

// ── Diarization branch ──────────────────────────────────────────────

describe('SpeechToTextDriver diarization handling', () => {
    it('defaults response_format to diarized_json on the diarize model', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ segments: [] });

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-transcribe-diarize',
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.response_format).toBe('diarized_json');
    });

    it('auto-enables chunking_strategy when estimated duration exceeds 30s', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ segments: [] });

        // estimatedSeconds = ceil(bytes / 16000); 16000 * 31 = 496000 bytes
        // → 31s > 30s threshold → driver sets chunking_strategy = 'auto'.
        const longAudio = Buffer.alloc(16000 * 31, 0);
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(longAudio, 'audio/mp3'),
                model: 'gpt-4o-transcribe-diarize',
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.chunking_strategy).toBe('auto');
    });

    it('does NOT auto-enable chunking_strategy for short audio', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ segments: [] });

        // 16000 bytes = 1s estimated → below the 30s threshold.
        const shortAudio = Buffer.from('short');
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(shortAudio, 'audio/mp3'),
                model: 'gpt-4o-transcribe-diarize',
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.chunking_strategy).toBeUndefined();
    });

    it('packs known_speaker_names / known_speaker_references into extra_body', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ segments: [] });

        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-transcribe-diarize',
                known_speaker_names: ['Alice', 'Bob'],
                known_speaker_references: ['ref1', 'ref2'],
                extra_body: { keep_me: true },
            }),
        );

        const sent = transcriptionsCreateMock.mock.calls[0]![0];
        expect(sent.extra_body).toEqual({
            keep_me: true,
            known_speaker_names: ['Alice', 'Bob'],
            known_speaker_references: ['ref1', 'ref2'],
        });
    });
});

// ── Response shape ──────────────────────────────────────────────────

describe('SpeechToTextDriver response shape', () => {
    it('returns a raw string when response_format=text and OpenAI yields a string', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce(
            'just the plain text transcript',
        );

        const result = await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
                response_format: 'text',
            }),
        );

        expect(result).toBe('just the plain text transcript');
    });

    it('extracts .text when response_format=text but OpenAI returns an object', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({
            text: 'extracted from object',
        });

        const result = await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
                response_format: 'text',
            }),
        );

        expect(result).toBe('extracted from object');
    });

    it('forwards the OpenAI object verbatim for non-text response formats', async () => {
        const { actor } = await makeUser();
        const upstream = {
            text: 'hello world',
            language: 'en',
            duration: 1.5,
            segments: [{ id: 0, text: 'hello' }],
        };
        transcriptionsCreateMock.mockResolvedValueOnce(upstream);

        const result = await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
            }),
        );

        expect(result).toBe(upstream);
    });
});

// ── Metering ────────────────────────────────────────────────────────

describe('SpeechToTextDriver metering', () => {
    it('meters estimated seconds × per-model ucents from costs.ts', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        // estimatedSeconds = max(1, ceil(bytes / 16000)). 32000 bytes → 2s.
        const audio = Buffer.alloc(32000, 0);
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(audio, 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
            }),
        );

        const usageType = 'openai:gpt-4o-mini-transcribe:second';
        const perSecond = SPEECH_TO_TEXT_COSTS[usageType];
        const sttCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === usageType,
        );
        expect(sttCalls).toHaveLength(1);
        const [actorArg, , count, cost] = sttCalls[0]!;
        expect((actorArg as Actor).user.id).toBe(actor.user.id);
        expect(count).toBe(2);
        expect(cost).toBe(perSecond * 2);
    });

    it('clamps the metered duration to a minimum of one second', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        // 1-byte buffer → ceil(1/16000) = 1 → metered as 1 second.
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                model: 'whisper-1',
            }),
        );

        const usageType = 'openai:whisper-1:second';
        const sttCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === usageType,
        );
        expect(sttCalls).toHaveLength(1);
        const [, , count, cost] = sttCalls[0]!;
        expect(count).toBe(1);
        expect(cost).toBe(SPEECH_TO_TEXT_COSTS[usageType]);
    });

    it('asks hasEnoughCredits for the same total it later meters', async () => {
        const { actor } = await makeUser();
        transcriptionsCreateMock.mockResolvedValueOnce({ text: 'x' });

        const audio = Buffer.alloc(32000, 0);
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(audio, 'audio/mp3'),
                model: 'gpt-4o-mini-transcribe',
            }),
        );

        const usageType = 'openai:gpt-4o-mini-transcribe:second';
        const expected = SPEECH_TO_TEXT_COSTS[usageType] * 2;
        const creditCall = hasCreditsSpy.mock.calls[0]!;
        expect(creditCall[1]).toBe(expected);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('SpeechToTextDriver error paths', () => {
    it('propagates upstream OpenAI errors and does NOT meter when the call rejects', async () => {
        const { actor } = await makeUser();
        const sdkError = new Error('upstream blew up');
        transcriptionsCreateMock.mockRejectedValueOnce(sdkError);

        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.from('a'), 'audio/mp3'),
                }),
            ),
        ).rejects.toBe(sdkError);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
