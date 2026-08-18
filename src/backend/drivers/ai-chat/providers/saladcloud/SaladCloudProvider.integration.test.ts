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

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { SaladCloudProvider } from './SaladCloudProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_SALADCLOUD_API_KEY';
const stores = {} as ConstructorParameters<typeof SaladCloudProvider>[2];
const fsService = {} as ConstructorParameters<typeof SaladCloudProvider>[3];

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'SaladCloudProvider (integration)',
    () => {
        it(
            'returns a non-empty completion via SaladCloud',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = new SaladCloudProvider(
                    { apiKey: optionalEnv(ENV_VAR)! },
                    makeMeteringStub(),
                    stores,
                    fsService,
                );

                const result = await withTestActor(() =>
                    provider.complete({
                        model: 'saladcloud:qwen3.6-35b-a3b',
                        messages: [
                            { role: 'user', content: 'Say hi in one word.' },
                        ],
                        max_tokens: 16,
                    }),
                );

                const text = (result as { message?: { content?: string } })
                    .message?.content;
                expect(typeof text === 'string' && text.length > 0).toBe(true);
            },
        );
    },
);
