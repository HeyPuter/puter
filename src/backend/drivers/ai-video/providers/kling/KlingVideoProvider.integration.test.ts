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
 * Integration test for the Kling video provider.
 *
 * Generates a 5s 720p clip on kling-2.5-turbo ($0.21). Skipped when
 * `PUTER_TEST_AI_KLING_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { KlingVideoProvider } from './KlingVideoProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_KLING_API_KEY';
// Task-based generation routinely takes a couple of minutes.
const VIDEO_TIMEOUT_MS = 5 * 60 * 1000;

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'KlingVideoProvider (integration)',
    () => {
        it(
            'generates a video URL from kling-2.5-turbo',
            { timeout: VIDEO_TIMEOUT_MS },
            async () => {
                const provider = new KlingVideoProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                    {} as never,
                );

                const url = await withTestActor(() =>
                    provider.generate({
                        model: 'kling-2.5-turbo',
                        prompt: 'a red ball rolls to the right',
                        resolution: '720p',
                        seconds: 5,
                    }),
                );

                expect(typeof url).toBe('string');
                expect((url as string).startsWith('https://')).toBe(true);
            },
        );
    },
);
