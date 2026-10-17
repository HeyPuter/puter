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
 * Offline unit tests for GeminiTTSProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock redis) and
 * constructs GeminiTTSProvider directly against the live wired
 * `MeteringService` so holds and recording run end-to-end. Global `fetch` is
 * stubbed with canned Interactions API responses, the real network egress
 * point.
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

import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { UsageInput } from '../../../../services/metering/types.js';
import { withAiCostFactor } from '../../../util/aiCostFactor.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { callerError, withTestActor } from '../../../integrationTestUtil.js';
import {
    GEMINI_TTS_MAX_RESPONSE_BYTES,
    GeminiTTSProvider,
} from './GeminiTTSProvider.js';
import { GEMINI_TTS_COSTS, GEMINI_TTS_LAUNCH_PRICING_ENDS } from './costs.js';

const INTERACTIONS_URL =
    'https://generativelanguage.googleapis.com/v1beta/interactions';

// -- Test harness --

let server: PuterServer;
let fetchSpy: MockInstance<typeof fetch>;
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

/** Metering as `TTSDriver` hands it to its providers. */
const aiMetering = () =>
    withAiCostFactor(server.services.metering, server.clients.event, 'ai-tts');

const makeProvider = () =>
    new GeminiTTSProvider(aiMetering(), { apiKey: 'test-key' });

/** A RIFF/WAVE container as the Interactions API returns it. */
const WAV_BYTES = (() => {
    const wav = Buffer.alloc(64, 7);
    wav.write('RIFF', 0, 'latin1');
    wav.writeUInt32LE(56, 4);
    wav.write('WAVE', 8, 'latin1');
    wav.write('fmt ', 12, 'latin1');
    return wav;
})();

const audioBlock = (
    bytes: Buffer = WAV_BYTES,
    mimeType: string = 'audio/wav',
) => ({ type: 'audio', mime_type: mimeType, data: bytes.toString('base64') });

const USAGE = {
    total_input_tokens: 7,
    input_tokens_by_modality: [{ modality: 'text', tokens: 7 }],
    total_output_tokens: 68,
    output_tokens_by_modality: [{ modality: 'audio', tokens: 68 }],
    total_thought_tokens: 0,
    total_tokens: 75,
};

/** What `USAGE` settles to on the default model at launch rates. */
const SETTLED_USAGE = [
    {
        usageType: 'gemini:gemini-3.8-flash-tts:input',
        usageAmount: 7,
        costOverride: 7 * 50,
    },
    {
        usageType: 'gemini:gemini-3.8-flash-tts:output:audio',
        usageAmount: 68,
        costOverride: 68 * 900,
    },
];

/** µ¢ held for the full 8,192 input and 16,384 audio token budget. */
const reservation = (inputRate: number, audioRate: number) =>
    8192 * inputRate + 16_384 * audioRate;

/** The default model's hold at launch rates. */
const FLASH_RESERVATION = reservation(50, 900);

/** A completed reply; `usage` given as undefined leaves the field out. */
const interaction = (
    opts: {
        content?: unknown[];
        status?: string;
        usage?: unknown;
        steps?: unknown[];
    } = {},
) => ({
    model: 'gemini-3.8-flash-tts',
    status: opts.status ?? 'completed',
    steps: opts.steps ?? [
        { type: 'model_output', content: opts.content ?? [audioBlock()] },
    ],
    ...('usage' in opts ? { usage: opts.usage } : { usage: USAGE }),
});

const replyWith = (body: unknown, init?: ResponseInit) =>
    fetchSpy.mockResolvedValueOnce(Response.json(body, init));

/** What the provider sent to the Interactions API. */
const sentRequest = (call = 0) => {
    const [url, init] = fetchSpy.mock.calls[call]!;
    return {
        url: String(url),
        method: init?.method,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
        signal: init?.signal,
    };
};

const readAll = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
};

const meteredUsages = (): UsageInput[] =>
    batchIncrementUsagesSpy.mock.calls.flatMap(([, usages]) => usages);

const metered = (suffix: string) =>
    meteredUsages().find((u) => u.usageType.endsWith(suffix))!;

/** A user the gate really holds credit for, unlike the system actor. */
const payingUser = () =>
    ({
        user: {
            uuid: `gemini-tts-${Math.random().toString(36).slice(2)}`,
            username: 'gemini-tts-user',
            email: 'gemini-tts@test.com',
        },
    }) as never;

/** Spies on the credit holds taken, recording the amount and each release. */
const trackHolds = () => {
    const metering = server.services.metering;
    const realReserve = metering.reserveCredits.bind(metering);
    const held: number[] = [];
    const released = vi.fn();
    vi.spyOn(metering, 'reserveCredits').mockImplementation(
        async (actor, amount, opts) => {
            held.push(amount);
            const hold = await realReserve(actor, amount, opts);
            return {
                ...hold,
                release: async () => {
                    released();
                    await hold.release();
                },
            };
        },
    );
    return { held, released };
};

