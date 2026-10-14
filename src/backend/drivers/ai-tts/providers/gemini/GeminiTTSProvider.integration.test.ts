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
 * Integration test for the Gemini TTS provider against the live
 * Interactions API, one short sentence per model. Skipped when
 * `PUTER_TEST_AI_GEMINI_API_KEY` is unset. With
 * `PUTER_TEST_AI_GEMINI_TTS_AUDIO_DIR` set, each WAV is written there so
 * the spoken words can be checked against `TEXT` by ear or transcription.
 */

import axios from 'axios';
import { setupPuterTestEnv } from '../../../../testUtil.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UsageInput } from '../../../../services/metering/types.js';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    readStreamResult,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { GeminiTTSProvider } from './GeminiTTSProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_GEMINI_API_KEY';
const AUDIO_DIR_ENV_VAR = 'PUTER_TEST_AI_GEMINI_TTS_AUDIO_DIR';

const TEXT = 'The orange kite drifted over seven quiet hills.';
const INSTRUCTIONS = 'Read this slowly in a warm, calm voice.';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'GeminiTTSProvider (integration)',
    () => {
        it.each(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'])(
            'returns WAV audio and token usage from %s',
            async (model) => {
                const usages: UsageInput[] = [];
                const metering = makeMeteringStub();
                metering.batchIncrementUsages = async (_actor, entries) => {
                    usages.push(...entries);
                    return {} as never;
                };
                const provider = new GeminiTTSProvider(metering, {
                    apiKey: optionalEnv(ENV_VAR)!,
                });

                const result = await withTestActor(() =>
                    provider.synthesize({
                        text: TEXT,
                        model,
                        voice: 'kore',
                        instructions: INSTRUCTIONS,
                    }),
                );

                expect(result).toMatchObject({ content_type: 'audio/wav' });
                const wav = await readStreamResult(result);
                expect(wav.length).toBeGreaterThan(44);
                expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
                expect(wav.toString('latin1', 8, 12)).toBe('WAVE');

                const input = usages.find(
                    (u) => u.usageType === `gemini:${model}:input`,
                );
                const output = usages.find(
                    (u) => u.usageType === `gemini:${model}:output:audio`,
                );
                // Text and style together are a few dozen tokens; anything
                // near the reply size would mean the JSON was counted.
                expect(input?.usageAmount).toBeGreaterThan(0);
                expect(input?.usageAmount).toBeLessThan(200);
                expect(output?.usageAmount).toBeGreaterThan(0);

                const audioDir = optionalEnv(AUDIO_DIR_ENV_VAR);
                if (audioDir) {
                    await mkdir(audioDir, { recursive: true });
                    await writeFile(join(audioDir, `${model}.wav`), wav);
                }
            },
            INTEGRATION_TEST_TIMEOUT_MS,
        );
    },
);


describe.skipIf(skipUnlessEnv(ENV_VAR))('Gemini TTS authenticated HTTP (integration)', () => {
    it('returns WAV through the public driver route', async () => {
        const env = await setupPuterTestEnv({
            providers: {
                gemini: { apiKey: optionalEnv(ENV_VAR)! },
                ollama: { enabled: false },
            },
            unlimitedMetering: true,
            extensions: [],
        });
        try {
            const endpoint = new URL('/drivers/call', env.apiOrigin);
            const host = endpoint.host;
            endpoint.hostname = '127.0.0.1';
            const response = await axios.request({
                url: endpoint.toString(),
                method: 'POST',
                responseType: 'arraybuffer',
                validateStatus: () => true,
                headers: {
                    Authorization: `Bearer ${env.users.user.apiToken}`,
                    Origin: env.apiOrigin,
                    Host: host,
                },
                data: {
                    interface: 'puter-tts',
                    method: 'synthesize',
                    args: {
                        provider: 'gemini',
                        model: 'gemini-3.8-flash-lite-tts',
                        text: TEXT,
                        instructions: INSTRUCTIONS,
                    },
                },
            });
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('audio/wav');
            const wav = Buffer.from(response.data);
            expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
            expect(wav.toString('latin1', 8, 12)).toBe('WAVE');
        } finally {
            await env.shutdown();
        }
    }, INTEGRATION_TEST_TIMEOUT_MS);
});
