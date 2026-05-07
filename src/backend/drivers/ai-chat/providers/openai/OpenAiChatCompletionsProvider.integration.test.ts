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
 * Integration test for the OpenAI chat-completions provider.
 *
 * Hits the real OpenAI API with `gpt-4o-mini` — non-reasoning so
 * `max_tokens=16` actually returns visible text (reasoning models like
 * `gpt-5-nano` would burn the budget on thinking tokens before
 * emitting any response). Skipped when `PUTER_TEST_AI_OPENAI_API_KEY`
 * is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { OpenAiChatProvider } from './OpenAiChatCompletionsProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_OPENAI_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'OpenAiChatCompletionsProvider (integration)',
    () => {
        const buildProvider = () =>
            new OpenAiChatProvider(
                makeMeteringStub(),
                { fsEntry: undefined as never, s3Object: undefined as never },
                undefined as never,
                { apiKey: optionalEnv(ENV_VAR)! },
            );

        it('returns a non-empty completion from gpt-4o-mini', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = buildProvider();
            const result = await withTestActor(() =>
                provider.complete({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: 16,
                }),
            );

            // OpenAIUtil returns the OpenAI choice object directly.
            const text = (result as { message?: { content?: string } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
        });
    },
);