beforeEach(() => {
    // The full flash hold at later rates exceeds the system actor's allowance;
    // tests of later rates set the clock themselves.
    vi.useFakeTimers({
        toFake: ['Date'],
        now: GEMINI_TTS_LAUNCH_PRICING_ENDS - 1,
    });
    fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('unexpected fetch')) as MockInstance<
        typeof fetch
    >;
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    batchIncrementUsagesSpy = vi.spyOn(
        server.services.metering,
        'batchIncrementUsages',
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// -- Construction --

describe('GeminiTTSProvider construction', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new GeminiTTSProvider(aiMetering(), {
                    apiKey: '',
                }),
        ).toThrow(/API key/i);
    });
});

// -- Voice / engine catalog --

describe('GeminiTTSProvider catalog', () => {
    it('listVoices returns the documented Gemini voices with provider=gemini', async () => {
        const voices = await makeProvider().listVoices();
        expect(voices.length).toBeGreaterThan(0);
        for (const voice of voices) {
            expect(voice.provider).toBe('gemini');
        }
        expect(voices.find((v) => v.id === 'Kore')).toBeDefined();
        expect(voices[0].supported_models).toEqual([
            'gemini-3.8-flash-tts',
            'gemini-3.8-flash-lite-tts',
        ]);
    });

    it('listEngines returns both models with provider=gemini', async () => {
        const engines = await makeProvider().listEngines();
        expect(engines.map((e) => e.id)).toEqual([
            'gemini-3.8-flash-tts',
            'gemini-3.8-flash-lite-tts',
        ]);
    });
});

// -- Reported costs --

describe('GeminiTTSProvider.getReportedCosts', () => {
    const reportedRates = () =>
        Object.fromEntries(
            makeProvider()
                .getReportedCosts()
                .map((r) => [
                    r.usageType,
                    [r.ucentsInputPerToken, r.ucentsOutputAudioPerToken],
                ]),
        );

    it('reports the launch rates through 2026-12-31 UTC', () => {
        vi.useFakeTimers({
            toFake: ['Date'],
            now: GEMINI_TTS_LAUNCH_PRICING_ENDS - 1,
        });
        expect(reportedRates()).toEqual({
            'gemini:gemini-3.8-flash-tts:tts': [50, 900],
            'gemini:gemini-3.8-flash-lite-tts:tts': [50, 600],
        });
    });

    it('reports doubled rates from 2027-01-01 UTC, read at call time', () => {
        vi.useFakeTimers({
            toFake: ['Date'],
            now: GEMINI_TTS_LAUNCH_PRICING_ENDS - 1,
        });
        const provider = makeProvider();
        provider.getReportedCosts();
        vi.setSystemTime(GEMINI_TTS_LAUNCH_PRICING_ENDS);
        expect(
            Object.fromEntries(
                provider
                    .getReportedCosts()
                    .map((r) => [
                        r.usageType,
                        [r.ucentsInputPerToken, r.ucentsOutputAudioPerToken],
                    ]),
            ),
        ).toEqual({
            'gemini:gemini-3.8-flash-tts:tts': [100, 1800],
            'gemini:gemini-3.8-flash-lite-tts:tts': [100, 1200],
        });
    });

    it('labels each line as a token rate from this driver', () => {
        for (const entry of makeProvider().getReportedCosts()) {
            expect(entry).toMatchObject({
                unit: 'token',
                source: 'driver:aiTts/gemini',
            });
        }
    });
});

// -- test_mode bypass --

