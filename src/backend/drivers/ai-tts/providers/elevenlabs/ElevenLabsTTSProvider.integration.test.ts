/**
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
 * Integration test for the ElevenLabs TTS provider.
 *
 * Uses `eleven_flash_v2_5` (the cheapest tier) with a tiny input.
 * Skipped when `PUTER_TEST_AI_ELEVENLABS_API_KEY` is unset.
 */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { ElevenLabsTTSProvider } from './ElevenLabsTTSProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_ELEVENLABS_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'ElevenLabsTTSProvider (integration)',
    () => {
        it('returns an audio stream from eleven_flash_v2_5', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new ElevenLabsTTSProvider(makeMeteringStub(), {
                apiKey: optionalEnv(ENV_VAR)!,
            });

            const result = (await withTestActor(() =>
                provider.synthesize({
                    text: 'hi',
                    model: 'eleven_flash_v2_5',
                }),
            )) as { stream: Readable; content_type: string };

            expect(result.stream).toBeInstanceOf(Readable);
            const chunks: Buffer[] = [];
            for await (const chunk of result.stream) {
                chunks.push(chunk as Buffer);
            }
            const total = chunks.reduce((n, c) => n + c.length, 0);
            expect(total).toBeGreaterThan(0);
        });
    },
);
