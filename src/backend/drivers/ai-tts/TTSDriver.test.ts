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
 * Offline unit tests for TTSDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) with API credentials for every TTS provider so the driver
 * registers and indexes them all. Then drives `server.drivers.aiTts`
 * directly. Provider SDKs and global `fetch` are mocked at their
 * network boundaries so the driver's routing and dispatch logic runs
 * without real egress. Aligns with AGENTS.md: "Prefer test server
 * over mocking deps."
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

import { runWithContext } from '../../core/context.js';
import { SYSTEM_ACTOR } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { TTSDriver } from './TTSDriver.js';

// ── SDK mocks ──────────────────────────────────────────────────────
//
// These boot during PuterServer.start() since each provider's
// constructor instantiates its SDK. The driver-level tests only care
// about which provider the driver dispatched to, so each `synthesize`
// mock resolves to a sentinel value that callers inspect.

const { openaiSpeechCreateMock } = vi.hoisted(() => ({
    openaiSpeechCreateMock: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.audio = { speech: { create: openaiSpeechCreateMock } };
        this.chat = { completions: { create: vi.fn() } };
        this.images = { generate: vi.fn() };
    });
    // Mirror the dual-shape contract (default-as-constructor +
    // default.OpenAI for sibling chat providers).
    (OpenAICtor as unknown as { OpenAI: unknown }).OpenAI = OpenAICtor;
    return { OpenAI: OpenAICtor, default: OpenAICtor };
});

const { geminiGenerateContentMock } = vi.hoisted(() => ({
    geminiGenerateContentMock: vi.fn(),
}));

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.models = {
            generateContent: geminiGenerateContentMock,
            generateImages: vi.fn(),
        };
        this.operations = { getVideosOperation: vi.fn() };
    });
    return { GoogleGenAI };
});

const { pollySendMock } = vi.hoisted(() => ({
    pollySendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-polly', async () => {
    const actual =
        await vi.importActual<typeof import('@aws-sdk/client-polly')>(
            '@aws-sdk/client-polly',
        );
    return {
        ...actual,
        PollyClient: vi.fn().mockImplementation(function (
            this: Record<string, unknown>,
        ) {
            this.send = pollySendMock;
        }),
    };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: TTSDriver;
let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'openai-tts': { apiKey: 'oai-key' },
            elevenlabs: { apiKey: 'el-key' },
            'aws-polly': {
                aws: {
                    access_key: 'AKIA-TEST',
                    secret_key: 'secret',
                    region: 'us-west-2',
                },
            },
            gemini: { apiKey: 'gem-key' },
            xai: { apiKey: 'xai-key' },
        },
    } as never);
    driver = server.drivers.aiTts as unknown as TTSDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    openaiSpeechCreateMock.mockReset();
    geminiGenerateContentMock.mockReset();
    pollySendMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
});

afterEach(() => {
    vi.restoreAllMocks();
});

const withActor = <T>(fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR }, fn));

const withDriverName = <T>(driverName: string, fn: () => T | Promise<T>) =>
    Promise.resolve(runWithContext({ actor: SYSTEM_ACTOR, driverName }, fn));

const openaiAudioResponse = () => ({
    arrayBuffer: async () =>
        new Uint8Array(Buffer.from('mp3-bytes')).buffer as ArrayBuffer,
});

// Polly's DescribeVoices needs a non-empty Voices list so the
// engine-default-voice resolver finds something.
const pollyDescribeVoices = {
    Voices: [
        {
            Id: 'Joanna',
            Name: 'Joanna',
            LanguageCode: 'en-US',
            LanguageName: 'US English',
            SupportedEngines: ['standard', 'neural'],
        },
    ],
};

const pollyDispatch = () =>
    pollySendMock.mockImplementation((cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === 'DescribeVoicesCommand') {
            return Promise.resolve(pollyDescribeVoices);
        }
        return Promise.resolve({ AudioStream: 'audio-bytes' });
    });

// ── Provider registration & list ────────────────────────────────────

describe('TTSDriver provider registration', () => {
    it('list() returns every provider with credentials wired up', async () => {
        const names = await driver.list();
        expect(names.sort()).toEqual([
            'aws-polly',
            'elevenlabs',
            'gemini',
            'openai',
            'xai',
        ]);
    });
});

// ── Authentication ──────────────────────────────────────────────────

