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
 * Offline unit tests for the Gemini speech-to-text provider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis)
 * with a Gemini key and drives the unified `puter-speech2txt` driver, so
 * file loading, credit holds and usage recording run end to end. Global
 * `fetch` is stubbed with canned countTokens and Interactions replies, the
 * real network egress point.
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

import type { Actor } from '../../../../core/actor.js';
import { Context, runWithContext } from '../../../../core/context.js';
import { PuterServer } from '../../../../server.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { UsageInput } from '../../../../services/metering/types.js';
import { setupTestServer } from '../../../../testUtil.js';
import { generateDefaultFsentries } from '../../../../util/userProvisioning.js';
import { callerError } from '../../../integrationTestUtil.js';
import type { SpeechToTextDriver } from '../../SpeechToTextDriver.js';
import type { ITranscribeArgs } from '../../types.js';
import {
    GEMINI_COUNT_TOKENS_MAX_RESPONSE_BYTES,
    GEMINI_STT_MAX_AUDIO_BYTES,
    GEMINI_STT_MAX_RESPONSE_BYTES,
} from './GeminiSpeechToTextProvider.js';

const MODEL = 'gemini-3.5-transcribe';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const INTERACTIONS_URL = `${API_BASE}/interactions`;
const COUNT_TOKENS_URL = `${API_BASE}/models/${MODEL}:countTokens`;

// Mirrors the published rates: $2/M audio input, $12/M output and thinking.
const AUDIO_RATE = 200;
const OUTPUT_RATE = 1200;
const COUNTED_TOKENS = 91;
const HOLD = COUNTED_TOKENS * AUDIO_RATE + 8192 * OUTPUT_RATE;

// -- Test harness --

let server: PuterServer;
let sttDriver: SpeechToTextDriver;
let fetchSpy: MockInstance<typeof fetch>;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let batchSpy: MockInstance<MeteringService['batchIncrementUsages']>;

const driver = {
    transcribe: (args: Record<string, unknown> = {}) =>
        sttDriver.transcribe({ ...args, provider: 'gemini' } as ITranscribeArgs),
    translate: (args: Record<string, unknown> = {}) =>
        sttDriver.translate({ ...args, provider: 'gemini' } as ITranscribeArgs),
};

