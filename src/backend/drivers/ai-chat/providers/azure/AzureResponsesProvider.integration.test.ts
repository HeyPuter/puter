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
 * Integration test for the Azure AI Foundry Responses provider.
 *
 * Hits the real Azure endpoint with `gpt-5-codex` — a Responses-API-only
 * (Codex) model that the Chat Completions endpoint rejects. This verifies
 * the completions/responses split actually routes Codex correctly. Codex is
 * a reasoning model, so we give it a generous `max_tokens` and low reasoning
 * effort to leave room for visible output.
 *
 * Skipped unless both `PUTER_TEST_AI_AZURE_OPENAI_API_KEY` and
 * `PUTER_TEST_AI_AZURE_OPENAI_API_URL` are set.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { AzureResponsesProvider } from './AzureResponsesProvider.js';

const KEY_ENV = 'PUTER_TEST_AI_AZURE_OPENAI_API_KEY';
const URL_ENV = 'PUTER_TEST_AI_AZURE_OPENAI_API_URL';

describe.skipIf(skipUnlessEnv(KEY_ENV) || skipUnlessEnv(URL_ENV))(
    'AzureResponsesProvider (integration)',
    () => {
        it(
            'returns a non-empty completion from gpt-5-codex',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = new AzureResponsesProvider(
                    makeMeteringStub(),
                    {
                        fsEntry: undefined as never,
                        s3Object: undefined as never,
                    },
                    undefined as never,
                    {
                        apiKey: optionalEnv(KEY_ENV)!,
                        apiURL: optionalEnv(URL_ENV)!,
                    },
                );

                const result = await withTestActor(() =>
                    provider.complete({
                        model: 'gpt-5-codex',
                        messages: [
                            { role: 'user', content: 'Say hi in one word.' },
                        ],
                        max_tokens: 2048,
                        reasoning: { effort: 'low' },
                    }),
                );

                const text = (result as { message?: { content?: string } })
                    .message?.content;
                expect(typeof text === 'string' && text.length > 0).toBe(true);
            },
        );
    },
);
