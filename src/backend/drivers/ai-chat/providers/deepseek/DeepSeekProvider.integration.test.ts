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
 * Integration test for the DeepSeek provider.
 *
 * Uses `deepseek-chat` (the cheap V3 chat model, provider default).
 * Skipped when `PUTER_TEST_AI_DEEPSEEK_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { DeepSeekProvider } from './DeepSeekProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_DEEPSEEK_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'DeepSeekProvider (integration)',
    () => {
        it('returns a non-empty completion from deepseek-chat', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new DeepSeekProvider(
                { apiKey: optionalEnv(ENV_VAR)! },
                makeMeteringStub(),
            );

            const result = await withTestActor(() =>
                provider.complete({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: 16,
                }),
            );

            const text = (result as { message?: { content?: string } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
        });
    },
);