beforeAll(async () => {
    server = await setupTestServer({
        providers: { gemini: { apiKey: 'gemini-test-key' } },
    } as never);
    sttDriver = server.drivers.aiSpeech2Txt as unknown as SpeechToTextDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('unexpected fetch')) as MockInstance<
        typeof fetch
    >;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    batchSpy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `gemini-stt-${Math.random().toString(36).slice(2, 10)}`;
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

const AUDIO = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt fake-audio', 'latin1');
const dataUrl = (buffer: Buffer = AUDIO, mime = 'audio/wav') =>
    `data:${mime};base64,${buffer.toString('base64')}`;

const USAGE = {
    total_input_tokens: 72,
    input_tokens_by_modality: [
        { modality: 'audio', tokens: 71 },
        { modality: 'text', tokens: 1 },
    ],
    total_output_tokens: 6,
    total_thought_tokens: 0,
    total_tokens: 78,
};

const WORD_INFO = [
    ['The', '0.300s', '0.400s', 'spk:0'],
    ['blue', '0.400s', '0.700s', 'spk:0'],
    ['lantern', '0.700s', '1.200s', 'spk:1'],
].map(([text, start, end, speaker], i) => ({
    type: 'word_info',
    text,
    start_offset: start,
    end_offset: end,
    speaker,
    start_index: i,
    end_index: i + 1,
}));

const textBlock = (
    text = 'The blue lantern is ready.',
    annotations?: unknown[],
) => ({ type: 'text', text, ...(annotations ? { annotations } : {}) });

/** A completed reply; `usage` given as undefined leaves the field out. */
const interaction = (
    opts: {
        status?: string;
        content?: unknown[];
        steps?: unknown[];
        usage?: unknown;
    } = {},
) => ({
    status: opts.status ?? 'completed',
    steps: opts.steps ?? [
        { type: 'model_output', content: opts.content ?? [textBlock()] },
    ],
    ...('usage' in opts ? { usage: opts.usage } : { usage: USAGE }),
});

/** Queues the countTokens reply, then the Interactions reply. */
const reply = (
    body: unknown = interaction(),
    count: unknown = { totalTokens: COUNTED_TOKENS },
) => {
    fetchSpy
        .mockResolvedValueOnce(Response.json(count))
        .mockResolvedValueOnce(Response.json(body));
};

const sent = (call: number) => {
    const [url, init] = fetchSpy.mock.calls[call]!;
    return {
        url: String(url),
        method: init?.method,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
        signal: init?.signal,
    };
};

const metered = (): UsageInput[] =>
    batchSpy.mock.calls.flatMap(([, usages]) => usages);

/** Records each credit hold taken, its options, and its release. */
const trackHolds = (order: string[] = []) => {
    const metering = server.services.metering;
    const realReserve = metering.reserveCredits.bind(metering);
    const held: { amount: number; ttlMs?: number }[] = [];
    const released = vi.fn();
    vi.spyOn(metering, 'reserveCredits').mockImplementation(
        async (actor, amount, opts) => {
            held.push({ amount, ttlMs: opts?.ttlMs });
            const hold = await realReserve(actor, amount, opts);
            return {
                ...hold,
                release: async () => {
                    order.push('release');
                    released();
                    await hold.release();
                },
            };
        },
    );
    return { held, released };
};

/** A body that streams past `maxBytes` without declaring its length. */
const oversizedBody = (maxBytes: number) => {
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    let sentBytes = 0;
    return new Response(
        new ReadableStream({
            pull(controller) {
                if (sentBytes > maxBytes) {
                    controller.close();
                    return;
                }
                sentBytes += chunk.byteLength;
                controller.enqueue(chunk);
            },
        }),
    );
};

// -- Catalog and routing --

describe('GeminiSpeechToTextProvider catalog', () => {
    it('lists gemini-3.5-transcribe with its capabilities', async () => {
        expect(await sttDriver.list_models({ provider: 'gemini' })).toEqual([
            {
                id: MODEL,
                name: 'Gemini 3.5 Transcribe',
                type: 'transcription',
                response_formats: ['json', 'text'],
                supports_prompt: false,
                supports_logprobs: false,
                supports_diarization: true,
                supports_timestamp_granularities: true,
            },
        ]);
    });

    it('reports per-token audio input and text output rates', () => {
        expect(
            sttDriver
                .getReportedCosts()
                .filter((c) => c.source === 'driver:aiSpeech2Txt/gemini'),
        ).toEqual([
            {
                usageType: `gemini:${MODEL}:input:audio`,
                ucentsPerUnit: AUDIO_RATE,
                unit: 'token',
                source: 'driver:aiSpeech2Txt/gemini',
            },
            {
                usageType: `gemini:${MODEL}:output:text`,
                ucentsPerUnit: OUTPUT_RATE,
                unit: 'token',
                source: 'driver:aiSpeech2Txt/gemini',
            },
        ]);
    });
});

describe('GeminiSpeechToTextProvider routing without credentials', () => {
    let bare: PuterServer;
    let bareDriver: SpeechToTextDriver;

    beforeAll(async () => {
        bare = await setupTestServer();
        bareDriver = bare.drivers.aiSpeech2Txt as unknown as SpeechToTextDriver;
    });

    afterAll(async () => {
        await bare?.shutdown();
    });

    it('registers and lists the model without a key', async () => {
        expect(await bareDriver.list()).toContain('gemini');
        expect(
            (await bareDriver.list_models({ provider: 'google' })).map(
                (m) => m.id,
            ),
        ).toEqual([MODEL]);
        const all = await bareDriver.list_models({ provider: 'all' });
        expect(all).toContainEqual(
            expect.objectContaining({ id: MODEL, provider: 'gemini' }),
        );
    });

    it('keeps openai as the default', async () => {
        const ids = (await bareDriver.list_models()).map((m) => m.id);
        expect(ids).toContain('gpt-transcribe');
        expect(ids).not.toContain(MODEL);
        expect(
            await bareDriver.transcribe({ test_mode: true }),
        ).toMatchObject({ model: 'gpt-transcribe' });
    });

    it.each(['gemini', 'google', 'gemini-speech2txt', ' Gemini '])(
        'routes provider %s to gemini',
        async (provider) => {
            expect(
                await bareDriver.transcribe({ provider, test_mode: true }),
            ).toMatchObject({ model: MODEL });
            // The provider's own "not configured" rejection is the proof the
            // call was routed there rather than to OpenAI.
            await expect(
                bareDriver.transcribe({ provider, file: dataUrl() }),
            ).rejects.toMatchObject({
                statusCode: 500,
                message: 'Gemini API key not configured',
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );
});

describe('GeminiSpeechToTextProvider custom endpoint', () => {
    it('does not send a custom endpoint key directly to Google', async () => {
        const custom = await setupTestServer({
            providers: {
                gemini: {
                    apiKey: 'proxy-test-key',
                    apiBaseUrl: 'https://proxy.example/v1',
                },
            },
        } as never);
        try {
            await expect(custom.drivers.aiSpeech2Txt.transcribe({
                provider: 'gemini',
                file: dataUrl(),
            })).rejects.toMatchObject({
                statusCode: 500,
                message: 'Gemini transcription requires the Google endpoint',
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            await custom.shutdown();
        }
    });
});

// -- test_mode --

describe('GeminiSpeechToTextProvider test_mode', () => {
    it('returns sample text without file, actor, credits or network', async () => {
        const result = await driver.transcribe({ test_mode: true });
        expect(result).toEqual({
            text: expect.stringMatching(/sample transcription/i),
            model: MODEL,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('returns sample words, speakers and the supplied language when asked', async () => {
        const result = (await driver.transcribe({
            test_mode: true,
            language: 'en',
            timestamp_granularities: ['word'],
            diarize: true,
        })) as { language: string; words: { speaker?: string }[] };
        expect(result.language).toBe('en');
        expect(result.words.length).toBeGreaterThan(0);
        expect(result.words.every((w) => w.speaker === 'spk:0')).toBe(true);
    });

    it('returns the bare sample text for response_format text', async () => {
        const result = await driver.transcribe({
            test_mode: true,
            response_format: 'text',
        });
        expect(result).toMatch(/sample transcription/i);
    });
});

// -- Option validation --

describe('GeminiSpeechToTextProvider option validation', () => {
    it.each([
        ['prompt', 'context'],
        ['temperature', 0],
        ['logprobs', true],
        ['stream', true],
        ['chunking_strategy', 'auto'],
        ['known_speaker_names', ['agent']],
        ['extra_body', { custom: 1 }],
        ['format', true],
        ['multichannel', true],
        ['channels', 2],
        ['audio_format', 'pcm'],
        ['sample_rate', 16000],
    ])(
        'refuses %s even in test mode',
        async (key, value) => {
            for (const test_mode of [true, false]) {
                await expect(
                    driver.transcribe({
                        file: dataUrl(),
                        [key]: value,
                        test_mode,
                    }),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                    message: `${key} is not supported by Gemini transcription`,
                });
            }
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['an unknown model', { model: 'gemini-2.5-flash' }],
        ['an srt response_format', { response_format: 'srt' }],
        ['a segment granularity', { timestamp_granularities: ['segment'] }],
        ['granularities that are not an array', { timestamp_granularities: 'word' }],
        ['a non-boolean diarize', { diarize: 'yes' }],
        ['a malformed language', { language: 'english!' }],
        ['an empty language', { language: '' }],
    ])('refuses %s even in test mode', async (_label, args) => {
        await expect(
            driver.transcribe({ ...args, test_mode: true }),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts stream and logprobs set to false', async () => {
        expect(
            await driver.transcribe({
                stream: false,
                logprobs: false,
                test_mode: true,
            }),
        ).toMatchObject({ model: MODEL });
    });

    it('rejects translate, test mode included', async () => {
        for (const test_mode of [true, false]) {
            await expect(
                driver.translate({ file: dataUrl(), test_mode }),
            ).rejects.toMatchObject({
                statusCode: 400,
                message: 'Translation is not supported by Gemini transcription',
            });
        }
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Input loading --

describe('GeminiSpeechToTextProvider input', () => {
    it('throws 400 without a file and 401 without an actor', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.transcribe({})),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            driver.transcribe({ file: dataUrl() }),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects decoded audio over 10 MiB with 413 before any call', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.transcribe({
                    file: dataUrl(Buffer.alloc(GEMINI_STT_MAX_AUDIO_BYTES + 1)),
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'input_too_large',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each(['text/plain', 'video/webm', 'application/octet-stream'])(
        'rejects %s input as non-audio',
        async (mime) => {
            const { actor } = await makeUser();
            await expect(
                withActor(actor, () =>
                    driver.transcribe({ file: dataUrl(AUDIO, mime) }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it('rejects empty audio', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.transcribe({ file: 'data:audio/wav;base64,' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
        'audio/wav',
        'audio/mp3',
        'audio/mpeg',
        'audio/aiff',
        'audio/aac',
        'audio/ogg',
        'audio/flac',
        'audio/m4a',
        'audio/l16',
        'audio/opus',
        'audio/alaw',
        'audio/mulaw',
        'audio/webm',
    ])('sends %s audio as-is', async (mime) => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () =>
            driver.transcribe({ file: dataUrl(AUDIO, mime) }),
        );
        expect(sent(0).body.contents[0].parts[0].inlineData.mimeType).toBe(
            mime,
        );
        expect(sent(1).body.input[0].mime_type).toBe(mime);
    });

    it("reads the caller's own Puter file and forwards its MIME type", async () => {
        const { actor, userId } = await makeUser();
        const path = `/${actor.user.username}/clip.mp3`;
        await server.services.fs.write(userId, {
            fileMetadata: {
                path,
                size: AUDIO.byteLength,
                contentType: 'audio/mpeg',
            },
            fileContent: AUDIO,
        });
        reply();

        await withActor(actor, () => driver.transcribe({ file: { path } }));

        expect(sent(1).body.input).toEqual([
            {
                type: 'audio',
                mime_type: 'audio/mpeg',
                data: AUDIO.toString('base64'),
            },
        ]);
    });

    it("refuses another user's Puter file before calling Gemini", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const path = `/${owner.actor.user.username}/private.wav`;
        await server.services.fs.write(owner.userId, {
            fileMetadata: {
                path,
                size: AUDIO.byteLength,
                contentType: 'audio/wav',
            },
            fileContent: AUDIO,
        });

        const err = await withActor(intruder.actor, () =>
            driver.transcribe({ file: { path } }),
        ).then(
            () => null,
            (e: unknown) => e,
        );
        expect([403, 404]).toContain(
            (err as { statusCode?: number } | null)?.statusCode,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Request shape --

describe('GeminiSpeechToTextProvider request shape', () => {
    it('counts tokens, then sends an unstored unary interaction', async () => {
        const { actor } = await makeUser();
        reply();

        await withActor(actor, () =>
            driver.transcribe({ file: dataUrl(), model: MODEL }),
        );

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const count = sent(0);
        expect(count.url).toBe(COUNT_TOKENS_URL);
        expect(count.method).toBe('POST');
        expect(count.headers).toEqual({
            'x-goog-api-key': 'gemini-test-key',
            'Content-Type': 'application/json',
        });
        expect(count.body).toEqual({
            contents: [
                {
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'audio/wav',
                                data: AUDIO.toString('base64'),
                            },
                        },
                    ],
                },
            ],
        });

        const request = sent(1);
        expect(request.url).toBe(INTERACTIONS_URL);
        expect(request.headers['x-goog-api-key']).toBe('gemini-test-key');
        expect(request.body).toEqual({
            model: MODEL,
            input: [
                {
                    type: 'audio',
                    mime_type: 'audio/wav',
                    data: AUDIO.toString('base64'),
                },
            ],
            generation_config: { max_output_tokens: 8192 },
            store: false,
            background: false,
            stream: false,
        });
    });

    it('sends language codes and word timestamps without diarization', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(),
                language: 'en',
                timestamp_granularities: ['word'],
            }),
        );
        expect(sent(1).body.generation_config).toEqual({
            max_output_tokens: 8192,
            transcription_config: {
                language_codes: ['en'],
                mode: { type: 'verbatim', timestamp_granularities: ['word'] },
            },
        });
    });

    it('sends speaker diarization with word timestamps', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () =>
            driver.transcribe({ file: dataUrl(), diarize: true }),
        );
        expect(sent(1).body.generation_config).toEqual({
            max_output_tokens: 8192,
            transcription_config: {
                mode: {
                    type: 'verbatim',
                    diarization_mode: 'speaker',
                    timestamp_granularities: ['word'],
                },
            },
        });
    });

    it('bounds countTokens at 30 seconds and the transcription at 10 minutes', async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () => driver.transcribe({ file: dataUrl() }));
        expect(timeoutSpy).toHaveBeenCalledWith(30_000);
        expect(timeoutSpy).toHaveBeenCalledWith(600_000);
    });
});

// -- Response shape --

describe('GeminiSpeechToTextProvider response', () => {
    it('returns text and model, with no invented language or duration', async () => {
        const { actor } = await makeUser();
        reply();
        expect(
            await withActor(actor, () => driver.transcribe({ file: dataUrl() })),
        ).toEqual({ text: 'The blue lantern is ready.', model: MODEL });
    });

    it('echoes the supplied language', async () => {
        const { actor } = await makeUser();
        reply();
        expect(
            await withActor(actor, () =>
                driver.transcribe({ file: dataUrl(), language: 'en' }),
            ),
        ).toEqual({
            text: 'The blue lantern is ready.',
            model: MODEL,
            language: 'en',
        });
    });

    it('returns the bare transcript for response_format text', async () => {
        const { actor } = await makeUser();
        reply();
        expect(
            await withActor(actor, () =>
                driver.transcribe({ file: dataUrl(), response_format: 'text' }),
            ),
        ).toBe('The blue lantern is ready.');
    });

    it('maps word timings and speakers', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                content: [textBlock('The blue lantern', WORD_INFO)],
            }),
        );
        const result = await withActor(actor, () =>
            driver.transcribe({ file: dataUrl(), diarize: true }),
        );
        expect(result).toEqual({
            text: 'The blue lantern',
            model: MODEL,
            words: [
                { text: 'The', start: 0.3, end: 0.4, speaker: 'spk:0' },
                { text: 'blue', start: 0.4, end: 0.7, speaker: 'spk:0' },
                { text: 'lantern', start: 0.7, end: 1.2, speaker: 'spk:1' },
            ],
        });
    });

    it('omits speaker when Gemini sends none, and words when none were asked for', async () => {
        const { actor } = await makeUser();
        const unlabeled = WORD_INFO.map(({ speaker: _s, ...word }) => word);
        reply(interaction({ content: [textBlock('The', unlabeled)] }));
        reply(interaction({ content: [textBlock('The', WORD_INFO)] }));

        const withWords = (await withActor(actor, () =>
            driver.transcribe({
                file: dataUrl(),
                timestamp_granularities: ['word'],
            }),
        )) as { words: Record<string, unknown>[] };
        expect(withWords.words[0]).toEqual({ text: 'The', start: 0.3, end: 0.4 });

        expect(
            await withActor(actor, () => driver.transcribe({ file: dataUrl() })),
        ).not.toHaveProperty('words');
    });

    it('joins text across output blocks and skips thought steps', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                steps: [
                    { type: 'thought', content: [textBlock('thinking')] },
                    {
                        type: 'model_output',
                        content: [textBlock('The blue '), textBlock('lantern.')],
                    },
                ],
            }),
        );
        expect(
            await withActor(actor, () => driver.transcribe({ file: dataUrl() })),
        ).toMatchObject({ text: 'The blue lantern.' });
    });
});

// -- Upstream failures --

describe('GeminiSpeechToTextProvider upstream failures', () => {
    it.each(['incomplete', 'failed', 'cancelled', 'in_progress'])(
        'fails a %s interaction as 502 upstream_failed without charging',
        async (status) => {
            const { actor } = await makeUser();
            const { released } = trackHolds();
            reply(interaction({ status }));
            expect(
                await callerError(
                    () => driver.transcribe({ file: dataUrl() }),
                    actor,
                ),
            ).toMatchObject({ statusCode: 502, legacyCode: 'upstream_failed' });
            expect(released).toHaveBeenCalledTimes(1);
            expect(batchSpy).not.toHaveBeenCalled();
        },
    );

    it('fails a reply with no transcript text as 400 upstream_bad_request', async () => {
        const { actor } = await makeUser();
        reply(interaction({ content: [] }));
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['non-string text', [{ type: 'text', text: 7 }]],
        ['non-array annotations', [{ type: 'text', text: 'a', annotations: {} }]],
        [
            'an unparseable offset',
            [textBlock('a', [{ ...WORD_INFO[0], start_offset: '300ms' }])],
        ],
        [
            'an end before its start',
            [textBlock('a', [{ ...WORD_INFO[0], end_offset: '0.100s' }])],
        ],
        [
            'a non-string speaker',
            [textBlock('a', [{ ...WORD_INFO[0], speaker: 0 }])],
        ],
    ])('fails a transcript with %s as 502', async (_label, content) => {
        const { actor } = await makeUser();
        reply(interaction({ content }));
        expect(
            await callerError(
                () =>
                    driver.transcribe({
                        file: dataUrl(),
                        timestamp_granularities: ['word'],
                    }),
                actor,
            ),
        ).toMatchObject({
            statusCode: 502,
            message: 'Gemini transcription returned a malformed transcript',
        });
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('fails a non-JSON reply as 502', async () => {
        const { actor } = await makeUser();
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 91 }))
            .mockResolvedValueOnce(new Response('<html>oops</html>'));
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({
            statusCode: 502,
            message: 'Gemini transcription returned an unreadable response',
        });
    });

    it('stops reading a transcript reply over 2 MiB', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 91 }))
            .mockResolvedValueOnce(
                oversizedBody(GEMINI_STT_MAX_RESPONSE_BYTES),
            );
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
            message: `Gemini transcription response exceeds ${2 * 1024 * 1024} bytes`,
        });
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it.each([
        [400, 400, 'upstream_bad_request'],
        [401, 500, 'upstream_auth_failed'],
        [429, 429, 'upstream_rate_limited'],
        [503, 400, 'upstream_provider_unavailable'],
    ])(
        'maps an upstream %i to %i %s and releases the hold',
        async (upstreamStatus, statusCode, legacyCode) => {
            const { actor } = await makeUser();
            const { released } = trackHolds();
            fetchSpy
                .mockResolvedValueOnce(Response.json({ totalTokens: 91 }))
                .mockResolvedValueOnce(
                    Response.json(
                        { error: { code: upstreamStatus, message: 'Failed' } },
                        { status: upstreamStatus },
                    ),
                );
            expect(
                await callerError(
                    () => driver.transcribe({ file: dataUrl() }),
                    actor,
                ),
            ).toMatchObject({
                statusCode,
                legacyCode,
                fields: { provider: 'gemini', upstreamStatus },
            });
            expect(released).toHaveBeenCalledTimes(1);
            expect(batchSpy).not.toHaveBeenCalled();
        },
    );

    it('surfaces a transcription timeout as 504 and releases the hold', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 91 }))
            .mockRejectedValueOnce(
                new DOMException(
                    'The operation was aborted due to timeout',
                    'TimeoutError',
                ),
            );
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({ statusCode: 504, legacyCode: 'upstream_timeout' });
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('aborts the transcription when the caller disconnects, and releases the hold', async () => {
        const { actor } = await makeUser();
        const { released } = trackHolds();
        const abort = new AbortController();
        let upstreamSignal: AbortSignal | undefined;
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 91 }))
            .mockImplementationOnce(
                (_url, init) =>
                    new Promise((_resolve, reject) => {
                        upstreamSignal = init!.signal!;
                        upstreamSignal.addEventListener(
                            'abort',
                            () => reject(upstreamSignal!.reason),
                            { once: true },
                        );
                        abort.abort();
                    }),
            );

        await expect(
            withActor(actor, () => {
                Context.set('abortSignal', abort.signal);
                return driver.transcribe({ file: dataUrl() });
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(upstreamSignal?.aborted).toBe(true);
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('aborts countTokens when the caller has already disconnected', async () => {
        const { actor } = await makeUser();
        const { held } = trackHolds();
        const abort = new AbortController();
        abort.abort();
        fetchSpy.mockImplementationOnce(async (_url, init) => {
            init!.signal!.throwIfAborted();
            return Response.json({ totalTokens: 91 });
        });
        await expect(
            withActor(actor, () => {
                Context.set('abortSignal', abort.signal);
                return driver.transcribe({ file: dataUrl() });
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(held).toEqual([]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// -- countTokens preflight --

describe('GeminiSpeechToTextProvider countTokens preflight', () => {
    it.each([
        ['a missing count', {}],
        ['a zero count', { totalTokens: 0 }],
        ['a negative count', { totalTokens: -1 }],
        ['a fractional count', { totalTokens: 1.5 }],
        ['a string count', { totalTokens: '91' }],
        ['an unsafe count', { totalTokens: Number.MAX_SAFE_INTEGER }],
    ])(
        'fails %s as 502 before holding credit or transcribing',
        async (_label, count) => {
            const { actor } = await makeUser();
            const { held } = trackHolds();
            fetchSpy.mockResolvedValueOnce(Response.json(count));
            expect(
                await callerError(
                    () => driver.transcribe({ file: dataUrl() }),
                    actor,
                ),
            ).toMatchObject({
                statusCode: 502,
                message: 'Gemini token count returned an unusable count',
            });
            expect(held).toEqual([]);
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        },
    );

    it('maps a countTokens rejection and skips the transcription', async () => {
        const { actor } = await makeUser();
        const { held } = trackHolds();
        fetchSpy.mockResolvedValueOnce(
            Response.json(
                { error: { code: 400, message: 'Unsupported audio' } },
                { status: 400 },
            ),
        );
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(held).toEqual([]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('surfaces a countTokens timeout as 504', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockRejectedValueOnce(
            new DOMException(
                'The operation was aborted due to timeout',
                'TimeoutError',
            ),
        );
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({ statusCode: 504, legacyCode: 'upstream_timeout' });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('stops reading a countTokens reply over 64 KiB', async () => {
        const { actor } = await makeUser();
        fetchSpy.mockResolvedValueOnce(
            oversizedBody(GEMINI_COUNT_TOKENS_MAX_RESPONSE_BYTES),
        );
        expect(
            await callerError(() => driver.transcribe({ file: dataUrl() }), actor),
        ).toMatchObject({
            statusCode: 502,
            message: `Gemini token count response exceeds ${64 * 1024} bytes`,
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// -- Credit hold --

describe('GeminiSpeechToTextProvider credit hold', () => {
    it('throws 402 after counting tokens, before transcribing', async () => {
        const { actor } = await makeUser();
        hasCreditsSpy.mockResolvedValueOnce(false);
        fetchSpy.mockResolvedValueOnce(Response.json({ totalTokens: 91 }));
        await expect(
            withActor(actor, () => driver.transcribe({ file: dataUrl() })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(HOLD);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('holds counted audio plus 8192 output tokens for 11 minutes while Gemini runs', async () => {
        const { actor } = await makeUser();
        const { held } = trackHolds();
        let heldDuringCall = -1;
        fetchSpy
            .mockResolvedValueOnce(Response.json({ totalTokens: 91 }))
            .mockImplementationOnce(async () => {
                heldDuringCall = await server.stores.creditHold.outstanding(
                    actor.user.uuid,
                );
                return Response.json(interaction());
            });

        await withActor(actor, () => driver.transcribe({ file: dataUrl() }));

        expect(held).toEqual([{ amount: HOLD, ttlMs: 11 * 60 * 1000 }]);
        expect(heldDuringCall).toBe(HOLD);
        await vi.waitFor(async () =>
            expect(
                await server.stores.creditHold.outstanding(actor.user.uuid),
            ).toBe(0),
        );
    });

    it('records usage before releasing the hold', async () => {
        const { actor } = await makeUser();
        const order: string[] = [];
        trackHolds(order);
        batchSpy.mockRestore();
        const metering = server.services.metering;
        const realBatch = metering.batchIncrementUsages.bind(metering);
        vi.spyOn(metering, 'batchIncrementUsages').mockImplementation(
            async (...args) => {
                const result = await realBatch(...args);
                order.push('recorded');
                return result;
            },
        );
        reply();
        await withActor(actor, () => driver.transcribe({ file: dataUrl() }));
        expect(order).toEqual(['recorded', 'release']);
    });
});

// -- Usage settlement --

describe('GeminiSpeechToTextProvider usage', () => {
    it('charges audio input and text output, never the text input token', async () => {
        const { actor } = await makeUser();
        reply();
        await withActor(actor, () => driver.transcribe({ file: dataUrl() }));
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(metered()).toEqual([
            {
                usageType: `gemini:${MODEL}:input:audio`,
                usageAmount: 71,
                costOverride: 71 * AUDIO_RATE,
            },
            {
                usageType: `gemini:${MODEL}:output:text`,
                usageAmount: 6,
                costOverride: 6 * OUTPUT_RATE,
            },
        ]);
    });

    it('bills thinking at the output rate on top of the output total', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                usage: { ...USAGE, total_thought_tokens: 5, total_tokens: 83 },
            }),
        );
        await withActor(actor, () => driver.transcribe({ file: dataUrl() }));
        expect(metered()[1]).toEqual({
            usageType: `gemini:${MODEL}:output:text`,
            usageAmount: 11,
            costOverride: 11 * OUTPUT_RATE,
        });
    });

    it('sums repeated audio entries and treats missing thinking as none', async () => {
        const { actor } = await makeUser();
        reply(
            interaction({
                usage: {
                    total_input_tokens: 72,
                    input_tokens_by_modality: [
                        { modality: 'AUDIO', tokens: 40 },
                        { modality: 'audio', tokens: 31 },
                        { modality: 'text', tokens: 1 },
                    ],
                    total_output_tokens: 6,
                },
            }),
        );
        await withActor(actor, () => driver.transcribe({ file: dataUrl() }));
        expect(metered().map((u) => u.usageAmount)).toEqual([71, 6]);
    });

    it.each([
        ['missing usage', undefined],
        ['null usage', null],
        [
            'no modality breakdown',
            { total_input_tokens: 72, total_output_tokens: 6 },
        ],
        [
            'no audio modality',
            {
                total_input_tokens: 72,
                input_tokens_by_modality: [{ modality: 'text', tokens: 72 }],
                total_output_tokens: 6,
            },
        ],
        [
            'a negative audio count',
            {
                ...USAGE,
                input_tokens_by_modality: [{ modality: 'audio', tokens: -1 }],
            },
        ],
        [
            'a fractional count',
            {
                ...USAGE,
                input_tokens_by_modality: [{ modality: 'audio', tokens: 1.5 }],
            },
        ],
        [
            'a string count',
            {
                ...USAGE,
                input_tokens_by_modality: [{ modality: 'audio', tokens: '71' }],
            },
        ],
        ['audio over the input total', { ...USAGE, total_input_tokens: 70 }],
        [
            'a missing output total',
            { ...USAGE, total_output_tokens: undefined },
        ],
        ['a negative thinking count', { ...USAGE, total_thought_tokens: -1 }],
        [
            'an unsafe cost',
            {
                ...USAGE,
                total_input_tokens: Number.MAX_SAFE_INTEGER,
                input_tokens_by_modality: [
                    { modality: 'audio', tokens: Number.MAX_SAFE_INTEGER },
                ],
            },
        ],
        [
            'an overflowing sum',
            {
                ...USAGE,
                total_input_tokens: Number.MAX_SAFE_INTEGER,
                input_tokens_by_modality: [
                    { modality: 'audio', tokens: Number.MAX_SAFE_INTEGER },
                    { modality: 'audio', tokens: Number.MAX_SAFE_INTEGER },
                ],
            },
        ],
    ])(
        'fails %s as 502 without fabricating usage',
        async (_label, usage) => {
            const { actor } = await makeUser();
            const { released } = trackHolds();
            reply(interaction({ usage }));
            expect(
                await callerError(
                    () => driver.transcribe({ file: dataUrl() }),
                    actor,
                ),
            ).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
                message: 'Gemini transcription returned unusable usage',
            });
            expect(batchSpy).not.toHaveBeenCalled();
            expect(released).toHaveBeenCalledTimes(1);
        },
    );
});