describe('GeminiTTSProvider.synthesize test_mode', () => {
    it('returns the canned sample URL without credits or network', async () => {
        const result = await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi', test_mode: true }),
        );
        expect(result).toEqual({
            url: 'https://puter-sample-data.puter.site/tts_example.mp3',
            content_type: 'audio',
        });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Argument validation --

describe('GeminiTTSProvider.synthesize argument validation', () => {
    it.each([
        'gemini-2.5-flash-preview-tts',
        'gemini-2.5-pro-preview-tts',
        'gemini-3.1-flash-tts-preview',
        'gemini-fake',
    ])('rejects the unlisted model %s with 400', async (model) => {
        await expect(
            withTestActor(() =>
                makeProvider().synthesize({ text: 'hi', model }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

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

    it('throws 400 when the voice is not in the catalog', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().synthesize({ text: 'hi', voice: 'NotAVoice' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws 400 when instructions is not a string', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().synthesize({
                    text: 'hi',
                    instructions: { style: 'calm' } as never,
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'field_invalid',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts text of exactly 3000 characters', async () => {
        const text = 'x'.repeat(3000);
        replyWith(interaction());
        await withTestActor(() => makeProvider().synthesize({ text }));
        expect(sentRequest().body.input[0].content[0].text).toBe(text);
    });

    it('rejects text over 3000 characters with 400 input_too_large before holding credit', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().synthesize({ text: 'x'.repeat(3001) }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'input_too_large',
            fields: { key: 'text', max: 3000 },
        });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts instructions of exactly 3000 characters', async () => {
        const instructions = 'x'.repeat(3000);
        replyWith(interaction());
        await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi', instructions }),
        );
        expect(
            sentRequest().body.input[0].content[0].annotations[0].style,
        ).toBe(instructions);
    });

    it('rejects instructions over 3000 characters with 400 input_too_large before holding credit', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().synthesize({
                    text: 'hi',
                    instructions: 'x'.repeat(3001),
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'input_too_large',
            fields: { key: 'instructions', max: 3000 },
        });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Credit gate --

describe('GeminiTTSProvider.synthesize credit gate', () => {
    it('throws 402 before calling Gemini when the actor lacks credits', async () => {
        hasCreditsSpy.mockResolvedValueOnce(false);
        await expect(
            withTestActor(() => makeProvider().synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    /** Leaves `actor` exactly `available` µ¢ to commit by holding the rest. */
    const leaveAvailable = async (actor: never, available: number) => {
        const metering = server.services.metering;
        const remaining = await metering.getRemainingUsage(actor);
        expect(remaining).toBeGreaterThan(available);
        return metering.reserveCredits(actor, remaining - available);
    };

    it.each([
        ['covers the usage of a short text', 1_000_000],
        ['is one µ¢ short of the full budget', FLASH_RESERVATION - 1],
    ])(
        'refuses with 402 before calling Gemini when available credit %s',
        async (_label, available) => {
            const actor = payingUser();
            const blocking = await leaveAvailable(actor, available);
            try {
                await expect(
                    withTestActor(
                        () => makeProvider().synthesize({ text: 'hi' }),
                        actor,
                    ),
                ).rejects.toMatchObject({ statusCode: 402 });
                expect(hasCreditsSpy).toHaveBeenCalledWith(
                    actor,
                    FLASH_RESERVATION,
                );
                expect(fetchSpy).not.toHaveBeenCalled();
                expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
                expect(
                    await server.services.metering.getRemainingUsage(actor),
                ).toBe(available);
            } finally {
                await blocking.release();
            }
        },
    );

    it('runs with exactly the full budget available, then releases all but the reported usage', async () => {
        const actor = payingUser();
        const blocking = await leaveAvailable(actor, FLASH_RESERVATION);
        try {
            replyWith(interaction());
            await withTestActor(
                () => makeProvider().synthesize({ text: 'hi' }),
                actor,
            );

            expect(meteredUsages()).toEqual(SETTLED_USAGE);
            await expect
                .poll(() => server.services.metering.getRemainingUsage(actor))
                .toBe(FLASH_RESERVATION - 7 * 50 - 68 * 900);
        } finally {
            await blocking.release();
        }
    });
});

// -- Request shape --

describe('GeminiTTSProvider.synthesize request shape', () => {
    it.each(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'])(
        'sends %s the text verbatim and the instructions as speech metadata',
        async (model) => {
            const text = '  Hello,\nworld. Read me exactly.  ';
            replyWith(interaction());

            await withTestActor(() =>
                makeProvider().synthesize({
                    text,
                    model,
                    voice: 'Zephyr',
                    instructions: 'Speak softly, like a librarian.',
                }),
            );

            const sent = sentRequest();
            expect(sent.url).toBe(INTERACTIONS_URL);
            expect(sent.method).toBe('POST');
            expect(sent.headers).toEqual({
                'x-goog-api-key': 'test-key',
                'Content-Type': 'application/json',
            });
            expect(sent.body).toEqual({
                model,
                input: [
                    {
                        type: 'user_input',
                        content: [
                            {
                                type: 'text',
                                text,
                                annotations: [
                                    {
                                        type: 'speech_metadata',
                                        style: 'Speak softly, like a librarian.',
                                    },
                                ],
                            },
                        ],
                    },
                ],
                response_format: { type: 'audio' },
                generation_config: {
                    speech_config: [{ voice: 'Zephyr' }],
                    max_output_tokens: 16_384,
                },
                store: false,
                background: false,
                stream: false,
            });
        },
    );

    it.each(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'])(
        'caps %s output at the 16,384 audio tokens it holds credit for',
        async (model) => {
            replyWith(interaction());
            await withTestActor(() =>
                makeProvider().synthesize({ text: 'hi', model }),
            );
            expect(
                sentRequest().body.generation_config.max_output_tokens,
            ).toBe(16_384);
        },
    );

    it('omits annotations without instructions and defaults to flash/Kore', async () => {
        replyWith(interaction());
        replyWith(interaction());
        const provider = makeProvider();

        await withTestActor(() => provider.synthesize({ text: 'hello' }));
        await withTestActor(() =>
            provider.synthesize({ text: 'hello', instructions: '   ' }),
        );

        for (const call of [0, 1]) {
            const { body } = sentRequest(call);
            expect(body.model).toBe('gemini-3.8-flash-tts');
            expect(body.input[0].content).toEqual([
                { type: 'text', text: 'hello' },
            ]);
            expect(body.generation_config.speech_config).toEqual([
                { voice: 'Kore' },
            ]);
        }
    });

    it.each([
        ['kore', 'Kore'],
        ['ZEPHYR', 'Zephyr'],
        ['sadAlTager', 'Sadaltager'],
    ])(
        'accepts voice %s case-insensitively and sends canonical %s',
        async (requested, canonical) => {
            replyWith(interaction());
            await withTestActor(() =>
                makeProvider().synthesize({ text: 'hi', voice: requested }),
            );
            expect(sentRequest().body.generation_config.speech_config).toEqual([
                { voice: canonical },
            ]);
        },
    );

    it('bounds the call with the 2-minute TTS deadline', async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
        replyWith(interaction());
        await withTestActor(() => makeProvider().synthesize({ text: 'hi' }));
        expect(timeoutSpy).toHaveBeenCalledWith(120_000);
    });
});

// -- Audio output --

describe('GeminiTTSProvider.synthesize audio output', () => {
    it('streams WAV audio through byte for byte', async () => {
        replyWith(interaction());

        const result = (await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi' }),
        )) as { stream: Readable; content_type: string; chunked: boolean };

        expect(result.content_type).toBe('audio/wav');
        expect(result.chunked).toBe(true);
        expect(result.stream).toBeInstanceOf(Readable);
        expect(await readAll(result.stream)).toEqual(WAV_BYTES);
    });

    it('wraps raw L16 PCM in a WAV header at the declared rate', async () => {
        const pcm = Buffer.from('PCM-PAYLOAD');
        replyWith(
            interaction({
                content: [audioBlock(pcm, 'audio/L16;codec=pcm;rate=16000')],
            }),
        );

        const result = (await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi' }),
        )) as { stream: Readable; content_type: string };

        expect(result.content_type).toBe('audio/wav');
        const wav = await readAll(result.stream);
        expect(wav.length).toBe(44 + pcm.length);
        expect(wav.subarray(0, 4).toString()).toBe('RIFF');
        expect(wav.subarray(8, 12).toString()).toBe('WAVE');
        expect(wav.readUInt32LE(24)).toBe(16_000);
        expect(wav.subarray(44)).toEqual(pcm);
    });

    it('wraps PCM without a declared rate at 24 kHz', async () => {
        replyWith(
            interaction({
                content: [audioBlock(Buffer.from('pcm'), 'audio/pcm')],
            }),
        );
        const result = (await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi' }),
        )) as { stream: Readable };
        expect((await readAll(result.stream)).readUInt32LE(24)).toBe(24_000);
    });

    it('returns the last audio block across steps and parts', async () => {
        const first = Buffer.from(WAV_BYTES);
        first.write('first', 50, 'latin1');
        const last = Buffer.from(WAV_BYTES);
        last.write('last!', 50, 'latin1');
        replyWith(
            interaction({
                steps: [
                    {
                        type: 'thought',
                        content: [audioBlock(Buffer.from('x'))],
                    },
                    {
                        type: 'model_output',
                        content: [
                            { type: 'text', text: 'note' },
                            audioBlock(first),
                        ],
                    },
                    {
                        type: 'model_output',
                        content: [
                            audioBlock(last),
                            { type: 'text', text: 'end' },
                        ],
                    },
                ],
            }),
        );

        const result = (await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi' }),
        )) as { stream: Readable };
        expect(await readAll(result.stream)).toEqual(last);
    });
});

// -- Upstream failures --

describe('GeminiTTSProvider.synthesize upstream failures', () => {
    it.each([['failed'], ['cancelled'], ['incomplete'], ['in_progress']])(
        'charges the reported usage once, then fails a %s interaction as 502 upstream_failed',
        async (status) => {
            const { released } = trackHolds();
            replyWith(interaction({ status }));

            const err = await callerError(
                () => makeProvider().synthesize({ text: 'hi' }),
                payingUser(),
            );

            expect(err).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
            });
            expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
            expect(meteredUsages()).toEqual(SETTLED_USAGE);
            expect(released).toHaveBeenCalledTimes(1);
        },
    );

    it('charges the reported usage once, then fails a refusal (text only) as 400 upstream_bad_request', async () => {
        const { released } = trackHolds();
        replyWith(
            interaction({
                content: [{ type: 'text', text: 'I cannot read that.' }],
            }),
        );

        const err = await callerError(
            () => makeProvider().synthesize({ text: 'hi' }),
            payingUser(),
        );

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        expect(meteredUsages()).toEqual(SETTLED_USAGE);
        expect(released).toHaveBeenCalledTimes(1);
    });

    const FAILED_REPLIES: [
        string,
        { status?: string; content?: unknown[] },
        number,
    ][] = [
        ['a failed interaction', { status: 'failed' }, 502],
        [
            'a refusal',
            { content: [{ type: 'text', text: 'I cannot read that.' }] },
            400,
        ],
        [
            'malformed audio',
            { content: [{ type: 'audio', mime_type: 'audio/wav', data: '' }] },
            502,
        ],
    ];

    it.each(FAILED_REPLIES)(
        'charges nothing for %s without usage, and releases the hold',
        async (_label, opts, statusCode) => {
            const { released } = trackHolds();
            replyWith(interaction({ ...opts, usage: undefined }));

            const err = await callerError(
                () => makeProvider().synthesize({ text: 'hi' }),
                payingUser(),
            );

            expect(err).toMatchObject({ statusCode });
            expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
            expect(released).toHaveBeenCalledTimes(1);
        },
    );

    it.each(FAILED_REPLIES)(
        'charges only the input for %s whose output total has no audio breakdown',
        async (_label, opts, statusCode) => {
            const { released } = trackHolds();
            replyWith(
                interaction({
                    ...opts,
                    usage: { total_input_tokens: 7, total_output_tokens: 68 },
                }),
            );

            const err = await callerError(
                () => makeProvider().synthesize({ text: 'hi' }),
                payingUser(),
            );

            expect(err).toMatchObject({ statusCode });
            expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
            expect(meteredUsages()).toEqual([SETTLED_USAGE[0]]);
            expect(released).toHaveBeenCalledTimes(1);
        },
    );

    it.each(FAILED_REPLIES)(
        'charges only the input for %s when only the input count is usable',
        async (_label, opts, statusCode) => {
            const { released } = trackHolds();
            replyWith(
                interaction({
                    ...opts,
                    usage: {
                        input_tokens_by_modality: [
                            { modality: 'text', tokens: 7 },
                        ],
                        output_tokens_by_modality: [
                            { modality: 'audio', tokens: -1 },
                        ],
                    },
                }),
            );

            const err = await callerError(
                () => makeProvider().synthesize({ text: 'hi' }),
                payingUser(),
            );

            expect(err).toMatchObject({ statusCode });
            expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
            expect(meteredUsages()).toEqual([SETTLED_USAGE[0]]);
            expect(released).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        ['no data', { type: 'audio', mime_type: 'audio/wav' }],
        [
            'a URI instead of inline data',
            {
                type: 'audio',
                mime_type: 'audio/wav',
                uri: 'https://generativelanguage.googleapis.com/files/abc',
            },
        ],
        ['empty data', { type: 'audio', mime_type: 'audio/wav', data: '' }],
        [
            'invalid base64',
            { type: 'audio', mime_type: 'audio/wav', data: '***not base64***' },
        ],
        ['no MIME type', { type: 'audio', data: WAV_BYTES.toString('base64') }],
        ['an unsupported MIME type', audioBlock(WAV_BYTES, 'audio/mpeg')],
        [
            'WAV bytes without a RIFF header',
            audioBlock(Buffer.alloc(64, 1), 'audio/wav'),
        ],
        ['empty PCM', audioBlock(Buffer.alloc(0), 'audio/L16;rate=24000')],
    ])(
        'charges the reported usage once, then fails an audio block with %s as 502 upstream_failed',
        async (_label, block) => {
            replyWith(interaction({ content: [block] }));
            await expect(
                withTestActor(() => makeProvider().synthesize({ text: 'hi' })),
            ).rejects.toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
            });
            // Never follows a provider URI.
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
            expect(meteredUsages()).toEqual(SETTLED_USAGE);
        },
    );

    it('fails a non-JSON reply as 502 upstream_failed', async () => {
        fetchSpy.mockResolvedValueOnce(new Response('<html>oops</html>'));
        await expect(
            withTestActor(() => makeProvider().synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
        });
    });

    it.each([
        [400, 400, 'upstream_bad_request'],
        [404, 400, 'upstream_bad_request'],
        [401, 500, 'upstream_auth_failed'],
        [429, 429, 'upstream_rate_limited'],
        [500, 400, 'upstream_provider_unavailable'],
        [503, 400, 'upstream_provider_unavailable'],
    ])(
        'maps an upstream %i to %i %s and releases the hold',
        async (upstreamStatus, statusCode, legacyCode) => {
            const { released } = trackHolds();
            replyWith(
                {
                    error: {
                        code: upstreamStatus,
                        message: 'Request failed',
                        status: 'SOME_STATUS',
                    },
                },
                { status: upstreamStatus },
            );

            const err = await callerError(
                () => makeProvider().synthesize({ text: 'hi' }),
                payingUser(),
            );

            expect(err).toMatchObject({
                statusCode,
                legacyCode,
                fields: { provider: 'gemini', upstreamStatus },
            });
            expect(released).toHaveBeenCalledTimes(1);
            expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
        },
    );

    it('charges the held budget for a transport timeout and says how to avoid it', async () => {
        const { held, released } = trackHolds();
        fetchSpy.mockRejectedValueOnce(
            new DOMException(
                'The operation was aborted due to timeout',
                'TimeoutError',
            ),
        );

        const err = await callerError(
            () => makeProvider().synthesize({ text: 'hi' }),
            payingUser(),
        );

        expect(err).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
            message: expect.stringContaining('Split the text'),
        });
        expect(released).toHaveBeenCalledTimes(1);
        expect(metered(':input').usageAmount).toBe(8192);
        expect(metered(':output:audio').usageAmount).toBe(16_384);
        expect(
            meteredUsages().reduce((sum, u) => sum + u.costOverride!, 0),
        ).toBe(held[0]);
    });

    it('surfaces a body that times out mid-read as 504 upstream_timeout', async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('{"st'));
                        controller.error(
                            new DOMException(
                                'The operation was aborted due to timeout',
                                'TimeoutError',
                            ),
                        );
                    },
                }),
            ),
        );

        const err = await callerError(() =>
            makeProvider().synthesize({ text: 'hi' }),
        );

        expect(err).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
    });

    it('stops reading a reply over the size cap, charges the held budget and says how to avoid it', async () => {
        const { released } = trackHolds();
        const chunk = new Uint8Array(1024 * 1024).fill(0x20);
        let sent = 0;
        fetchSpy.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    pull(controller) {
                        if (sent > GEMINI_TTS_MAX_RESPONSE_BYTES) {
                            controller.close();
                            return;
                        }
                        sent += chunk.byteLength;
                        controller.enqueue(chunk);
                    },
                }),
            ),
        );

        const err = await callerError(
            () => makeProvider().synthesize({ text: 'hi' }),
            payingUser(),
        );

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'input_too_large',
            message: expect.stringContaining('Split the text'),
        });
        expect(sent).toBeLessThanOrEqual(
            GEMINI_TTS_MAX_RESPONSE_BYTES + 2 ** 20,
        );
        expect(released).toHaveBeenCalledTimes(1);
        expect(metered(':output:audio').usageAmount).toBe(16_384);
    });

    it('reads a reply big enough for the whole audio budget', () => {
        // ~25 tokens/s of 24 kHz 16-bit PCM, base64-encoded.
        const seconds = 16_384 / 25;
        const base64Bytes = Math.ceil((seconds * 24_000 * 2) / 3) * 4;
        expect(GEMINI_TTS_MAX_RESPONSE_BYTES).toBeGreaterThan(base64Bytes);
    });

    it('aborts the upstream call when the caller disconnects, and releases the hold', async () => {
        const { released } = trackHolds();
        const abort = new AbortController();
        let upstreamSignal: AbortSignal | undefined;
        fetchSpy.mockImplementationOnce(
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
            withTestActor(() => {
                Context.set('abortSignal', abort.signal);
                return makeProvider().synthesize({ text: 'hi' });
            }, payingUser()),
        ).rejects.toMatchObject({ name: 'AbortError' });

        expect(upstreamSignal?.aborted).toBe(true);
        expect(released).toHaveBeenCalledTimes(1);
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});

