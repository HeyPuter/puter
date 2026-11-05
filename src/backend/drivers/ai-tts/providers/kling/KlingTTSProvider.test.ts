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
 * Offline unit tests for KlingTTSProvider.
 *
 * Boots a real PuterServer and constructs the provider against the live wired
 * `MeteringService`. Kling has no SDK, so global `fetch` is the network
 * boundary: the first call creates the TTS task, the second downloads the MP3
 * it points at.
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
import { withAiCostFactor } from '../../../util/aiCostFactor.js';
import {
    readStreamResult,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { SAMPLE_AUDIO_URL } from '../../../util/testMode.js';
import {
    KLING_TTS_UCENTS_PER_REQUEST,
    KlingTTSProvider,
} from './KlingTTSProvider.js';

// -- Test harness --

const AUDIO_URL = 'https://cdn.kling.example/audio.mp3';

let server: PuterServer;
let fetchSpy: MockInstance<typeof fetch>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const aiMetering = () =>
    withAiCostFactor(server.services.metering, server.clients.event, 'ai-tts');

const makeProvider = () =>
    new KlingTTSProvider(aiMetering(), { apiKey: 'test-key' });

const klingTask = (overrides: Record<string, unknown> = {}) =>
    Response.json({
        code: 0,
        message: 'SUCCEED',
        data: {
            task_id: 't1',
            task_status: 'succeed',
            task_result: { audios: [{ id: 'a1', url: AUDIO_URL }] },
            ...overrides,
        },
    });

const mp3 = (body = 'ID3-mp3-bytes') =>
    new Response(body, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
    });

const sentBody = () =>
    JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Construction and catalog --

describe('KlingTTSProvider construction and catalog', () => {
    it('throws when no apiKey is supplied', () => {
        expect(
            () => new KlingTTSProvider(aiMetering(), { apiKey: '' }),
        ).toThrow(/API key/i);
    });

    it('lists the 44 voices Kling accepts, labelled with their languages', async () => {
        const voices = await makeProvider().listVoices();
        expect(voices).toHaveLength(44);
        for (const voice of voices) {
            expect(voice.provider).toBe('kling');
            expect(voice.supported_models).toEqual(['kling-tts']);
            expect(voice.labels!.languages.split(',')[0]).toBe(
                voice.language!.code,
            );
        }
        expect(voices.find((v) => v.id === 'oversea_male1')).toMatchObject({
            language: { code: 'en', name: 'English' },
            labels: { languages: 'en' },
        });
        expect(voices.find((v) => v.id === 'genshin_vindi2')).toMatchObject({
            labels: { languages: 'en,zh' },
        });
        expect(voices.find((v) => v.id === 'mengwa-v1')).toMatchObject({
            language: { code: 'zh', name: 'Chinese' },
        });
    });

    it('lists one kling-tts engine', async () => {
        expect(await makeProvider().listEngines()).toEqual([
            { id: 'kling-tts', name: 'Kling TTS', provider: 'kling' },
        ]);
    });

    it('reports a per-request cost', () => {
        expect(makeProvider().getReportedCosts()).toEqual([
            {
                usageType: 'kling:kling-tts:request',
                ucentsPerUnit: 700_000,
                unit: 'request',
                source: 'driver:aiTts/kling',
            },
        ]);
    });
});

// -- test_mode --

