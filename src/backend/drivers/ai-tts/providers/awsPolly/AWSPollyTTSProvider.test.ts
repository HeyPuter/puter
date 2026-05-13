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
 * Offline unit tests for AWSPollyTTSProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs AWSPollyTTSProvider directly against the live
 * wired `MeteringService`. The AWS Polly SDK is mocked at the module
 * boundary — that's the real network egress point. Covers voice
 * resolution (caller-supplied, language-derived, default-per-engine
 * fallback), SSML routing, request shape into SynthesizeSpeechCommand,
 * engine validation, and cost reporting.
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

import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { AWSPollyTTSProvider } from './AWSPollyTTSProvider.js';
import { AWS_POLLY_COSTS } from './costs.js';

// ── AWS Polly SDK mock ──────────────────────────────────────────────

const { pollySendMock, pollyCtor } = vi.hoisted(() => ({
    pollySendMock: vi.fn(),
    pollyCtor: vi.fn(),
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
            opts: unknown,
        ) {
            pollyCtor(opts);
            this.send = pollySendMock;
        }),
    };
});

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (region?: string) =>
    new AWSPollyTTSProvider(server.services.metering, {
        access_key: 'AKIA-TEST',
        secret_key: 'secret',
        region,
    });

// Canned DescribeVoices response: covers all four valid engines and
// language-coded voice picks the provider needs to find.
const describeVoicesResponse = {
    Voices: [
        {
            Id: 'Joanna',
            Name: 'Joanna',
            LanguageCode: 'en-US',
            LanguageName: 'US English',
            SupportedEngines: ['standard', 'neural', 'long-form', 'generative'],
        },
        {
            Id: 'Matthew',
            Name: 'Matthew',
            LanguageCode: 'en-US',
            LanguageName: 'US English',
            SupportedEngines: ['standard', 'neural', 'long-form', 'generative'],
        },
        {
            Id: 'Salli',
            Name: 'Salli',
            LanguageCode: 'en-US',
            LanguageName: 'US English',
            SupportedEngines: ['standard', 'neural', 'generative'],
        },
        {
            Id: 'Mia',
            Name: 'Mia',
            LanguageCode: 'es-MX',
            LanguageName: 'Mexican Spanish',
            SupportedEngines: ['standard', 'neural'],
        },
    ],
};

// Polly's command shape exposes `input` on the wire; the provider only
// cares about the InvokerCommand resulting from `new SynthesizeSpeechCommand`.
const sendDispatch = (
    onDescribe: () => unknown = () => describeVoicesResponse,
    onSynthesize: () => unknown = () => ({
        AudioStream: 'synthesized-audio',
    }),
) =>
    pollySendMock.mockImplementation((cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === 'DescribeVoicesCommand') {
            return Promise.resolve(onDescribe());
        }
        return Promise.resolve(onSynthesize());
    });