// -- Metering --

describe('GeminiTTSProvider.synthesize metering', () => {
    it.each([
        ['gemini-3.8-flash-tts', 900],
        ['gemini-3.8-flash-lite-tts', 600],
    ])(
        'meters %s text input and audio output from the usage modalities',
        async (model, audioRate) => {
            replyWith(interaction());

            await withTestActor(() =>
                makeProvider().synthesize({
                    text: 'hi',
                    model,
                    instructions: 'Calm',
                }),
            );

            expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
            expect(meteredUsages()).toEqual([
                {
                    usageType: `gemini:${model}:input`,
                    usageAmount: 7,
                    costOverride: 7 * 50,
                },
                {
                    usageType: `gemini:${model}:output:audio`,
                    usageAmount: 68,
                    costOverride: 68 * audioRate,
                },
            ]);
        },
    );

    it('sums repeated modality entries', async () => {
        replyWith(
            interaction({
                usage: {
                    input_tokens_by_modality: [
                        { modality: 'TEXT', tokens: 3 },
                        { modality: 'text', tokens: 4 },
                    ],
                    output_tokens_by_modality: [
                        { modality: 'audio', tokens: 40 },
                        { modality: 'audio', tokens: 28 },
                    ],
                },
            }),
        );
        await withTestActor(() => makeProvider().synthesize({ text: 'hi' }));
        expect(metered(':input').usageAmount).toBe(7);
        expect(metered(':output:audio').usageAmount).toBe(68);
    });

    it('uses the aggregate totals when audio comes back without a modality breakdown', async () => {
        replyWith(
            interaction({
                usage: { total_input_tokens: 9, total_output_tokens: 80 },
            }),
        );
        await withTestActor(() => makeProvider().synthesize({ text: 'hi' }));
        expect(metered(':input').usageAmount).toBe(9);
        expect(metered(':output:audio').usageAmount).toBe(80);
    });

    it.each([
        ['missing usage', undefined],
        ['null usage', null],
        [
            'unsafe aggregate counts',
            {
                input_tokens_by_modality: [
                    { modality: 'text', tokens: Number.MAX_SAFE_INTEGER },
                    { modality: 'text', tokens: Number.MAX_SAFE_INTEGER },
                ],
                output_tokens_by_modality: [
                    { modality: 'audio', tokens: Number.MAX_SAFE_INTEGER },
                    { modality: 'audio', tokens: Number.MAX_SAFE_INTEGER },
                ],
            },
        ],
        [
            'unsafe token costs',
            {
                total_input_tokens: Number.MAX_SAFE_INTEGER,
                total_output_tokens: Number.MAX_SAFE_INTEGER,
            },
        ],
        [
            'negative counts',
            {
                input_tokens_by_modality: [{ modality: 'text', tokens: -1 }],
                output_tokens_by_modality: [{ modality: 'audio', tokens: -5 }],
            },
        ],
        [
            'fractional and string counts',
            {
                input_tokens_by_modality: [{ modality: 'text', tokens: 1.5 }],
                output_tokens_by_modality: [
                    { modality: 'audio', tokens: '68' },
                ],
            },
        ],
        [
            'non-finite totals',
            { total_input_tokens: Infinity, total_output_tokens: NaN },
        ],
        [
            'a breakdown that lacks the billed modality',
            {
                total_input_tokens: 7,
                input_tokens_by_modality: [{ modality: 'image', tokens: 7 }],
                total_output_tokens: 68,
                output_tokens_by_modality: [{ modality: 'text', tokens: 68 }],
            },
        ],
        ['reported zeros', { total_input_tokens: 0, total_output_tokens: 0 }],
    ])(
        'charges nothing on %s and fails the audio as 502 upstream_failed',
        async (_label, usage) => {
            const { released } = trackHolds();
            replyWith(interaction({ usage }));

            const err = await callerError(
                () =>
                    makeProvider().synthesize({
                        text: 'hello there',
                        instructions: 'Speak softly',
                    }),
                payingUser(),
            );

            expect(err).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
            });
            expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
            expect(released).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        [
            'input',
            {
                total_input_tokens: 7,
                output_tokens_by_modality: [{ modality: 'audio', tokens: -1 }],
            },
            [SETTLED_USAGE[0]],
        ],
        [
            'audio',
            {
                total_input_tokens: 'seven',
                output_tokens_by_modality: [{ modality: 'audio', tokens: 68 }],
            },
            [SETTLED_USAGE[1]],
        ],
    ])(
        'charges only the readable %s count once, then fails the audio as 502 upstream_failed',
        async (_label, usage, settled) => {
            const { released } = trackHolds();
            replyWith(interaction({ usage }));

            const err = await callerError(
                () => makeProvider().synthesize({ text: 'hi' }),
                payingUser(),
            );

            expect(err).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
            });
            expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
            expect(meteredUsages()).toEqual(settled);
            expect(released).toHaveBeenCalledTimes(1);
        },
    );

    it('charges a reported zero as nothing, with no one-token minimum', async () => {
        replyWith(
            interaction({
                status: 'failed',
                usage: {
                    total_input_tokens: 7,
                    output_tokens_by_modality: [
                        { modality: 'audio', tokens: 0 },
                    ],
                },
            }),
        );

        await callerError(() => makeProvider().synthesize({ text: 'hi' }));
        expect(meteredUsages()).toEqual([SETTLED_USAGE[0]]);
    });

    const TEXTS: [string, string][] = [
        ['short spaced text', 'hi'],
        ['long spaced English', 'Read me. '.repeat(333)],
        ['long unspaced Latin', 'a'.repeat(3000)],
        ['unspaced Chinese', '你好世界'.repeat(750)],
        ['unspaced Japanese', 'こんにちは世界'.repeat(428)],
        ['unspaced Thai', 'สวัสดีครับ'.repeat(300)],
        ['emoji', '😀'.repeat(1500)],
    ];
    const RESERVATION_CASES: [string, string, string | undefined][] =
        TEXTS.flatMap(([label, text]) => [
            [`${label} without instructions`, text, undefined],
            [`${label} with maximum instructions`, text, '慢'.repeat(3000)],
        ]);

    it.each(RESERVATION_CASES)(
        'holds the full token budget for %s and settles only the reported usage',
        async (_label, text, instructions) => {
            const { held, released } = trackHolds();
            replyWith(interaction());

            await withTestActor(
                () => makeProvider().synthesize({ text, instructions }),
                payingUser(),
            );

            expect(held).toEqual([FLASH_RESERVATION]);
            expect(meteredUsages()).toEqual(SETTLED_USAGE);
            await expect.poll(() => released.mock.calls.length).toBe(1);
        },
    );
});