describe('KlingTTSProvider.synthesize test_mode', () => {
    it('returns the sample audio without calling Kling', async () => {
        const result = await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi', test_mode: true }),
        );
        expect(result).toEqual({
            url: SAMPLE_AUDIO_URL,
            content_type: 'audio',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// -- Request shape --

describe('KlingTTSProvider.synthesize request shape', () => {
    it('POSTs /v1/audio/tts with Bearer auth and the default voice', async () => {
        fetchSpy
            .mockResolvedValueOnce(klingTask())
            .mockResolvedValueOnce(mp3());

        await readStreamResult(
            await withTestActor(() =>
                makeProvider().synthesize({ text: 'hello' }),
            ),
        );

        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe(
            'https://api-singapore.klingai.com/v1/audio/tts',
        );
        expect((init as RequestInit).method).toBe('POST');
        expect(
            ((init as RequestInit).headers as Record<string, string>)
                .Authorization,
        ).toBe('Bearer test-key');
        expect(sentBody()).toEqual({
            text: 'hello',
            voice_id: 'oversea_male1',
            voice_language: 'en',
        });
        expect(String(fetchSpy.mock.calls[1]![0])).toBe(AUDIO_URL);
    });

    it('reads a regional language code as its base language', async () => {
        fetchSpy
            .mockResolvedValueOnce(klingTask())
            .mockResolvedValueOnce(mp3());

        await withTestActor(() =>
            makeProvider().synthesize({
                text: 'hi',
                voice: 'genshin_vindi2',
                language: 'en-US',
            }),
        );

        expect(sentBody()).toMatchObject({
            voice_id: 'genshin_vindi2',
            voice_language: 'en',
        });
    });

    it("defaults a Chinese-only voice to 'zh'", async () => {
        fetchSpy
            .mockResolvedValueOnce(klingTask())
            .mockResolvedValueOnce(mp3());

        await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi', voice: 'mengwa-v1' }),
        );

        expect(sentBody().voice_language).toBe('zh');
    });

    it('sends voice_settings.speed as voice_speed', async () => {
        fetchSpy
            .mockResolvedValueOnce(klingTask())
            .mockResolvedValueOnce(mp3());

        await withTestActor(() =>
            makeProvider().synthesize({
                text: 'hi',
                voice_settings: { speed: 1.5 },
            }),
        );

        expect(sentBody().voice_speed).toBe(1.5);
    });

    it('streams the MP3 back as audio/mpeg', async () => {
        fetchSpy
            .mockResolvedValueOnce(klingTask())
            .mockResolvedValueOnce(mp3('AAA-BBB'));

        const result = await withTestActor(() =>
            makeProvider().synthesize({ text: 'hi' }),
        );

        expect(result).toMatchObject({
            dataType: 'stream',
            content_type: 'audio/mpeg',
            chunked: true,
        });
        expect((await readStreamResult(result)).toString()).toBe('AAA-BBB');
    });
});

// -- Metering --

describe('KlingTTSProvider.synthesize metering', () => {
    it('meters one request once the audio arrives', async () => {
        fetchSpy
            .mockResolvedValueOnce(klingTask())
            .mockResolvedValueOnce(mp3());

        await readStreamResult(
            await withTestActor(() =>
                makeProvider().synthesize({ text: 'hi' }),
            ),
        );

        await vi.waitFor(() =>
            expect(incrementUsageSpy).toHaveBeenCalledTimes(1),
        );
        const [, usageType, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(usageType).toBe('kling:kling-tts:request');
        expect(count).toBe(1);
        expect(cost).toBe(KLING_TTS_UCENTS_PER_REQUEST);
    });

    it.each([
        [
            'a Kling error code',
            () =>
                Response.json(
                    { code: 1201, message: 'Voice id not found' },
                    { status: 400 },
                ),
        ],
        [
            'a failed task',
            () =>
                klingTask({
                    task_status: 'failed',
                    task_status_msg: 'failed',
                    task_result: {},
                }),
        ],
        ['a task with no audio URL', () => klingTask({ task_result: {} })],
    ])('meters nothing for %s', async (_label, reply) => {
        fetchSpy.mockResolvedValueOnce(reply());

        await expect(
            withTestActor(() => makeProvider().synthesize({ text: 'hi' })),
        ).rejects.toBeTruthy();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });
});

// -- Validation --

describe('KlingTTSProvider.synthesize validation', () => {
    it.each([
        ['empty text', { text: '' }, undefined],
        [
            'text over 1000 characters',
            { text: 'x'.repeat(1001) },
            'input_too_large',
        ],
        ['an unknown voice', { text: 'hi', voice: 'nope' }, 'field_invalid'],
        ['an unknown model', { text: 'hi', model: 'tts-1' }, 'field_invalid'],
        [
            'a language the voice lacks',
            { text: 'hi', voice: 'oversea_male1', language: 'zh' },
            'field_invalid',
        ],
        [
            'a speed below 0.8',
            { text: 'hi', voice_settings: { speed: 0.5 } },
            'field_invalid',
        ],
        [
            'a speed above 2',
            { text: 'hi', voice_settings: { speed: 2.5 } },
            'field_invalid',
        ],
    ])(
        'rejects %s with 400 before calling Kling',
        async (_label, args, legacyCode) => {
            await expect(
                withTestActor(() => makeProvider().synthesize(args)),
            ).rejects.toMatchObject({
                statusCode: 400,
                ...(legacyCode ? { legacyCode } : {}),
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );
});
