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
 * Integration test for the Mistral provider.
 *
 * Uses `mistral-small-2506` (provider default, cheapest tier). Skipped
 * when `PUTER_TEST_AI_MISTRAL_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { MistralAIProvider } from './MistralAiProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_MISTRAL_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'MistralAIProvider (integration)',
    () => {
        it('returns a non-empty completion from mistral-small', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new MistralAIProvider(
                { apiKey: optionalEnv(ENV_VAR)! },
                makeMeteringStub(),
            );

            const result = await withTestActor(() =>
                provider.complete({
                    model: 'mistral-small-2506',
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: 16,
                }),
            );

            const text = (result as { message?: { content?: unknown } }).message
                ?.content;
            // Mistral SDK may return string or array of content parts.
            const asString =
                typeof text === 'string'
                    ? text
                    : Array.isArray(text)
                      ? text
                            .map((p) =>
                                typeof p === 'string'
                                    ? p
                                    : (p as { text?: string })?.text,
                            )
                            .filter(Boolean)
                            .join('')
                      : '';
            expect(asString.length).toBeGreaterThan(0);
        });
    },
);
