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
 * Integration test for the BytePlus ModelArk image provider.
 *
 * Generates one 1K image on seedream-4-0 (the cheapest catalog entry,
 * $0.03/image). Skipped when `PUTER_TEST_AI_BYTEPLUS_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { BytePlusImageProvider } from './BytePlusImageProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_BYTEPLUS_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'BytePlusImageProvider (integration)',
    () => {
        it(
            'generates an image URL from seedream-4-0',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = new BytePlusImageProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                );

                const url = await withTestActor(() =>
                    provider.generate({
                        model: 'seedream-4-0',
                        prompt: 'a single red dot on a white background',
                        quality: '1k',
                    }),
                );

                expect(typeof url).toBe('string');
                expect(
                    url.startsWith('https://') || url.startsWith('data:'),
                ).toBe(true);
            },
        );
    },
);
