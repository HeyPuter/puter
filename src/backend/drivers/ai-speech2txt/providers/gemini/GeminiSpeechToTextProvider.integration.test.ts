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
 * Integration test for Gemini transcription against the live API, through the
 * authenticated `/drivers/call` route. The audio is a short sentence spoken by
 * Gemini TTS on the same server, so no fixture is checked in. Skipped when
 * `PUTER_TEST_AI_GEMINI_API_KEY` is unset.
 */

import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UsageInput } from '../../../../services/metering/types.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../../testUtil.js';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    optionalEnv,
    skipUnlessEnv,
} from '../../../integrationTestUtil.js';

const ENV_VAR = 'PUTER_TEST_AI_GEMINI_API_KEY';
const MODEL = 'gemini-3.5-transcribe';
const TEXT = 'The blue lantern is ready.';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'Gemini speech-to-text authenticated HTTP (integration)',
    () => {
        let env: PuterTestEnv;
        let wav: Buffer;

        const callDriver = async (
            data: Record<string, unknown>,
            responseType: 'json' | 'arraybuffer' = 'json',
        ) => {
            const endpoint = new URL('/drivers/call', env.apiOrigin);
            const host = endpoint.host;
            endpoint.hostname = '127.0.0.1';
            return axios.request({
                url: endpoint.toString(),
                method: 'POST',
                responseType,
                validateStatus: () => true,
                headers: {
                    Authorization: `Bearer ${env.users.user.apiToken}`,
                    Origin: env.apiOrigin,
                    Host: host,
                },
                data,
            });
        };

        const transcribe = (args: Record<string, unknown>) =>
            callDriver({
                interface: 'puter-speech2txt',
                method: 'transcribe',
                args: {
                    provider: 'gemini',
                    file: `data:audio/wav;base64,${wav.toString('base64')}`,
                    ...args,
                },
            });

        beforeAll(async () => {
            env = await setupPuterTestEnv({
                providers: {
                    gemini: { apiKey: optionalEnv(ENV_VAR)! },
                    ollama: { enabled: false },
                },
                unlimitedMetering: true,
                extensions: [],
            });
            const speech = await callDriver(
                {
                    interface: 'puter-tts',
                    method: 'synthesize',
                    args: {
                        provider: 'gemini',
                        model: 'gemini-3.8-flash-lite-tts',
                        text: TEXT,
                    },
                },
                'arraybuffer',
            );
            expect(speech.status).toBe(200);
            wav = Buffer.from(speech.data);
            expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
        }, INTEGRATION_TEST_TIMEOUT_MS);

        afterAll(async () => {
            await env?.shutdown();
        });

        it(
            'transcribes with word timestamps and speakers, metering audio and output tokens',
            async () => {
                const batch = vi.spyOn(
                    env.server.services.metering,
                    'batchIncrementUsages',
                );
                try {
                    const response = await transcribe({
                        language: 'en',
                        timestamp_granularities: ['word'],
                        diarize: true,
                    });
                    expect(response.status).toBe(200);
                    const result = response.data.result as {
                        text: string;
                        model: string;
                        language: string;
                        words: {
                            text: string;
                            start: number;
                            end: number;
                            speaker?: string;
                        }[];
                    };
                    expect(result.model).toBe(MODEL);
                    expect(result.language).toBe('en');
                    expect(result.text.toLowerCase()).toContain('blue');
                    expect(result.text.toLowerCase()).toContain('lantern');
                    expect(result).not.toHaveProperty('duration');

                    const words = result.words.map((w) =>
                        w.text.toLowerCase().replace(/[^a-z]/g, ''),
                    );
                    expect(words).toEqual(
                        expect.arrayContaining(['blue', 'lantern']),
                    );
                    for (const word of result.words) {
                        expect(word.start).toBeGreaterThanOrEqual(0);
                        expect(word.end).toBeGreaterThanOrEqual(word.start);
                        expect(typeof word.speaker).toBe('string');
                    }

                    const usages: UsageInput[] = batch.mock.calls
                        .flatMap(([, entries]) => entries)
                        .filter((u) =>
                            u.usageType.startsWith(`gemini:${MODEL}:`),
                        );
                    const audio = usages.find(
                        (u) => u.usageType === `gemini:${MODEL}:input:audio`,
                    );
                    const output = usages.find(
                        (u) => u.usageType === `gemini:${MODEL}:output:text`,
                    );
                    // A few seconds of speech is a few dozen audio tokens.
                    expect(audio?.usageAmount).toBeGreaterThan(0);
                    expect(audio?.usageAmount).toBeLessThan(500);
                    expect(audio?.costOverride).toBe(audio!.usageAmount * 200);
                    expect(output?.usageAmount).toBeGreaterThan(0);
                    expect(output?.costOverride).toBe(
                        output!.usageAmount * 1200,
                    );
                    expect(usages).toHaveLength(2);
                } finally {
                    batch.mockRestore();
                }
            },
            INTEGRATION_TEST_TIMEOUT_MS,
        );

        it('transcribes the documented MP3 URL example', async () => {
            const response = await transcribe({
                file: 'https://assets.puter.site/example.mp3',
                language: 'en',
                diarize: true,
            });
            expect(response.status).toBe(200);
            expect(response.data.result.text.length).toBeGreaterThan(0);
            expect(response.data.result.words.length).toBeGreaterThan(0);
        }, INTEGRATION_TEST_TIMEOUT_MS);

        it(
            'returns the bare transcript for response_format text',
            async () => {
                const response = await transcribe({ response_format: 'text' });
                expect(response.status).toBe(200);
                expect(typeof response.data.result).toBe('string');
                expect(response.data.result.toLowerCase()).toContain(
                    'lantern',
                );
            },
            INTEGRATION_TEST_TIMEOUT_MS,
        );
    },
);