// -- Scheduled rates --

describe('GeminiTTSProvider.synthesize scheduled rates', () => {
    const BEFORE = GEMINI_TTS_LAUNCH_PRICING_ENDS - 1;
    const AT = GEMINI_TTS_LAUNCH_PRICING_ENDS;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'], now: BEFORE });
    });

    const SCHEDULE: [string, number, number, number, number][] = [
        ['gemini-3.8-flash-tts', BEFORE, 50, 900, 15_155_200],
        ['gemini-3.8-flash-tts', AT, 100, 1800, 30_310_400],
        ['gemini-3.8-flash-lite-tts', BEFORE, 50, 600, 10_240_000],
        ['gemini-3.8-flash-lite-tts', AT, 100, 1200, 20_480_000],
    ];

    it.each(SCHEDULE)(
        'holds and meters %s started at %i at %i/%i µ¢ per token',
        async (model, startedAt, inputRate, audioRate, reserved) => {
            vi.setSystemTime(startedAt);
            const { held } = trackHolds();
            replyWith(interaction());

            await withTestActor(
                () => makeProvider().synthesize({ text: 'hi', model }),
                payingUser(),
            );

            expect(held).toEqual([reserved]);
            expect(reservation(inputRate, audioRate)).toBe(reserved);
            expect(metered(':input').costOverride).toBe(7 * inputRate);
            expect(metered(':output:audio').costOverride).toBe(68 * audioRate);
        },
    );

    it.each(SCHEDULE)(
        'holds and meters %s started at %i at its AI cost factor',
        async (model, startedAt, inputRate, audioRate, reserved) => {
            vi.setSystemTime(startedAt);
            const { held } = trackHolds();
            const factor = (_key: string, event: { factor: number }) => {
                event.factor = 1.5;
            };
            server.clients.event.on('ai.cost.factor.*', factor);
            replyWith(interaction());
            try {
                await withTestActor(
                    () => makeProvider().synthesize({ text: 'hi', model }),
                    payingUser(),
                );
            } finally {
                server.clients.event.off('ai.cost.factor.*', factor);
            }

            expect(hasCreditsSpy).toHaveBeenCalledWith(
                expect.anything(),
                reserved * 1.5,
            );
            expect(held).toEqual([reserved * 1.5]);
            expect(metered(':input').costOverride).toBe(7 * inputRate * 1.5);
            expect(metered(':output:audio').costOverride).toBe(
                68 * audioRate * 1.5,
            );
        },
    );

    it('settles a request that crosses the change at the rates it was held at', async () => {
        const { held } = trackHolds();
        fetchSpy.mockImplementationOnce(async () => {
            vi.setSystemTime(AT);
            return Response.json(interaction());
        });

        await withTestActor(
            () => makeProvider().synthesize({ text: 'hi' }),
            payingUser(),
        );

        expect(held).toEqual([FLASH_RESERVATION]);
        expect(metered(':input').costOverride).toBe(7 * 50);
        expect(metered(':output:audio').costOverride).toBe(68 * 900);
    });

    it('throws 500 when no cost data exists for the resolved model', async () => {
        const stash = GEMINI_TTS_COSTS['gemini-3.8-flash-tts'];
        delete GEMINI_TTS_COSTS['gemini-3.8-flash-tts'];
        try {
            await expect(
                withTestActor(() => makeProvider().synthesize({ text: 'hi' })),
            ).rejects.toMatchObject({ statusCode: 500 });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            GEMINI_TTS_COSTS['gemini-3.8-flash-tts'] = stash;
        }
    });
});
