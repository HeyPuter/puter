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
 * Integration test for the BytePlus ModelArk video provider.
 *
 * Generates a 2s 480p clip on seedance-1-0-pro-fast (~$0.02). Video tasks
 * poll for completion, so the timeout is generous. Skipped when
 * `PUTER_TEST_AI_BYTEPLUS_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { BytePlusVideoProvider } from './BytePlusVideoProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_BYTEPLUS_API_KEY';
// Task-based generation routinely takes a couple of minutes.
const VIDEO_TIMEOUT_MS = 5 * 60 * 1000;

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'BytePlusVideoProvider (integration)',
    () => {
        it(
            'generates a video URL from seedance-1-0-pro-fast',
            { timeout: VIDEO_TIMEOUT_MS },
            async () => {
                const provider = new BytePlusVideoProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                );

                const url = await withTestActor(() =>
                    provider.generate({
                        model: 'seedance-1-0-pro-fast',
                        prompt: 'a red ball rolls to the right',
                        resolution: '480p',
                        seconds: 2,
                    }),
                );

                expect(typeof url).toBe('string');
                expect((url as string).startsWith('https://')).toBe(true);
            },
        );
    },
);
