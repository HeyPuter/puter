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
 * Integration test for the Kling image provider.
 *
 * Generates one 1K image on kling-v2-1 ($0.014/image). Skipped when
 * `PUTER_TEST_AI_KLING_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { KlingImageProvider } from './KlingImageProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_KLING_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'KlingImageProvider (integration)',
    () => {
        it(
            'generates an image URL from kling-v2-1',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = new KlingImageProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                );

                const url = await withTestActor(() =>
                    provider.generate({
                        model: 'kling-v2-1',
                        prompt: 'a single red dot on a white background',
                        quality: '1k',
                    }),
                );

                expect(url.startsWith('https://')).toBe(true);
            },
        );
    },
);