describe('TTSDriver.synthesize authentication', () => {
    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.synthesize({ text: 'hi' } as never),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── Provider routing ────────────────────────────────────────────────

describe('TTSDriver.synthesize provider routing', () => {
    it('routes via explicit args.provider (openai)', async () => {
        openaiSpeechCreateMock.mockResolvedValueOnce(openaiAudioResponse());

        await withActor(() =>
            driver.synthesize({ text: 'hi', provider: 'openai' }),
        );

        expect(openaiSpeechCreateMock).toHaveBeenCalledTimes(1);
        // None of the other providers should have been hit.
        expect(pollySendMock).not.toHaveBeenCalled();
        expect(geminiGenerateContentMock).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('routes via legacy driverAlias (elevenlabs-tts → elevenlabs)', async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response('audio', {
                status: 200,
                headers: { 'content-type': 'audio/mpeg' },
            }),
        );

        await withDriverName('elevenlabs-tts', () =>
            driver.synthesize({ text: 'hi' }),
        );

        // ElevenLabs uses fetch — verify it hit the right URL.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0]![0])).toMatch(
            /api\.elevenlabs\.io\/v1\/text-to-speech\//,
        );
        expect(openaiSpeechCreateMock).not.toHaveBeenCalled();
    });

    it('routes via legacy driverAlias (aws-polly → aws-polly)', async () => {
        pollyDispatch();

        await withDriverName('aws-polly', () =>
            driver.synthesize({ text: 'hi', voice: 'Joanna' }),
        );

        const synthCalls = pollySendMock.mock.calls.filter(
            ([cmd]) => cmd.constructor.name === 'SynthesizeSpeechCommand',
        );
        expect(synthCalls).toHaveLength(1);
        expect(openaiSpeechCreateMock).not.toHaveBeenCalled();
    });

    it('defaults to openai when no provider hint is supplied (preferred first)', async () => {
        openaiSpeechCreateMock.mockResolvedValueOnce(openaiAudioResponse());

        await withActor(() => driver.synthesize({ text: 'hi' }));

        expect(openaiSpeechCreateMock).toHaveBeenCalledTimes(1);
    });

    it('throws 400 when the named provider is not registered', async () => {
        await expect(
            withActor(() =>
                driver.synthesize({
                    text: 'hi',
                    provider: 'totally-not-a-real-provider',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── list_voices / list_engines aggregation ─────────────────────────

describe('TTSDriver list_voices / list_engines', () => {
    it('list_voices() aggregates across providers when no filter is supplied', async () => {
        // Provider listVoices methods that touch the network: ElevenLabs
        // (fetch) and AWS Polly (DescribeVoices). Wire both up.
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ voices: [] }), { status: 200 }),
        );
        pollyDispatch();

        const voices = await driver.list_voices();
        const providers = new Set(voices.map((v) => v.provider));
        // OpenAI, Gemini, xAI, AWS Polly are all hard-coded catalogs; we
        // expect those at minimum (ElevenLabs returned an empty list).
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('gemini')).toBe(true);
        expect(providers.has('xai')).toBe(true);
        expect(providers.has('aws-polly')).toBe(true);
    });

    it('list_voices({ provider }) filters to a single provider', async () => {
        const voices = await driver.list_voices({ provider: 'openai' });
        expect(voices.length).toBeGreaterThan(0);
        for (const voice of voices) {
            expect(voice.provider).toBe('openai');
        }
    });

    it('list_voices({ provider }) returns empty when the provider is not registered', async () => {
        const voices = await driver.list_voices({ provider: 'nope' });
        expect(voices).toEqual([]);
    });

    it('list_engines() aggregates engines across providers and namespaces them', async () => {
        const engines = await driver.list_engines();
        const ids = engines.map((e) => e.id);
        // Some signature engines from each provider.
        expect(ids).toEqual(
            expect.arrayContaining([
                'gpt-4o-mini-tts', // openai
                'eleven_multilingual_v2', // elevenlabs
                'gemini-2.5-flash-preview-tts',
                'xai-tts',
                'standard', // aws-polly
            ]),
        );
    });

    it('list_engines({ provider }) filters to a single provider', async () => {
        const engines = await driver.list_engines({ provider: 'xai' });
        expect(engines).toHaveLength(1);
        expect(engines[0].provider).toBe('xai');
    });
});

// ── getReportedCosts aggregation ────────────────────────────────────

describe('TTSDriver.getReportedCosts', () => {
    it('aggregates per-provider cost catalogs into one list', () => {
        const reported = driver.getReportedCosts() as Array<{
            usageType: string;
            source: string;
        }>;
        const sources = new Set(reported.map((r) => r.source));
        // Each provider's getReportedCosts() emits its own source string.
        expect(sources).toEqual(
            new Set([
                'driver:aiTts/openai',
                'driver:aiTts/elevenlabs',
                'driver:aiTts/aws-polly',
                'driver:aiTts/gemini',
                'driver:aiTts/xai',
            ]),
        );
    });
});

// ── Provider error mapping ──────────────────────────────────────────

describe('TTSDriver.synthesize error mapping', () => {
    it('passes through HttpError (400) from a provider with the same status code', async () => {
        await expect(
            withActor(() =>
                driver.synthesize({
                    text: 'hi',
                    provider: 'openai',
                    model: 'definitely-not-a-real-model',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('does not meter when the dispatched provider throws an SDK error', async () => {
        const incrementUsageSpy = vi.spyOn(
            server.services.metering,
            'incrementUsage',
        );
        openaiSpeechCreateMock.mockRejectedValueOnce(new Error('upstream blew up'));

        await expect(
            withActor(() =>
                driver.synthesize({ text: 'hi', provider: 'openai' }),
            ),
        ).rejects.toThrow('upstream blew up');
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
