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
 * Integration test for the Kling TTS provider ($0.007/request). Skipped when
 * `PUTER_TEST_AI_KLING_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    readStreamResult,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { KlingTTSProvider } from './KlingTTSProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_KLING_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'KlingTTSProvider (integration)',
    () => {
        it(
            'returns MP3 audio from kling-tts',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = new KlingTTSProvider(makeMeteringStub(), {
                    apiKey: optionalEnv(ENV_VAR)!,
                });

                const result = await withTestActor(() =>
                    provider.synthesize({ text: 'hi', model: 'kling-tts' }),
                );
                const audio = await readStreamResult(result);

                expect(audio.length).toBeGreaterThan(0);
                expect(audio.subarray(0, 3).toString()).toBe('ID3');
            },
        );
    },
);