beforeEach(() => {
    pollySendMock.mockReset();
    pollyCtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Client construction ─────────────────────────────────────────────

describe('AWSPollyTTSProvider client construction', () => {
    it('defaults region to us-west-2 and forwards configured credentials', async () => {
        const provider = makeProvider();
        sendDispatch();
        // Trigger client construction via a non-mutating call.
        await provider.listEngines();
        // `listEngines()` is local — call something that hits Polly.
        await provider.listVoices();

        expect(pollyCtor).toHaveBeenCalledTimes(1);
        expect(pollyCtor.mock.calls[0]![0]).toMatchObject({
            credentials: {
                accessKeyId: 'AKIA-TEST',
                secretAccessKey: 'secret',
            },
            region: 'us-west-2',
        });
    });

    it('honours an explicit region from the provider config', async () => {
        const provider = makeProvider('eu-central-1');
        sendDispatch();
        await provider.listVoices();
        expect(pollyCtor.mock.calls[0]![0]).toMatchObject({
            region: 'eu-central-1',
        });
    });
});

// ── Voice / engine catalog ──────────────────────────────────────────

describe('AWSPollyTTSProvider catalog', () => {
    it('listVoices returns every Polly voice with provider=aws-polly', async () => {
        const provider = makeProvider();
        sendDispatch();
        const voices = await provider.listVoices();
        const ids = voices.map((v) => v.id);
        expect(ids).toEqual(
            expect.arrayContaining(['Joanna', 'Matthew', 'Salli', 'Mia']),
        );
        for (const voice of voices) {
            expect(voice.provider).toBe('aws-polly');
        }
    });

    it('listVoices filters to voices that support the requested engine', async () => {
        const provider = makeProvider();
        sendDispatch();
        const voices = await provider.listVoices({ engine: 'long-form' });
        // Only Joanna/Matthew support long-form in our fixture.
        expect(voices.map((v) => v.id).sort()).toEqual(['Joanna', 'Matthew']);
    });

    it('listVoices throws 400 on an unknown engine before hitting AWS', async () => {
        const provider = makeProvider();
        sendDispatch();
        await expect(
            provider.listVoices({ engine: 'fake-engine' }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('listEngines returns the four documented engines with pricing', async () => {
        const provider = makeProvider();
        const engines = await provider.listEngines();
        expect(engines.map((e) => e.id).sort()).toEqual([
            'generative',
            'long-form',
            'neural',
            'standard',
        ]);
        for (const engine of engines) {
            expect(engine.provider).toBe('aws-polly');
            expect(engine.pricing_per_million_chars).toBe(
                AWS_POLLY_COSTS[engine.id] / 100,
            );
        }
    });
});

// ── Reported costs ──────────────────────────────────────────────────

describe('AWSPollyTTSProvider.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-character line item', () => {
        const provider = makeProvider();
        const reported = provider.getReportedCosts();
        expect(reported).toHaveLength(Object.keys(AWS_POLLY_COSTS).length);
        for (const [engine, ucentsPerUnit] of Object.entries(AWS_POLLY_COSTS)) {
            expect(reported).toContainEqual({
                usageType: `aws-polly:${engine}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/aws-polly',
            });
        }
    });
});

// ── test_mode bypass ────────────────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize test_mode', () => {
    it('returns the canned sample URL without hitting credits or Polly', async () => {
        const provider = makeProvider();
        const result = await withTestActor(() =>
            provider.synthesize({ text: 'hi', test_mode: true }),
        );
        expect(result).toEqual({
            url: 'https://puter-sample-data.puter.site/tts_example.mp3',
            content_type: 'audio',
        });
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(pollySendMock).not.toHaveBeenCalled();
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize argument validation', () => {
    it('throws 400 when text is missing or blank', async () => {
        const provider = makeProvider();
        sendDispatch();
        await expect(
            withTestActor(() => provider.synthesize({ text: '' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => provider.synthesize({ text: '  ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when an unknown engine is supplied', async () => {
        const provider = makeProvider();
        sendDispatch();
        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', engine: 'fake-engine' }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── Credit gate ─────────────────────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize credit gate', () => {
    it('throws 402 BEFORE hitting Polly when actor lacks credits', async () => {
        const provider = makeProvider();
        hasCreditsSpy.mockResolvedValueOnce(false);
        sendDispatch();

        await expect(
            withTestActor(() => provider.synthesize({ text: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        // No SynthesizeSpeechCommand should have been dispatched.
        const synthCalls = pollySendMock.mock.calls.filter(
            ([cmd]) => cmd.constructor.name === 'SynthesizeSpeechCommand',
        );
        expect(synthCalls).toHaveLength(0);
    });
});

// ── Request shape ───────────────────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize request shape', () => {
    it('builds a SynthesizeSpeechCommand with mp3 output and TextType=text by default', async () => {
        const provider = makeProvider();
        sendDispatch();

        await withTestActor(() =>
            provider.synthesize({ text: 'hello', voice: 'Joanna' }),
        );

        const synthCalls = pollySendMock.mock.calls.filter(
            ([cmd]) => cmd.constructor.name === 'SynthesizeSpeechCommand',
        );
        expect(synthCalls).toHaveLength(1);
        const cmdInput = synthCalls[0]![0].input;
        expect(cmdInput).toMatchObject({
            Engine: 'standard',
            OutputFormat: 'mp3',
            Text: 'hello',
            VoiceId: 'Joanna',
            LanguageCode: 'en-US',
            TextType: 'text',
        });
    });

    it('sets TextType=ssml when the ssml flag is supplied', async () => {
        const provider = makeProvider();
        sendDispatch();
        await withTestActor(() =>
            provider.synthesize({
                text: '<speak>hi</speak>',
                voice: 'Joanna',
                ssml: '<speak>hi</speak>',
            }),
        );
        const synthCalls = pollySendMock.mock.calls.filter(
            ([cmd]) => cmd.constructor.name === 'SynthesizeSpeechCommand',
        );
        expect(synthCalls[0]![0].input.TextType).toBe('ssml');
    });

    it('selects a language-appropriate voice when caller omits voice but supplies language', async () => {
        const provider = makeProvider();
        sendDispatch();
        await withTestActor(() =>
            provider.synthesize({
                text: 'hola',
                engine: 'neural',
                language: 'es-MX',
            }),
        );
        const synthCalls = pollySendMock.mock.calls.filter(
            ([cmd]) => cmd.constructor.name === 'SynthesizeSpeechCommand',
        );
        // The only es-MX voice in the fixture that supports neural is Mia.
        expect(synthCalls[0]![0].input.VoiceId).toBe('Mia');
        expect(synthCalls[0]![0].input.LanguageCode).toBe('es-MX');
    });

    it('falls back to the engine default (Joanna for neural) when neither voice nor language is set', async () => {
        const provider = makeProvider();
        sendDispatch();
        await withTestActor(() =>
            provider.synthesize({ text: 'hi', engine: 'neural' }),
        );
        const synthCalls = pollySendMock.mock.calls.filter(
            ([cmd]) => cmd.constructor.name === 'SynthesizeSpeechCommand',
        );
        expect(synthCalls[0]![0].input.VoiceId).toBe('Joanna');
    });
});

// ── Streaming output ────────────────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize streaming output', () => {
    it('returns the AudioStream as a chunked audio/mpeg DriverStreamResult', async () => {
        const provider = makeProvider();
        sendDispatch(undefined, () => ({ AudioStream: 'synthesized-audio' }));

        const result = (await withTestActor(() =>
            provider.synthesize({ text: 'hi', voice: 'Joanna' }),
        )) as { stream: unknown; content_type: string; chunked: boolean };

        expect(result.content_type).toBe('audio/mpeg');
        expect(result.chunked).toBe(true);
        expect(result.stream).toBe('synthesized-audio');
    });
});

// ── Cost reporting & metering ───────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize metering', () => {
    it('meters character count × per-engine ucents under aws-polly:<engine>:character', async () => {
        const provider = makeProvider();
        sendDispatch();

        const text = 'hello';
        await withTestActor(() =>
            provider.synthesize({
                text,
                voice: 'Joanna',
                engine: 'neural',
            }),
        );

        const expectedCost = AWS_POLLY_COSTS['neural'] * text.length;
        expect(incrementUsageSpy).toHaveBeenCalledTimes(1);
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('aws-polly:neural:character');
        expect(count).toBe(text.length);
        expect(cost).toBe(expectedCost);
    });

    it('asks for hasEnoughCredits with the same total it later meters', async () => {
        const provider = makeProvider();
        sendDispatch();

        const text = 'hi there';
        await withTestActor(() =>
            provider.synthesize({
                text,
                voice: 'Joanna',
                engine: 'generative',
            }),
        );

        const expectedCost = AWS_POLLY_COSTS['generative'] * text.length;
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(expectedCost);
    });
});

// ── Error paths ─────────────────────────────────────────────────────

describe('AWSPollyTTSProvider.synthesize error paths', () => {
    it('propagates Polly SDK errors without metering', async () => {
        const provider = makeProvider();
        const apiError = new Error('access denied');
        pollySendMock.mockImplementation(
            (cmd: { constructor: { name: string } }) => {
                if (cmd.constructor.name === 'DescribeVoicesCommand') {
                    return Promise.resolve(describeVoicesResponse);
                }
                return Promise.reject(apiError);
            },
        );

        await expect(
            withTestActor(() =>
                provider.synthesize({ text: 'hi', voice: 'Joanna' }),
            ),
        ).rejects.toBe(apiError);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});
