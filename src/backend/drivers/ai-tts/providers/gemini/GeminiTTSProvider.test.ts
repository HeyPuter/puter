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
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs GeminiTTSProvider directly against the live
 * wired `MeteringService` so the recording side runs end-to-end. The
 * Google GenAI SDK is mocked at the module boundary — that's the real
 * network egress point.
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
import { GeminiTTSProvider } from './GeminiTTSProvider.js';
import { GEMINI_TTS_COSTS } from './costs.js';

// ── Google GenAI SDK mock ───────────────────────────────────────────

const { generateContentMock, googleAICtor } = vi.hoisted(() => ({
    generateContentMock: vi.fn(),
    googleAICtor: vi.fn(),
}));

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        googleAICtor(opts);
        this.models = { generateContent: generateContentMock };
    });
    return { GoogleGenAI };
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
    new GeminiTTSProvider(server.services.metering, { apiKey: 'test-key' });

// Build a canned generateContent response with PCM audio data and
// usageMetadata that the provider can meter against.
const audioResponse = (
    base64Pcm = Buffer.from('PCMPCMPCM').toString('base64'),
    {
        mimeType = 'audio/L16;rate=24000',
        promptTokenCount = 10,
        candidatesTokenCount = 250,
    }: {
        mimeType?: string;
        promptTokenCount?: number;
        candidatesTokenCount?: number;
    } = {},
) => ({
    candidates: [
        {
            content: {
                parts: [{ inlineData: { mimeType, data: base64Pcm } }],
            },
        },
    ],
    usageMetadata: { promptTokenCount, candidatesTokenCount },
});

beforeEach(() => {
    generateContentMock.mockReset();
    googleAICtor.mockReset();
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

describe('GeminiTTSProvider construction', () => {
    it('constructs the GoogleGenAI SDK with the configured api key', () => {
        makeProvider();
        expect(googleAICtor).toHaveBeenCalledTimes(1);
        expect(googleAICtor).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new GeminiTTSProvider(server.services.metering, {
                    apiKey: '',
                }),
        ).toThrow(/API key/i);
    });
});

// ── Voice / engine catalog ──────────────────────────────────────────

describe('GeminiTTSProvider catalog', () => {
    it('listVoices returns the documented Gemini voices with provider=gemini', async () => {
        const provider = makeProvider();
        const voices = await provider.listVoices();
        expect(voices.length).toBeGreaterThan(0);
        for (const voice of voices) {
            expect(voice.provider).toBe('gemini');
        }
        // Default voice (Kore) is present.
        expect(voices.find((v) => v.id === 'Kore')).toBeDefined();
        // supported_models matches the documented engine list.
        expect(voices[0].supported_models).toEqual(
            expect.arrayContaining([
                'gemini-2.5-flash-preview-tts',
                'gemini-2.5-pro-preview-tts',
                'gemini-3.1-flash-tts-preview',
            ]),
        );
    });

    it('listEngines returns the documented model list with provider=gemini', async () => {
        const provider = makeProvider();
        const engines = await provider.listEngines();
        const ids = engines.map((e) => e.id);
        expect(ids).toEqual(
            expect.arrayContaining([
                'gemini-2.5-flash-preview-tts',
                'gemini-2.5-pro-preview-tts',
                'gemini-3.1-flash-tts-preview',
            ]),
        );
    });
});

// ── Reported costs ──────────────────────────────────────────────────

describe('GeminiTTSProvider.getReportedCosts', () => {
    it('emits per-model line items with ucents converted from cents/1M tokens', () => {
        const provider = makeProvider();
        const reported = provider.getReportedCosts() as Array<{
            usageType: string;
            ucentsInputPerToken: number;
            ucentsOutputAudioPerToken: number;
            unit: string;
            source: string;
        }>;
        expect(reported).toHaveLength(Object.keys(GEMINI_TTS_COSTS).length);
        for (const [model] of Object.entries(GEMINI_TTS_COSTS)) {
            const entry = reported.find(
                (r) => r.usageType === `gemini:${model}:tts`,
            );
            expect(entry).toBeDefined();
            expect(entry?.unit).toBe('token');
            expect(entry?.source).toBe('driver:aiTts/gemini');
            // ucents are integer microcents — must be >= 1 by construction.
            expect(entry?.ucentsInputPerToken).toBeGreaterThanOrEqual(1);
            expect(entry?.ucentsOutputAudioPerToken).toBeGreaterThanOrEqual(1);
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('GeminiTTSProvider.synthesize test_mode', () => {
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
        expect(generateContentMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('GeminiTTSProvider.synthesize argument validation', () => {
    it('throws 400 when text is missing or blank', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() => provider.synthesize({ text: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.synthesize({ text: '  ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('throws 400 when the model is not in the catalog', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', model: 'gemini-fake' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });

    it('throws 400 when the voice is not in the catalog', async () => {
        const provider = makeProvider();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', voice: 'NotAVoice' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('GeminiTTSProvider.synthesize credit gate', () => {
    it('throws 402 BEFORE hitting Gemini when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateContentMock).not.toHaveBeenCalled();
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('GeminiTTSProvider.synthesize request shape', () => {
    it('frames text as a "Say the following text aloud:" transcript, defaults to flash/Kore', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(audioResponse());

        await withTestActor(() => provider.synthesize({ text: 'hello' }));

        const sent = generateContentMock.mock.calls[0]![0];
        expect(sent.model).toBe('gemini-2.5-flash-preview-tts');
        expect(sent.contents[0].parts[0].text).toBe(
            'Say the following text aloud:\nhello',
        );
        expect(sent.config.responseModalities).toEqual(['AUDIO']);
        expect(
            sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
        ).toBe('Kore');
    });

    it('prepends instructions to the transcript when supplied', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                instructions: 'Speak softly',
                voice: 'Zephyr',
                model: 'gemini-2.5-pro-preview-tts',
            }),
        );

        const sent = generateContentMock.mock.calls[0]![0];
        expect(sent.model).toBe('gemini-2.5-pro-preview-tts');
        expect(sent.contents[0].parts[0].text).toBe(
            'Speak softly\n\nSay the following text aloud:\nhi',
        );
        expect(
            sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
        ).toBe('Zephyr');
    });

    it('accepts voice names case-insensitively but forwards the caller spelling', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(audioResponse());

        await withTestActor(() =>
            provider.synthesize({ text: 'hi', voice: 'kore' }),
        );

        const sent = generateContentMock.mock.calls[0]![0];
        expect(
            sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
        ).toBe('kore');
    });
});

// ── Streaming output & WAV wrapping ────────────────────────────────

describe('GeminiTTSProvider.synthesize streaming output', () => {
    it('wraps PCM payloads into a WAV container and returns a readable stream', async () => {
        const provider = makeProvider();
        const pcm = Buffer.from('PCM-PAYLOAD');
        generateContentMock.mockResolvedValueOnce(
            audioResponse(pcm.toString('base64')),
        );

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as {
            stream: Readable;
            content_type: string;
            chunked: boolean;
        };

        expect(result.content_type).toBe('audio/wav');
        expect(result.chunked).toBe(true);
        expect(result.stream).toBeInstanceOf(Readable);

        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk as Buffer);
        }
        const buffer = Buffer.concat(chunks);
        // 44-byte WAV header + PCM data length.
        expect(buffer.length).toBe(44 + pcm.length);
        expect(buffer.subarray(0, 4).toString()).toBe('RIFF');
        expect(buffer.subarray(8, 12).toString()).toBe('WAVE');
        // Trailing bytes match the original PCM verbatim.
        expect(buffer.subarray(44)).toEqual(pcm);
    });

    it('passes encoded (non-PCM) audio through with the upstream mime type', async () => {
        const provider = makeProvider();
        const encoded = Buffer.from('ALREADY-MP3');
        generateContentMock.mockResolvedValueOnce(
            audioResponse(encoded.toString('base64'), {
                mimeType: 'audio/mpeg',
            }),
        );

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi' }),
        )) as { stream: Readable; content_type: string };

        expect(result.content_type).toBe('audio/mpeg');
        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk as Buffer);
        }
        expect(Buffer.concat(chunks)).toEqual(encoded);
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('GeminiTTSProvider.synthesize metering', () => {
    it('meters input + output:audio as batched line items at the model rates', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce(
            audioResponse(undefined, {
                promptTokenCount: 8,
                candidatesTokenCount: 200,
            }),
        );

        await withTestActor(() =>
            provider.synthesize({
                text: 'hi',
                model: 'gemini-2.5-flash-preview-tts',
            }),
        );

        expect(batchIncrementUsagesSpy).toHaveBeenCalledTimes(1);
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const types = (entries as Array<{ usageType: string }>).map(
            (e) => e.usageType,
        );
        expect(types).toEqual([
            'gemini:gemini-2.5-flash-preview-tts:input',
            'gemini:gemini-2.5-flash-preview-tts:output:audio',
        ]);
        const inputEntry = (
            entries as Array<{ usageType: string; usageAmount: number }>
        ).find((e) => e.usageType.endsWith(':input'))!;
        const outputEntry = (
            entries as Array<{ usageType: string; usageAmount: number }>
        ).find((e) => e.usageType.endsWith('output:audio'))!;
        expect(inputEntry.usageAmount).toBe(8);
        expect(outputEntry.usageAmount).toBe(200);
    });

    it('falls back to estimated token counts when usageMetadata is missing', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inlineData: {
                                    mimeType: 'audio/L16;rate=24000',
                                    data: Buffer.from('p').toString('base64'),
                                },
                            },
                        ],
                    },
                },
            ],
            // No usageMetadata.
        });

        await withTestActor(() => provider.synthesize({ text: 'hello there' }));

        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const inputEntry = (
            entries as Array<{ usageType: string; usageAmount: number }>
        ).find((e) => e.usageType.endsWith(':input'))!;
        // estimatedInputTokens = ceil(len/4) for 'hello there' (11 chars) = 3.
        expect(inputEntry.usageAmount).toBe(3);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('GeminiTTSProvider.synthesize error paths', () => {
    it('throws 500 when no cost data exists for the resolved model', async () => {
        const provider = makeProvider();
        // Surgically delete the cost entry for the flash model so the
        // provider can't find pricing during the request.
        const stash = GEMINI_TTS_COSTS['gemini-2.5-flash-preview-tts'];
        delete (GEMINI_TTS_COSTS as Record<string, unknown>)[
            'gemini-2.5-flash-preview-tts'
        ];
        try {
            await expect(
                withTestActor(() => provider.synthesize({ text: 'hi' })),
            ).rejects.toMatchObject({ statusCode: 500 });
        } finally {
            (GEMINI_TTS_COSTS as Record<string, unknown>)[
                'gemini-2.5-flash-preview-tts'
            ] = stash;
        }
    });

    it('wraps SDK errors as HttpError 502', async () => {
        const provider = makeProvider();
        generateContentMock.mockRejectedValueOnce(new Error('upstream blew up'));

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 502 });
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });

    it('throws 502 when Gemini response has no inline audio data', async () => {
        const provider = makeProvider();
        generateContentMock.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'no audio here' }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        });

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 502 });
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});
