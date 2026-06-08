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
 * Integration test for the Azure AI Foundry chat-completions provider.
 *
 * Hits the real Azure endpoint. Exercises both flavours of model the
 * provider fronts:
 *   - an OpenAI model (`gpt-4o`, non-reasoning so `max_tokens=16` returns
 *     visible text), and
 *   - an xAI Grok model (`grok-4-20-non-reasoning`), which regression-tests
 *     the `safety_identifier` param being stripped for Grok (Azure's Grok
 *     deployments 400 on that OpenAI-only argument).
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
import { AzureChatProvider } from './AzureChatProvider.js';

const KEY_ENV = 'PUTER_TEST_AI_AZURE_OPENAI_API_KEY';
const URL_ENV = 'PUTER_TEST_AI_AZURE_OPENAI_API_URL';

describe.skipIf(skipUnlessEnv(KEY_ENV) || skipUnlessEnv(URL_ENV))(
    'AzureChatProvider (integration)',
    () => {
        const buildProvider = () =>
            new AzureChatProvider(
                makeMeteringStub(),
                { fsEntry: undefined as never, s3Object: undefined as never },
                undefined as never,
                { apiKey: optionalEnv(KEY_ENV)!, apiURL: optionalEnv(URL_ENV)! },
            );

        const expectNonEmptyText = (result: unknown) => {
            const text = (result as { message?: { content?: string } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
        };

        it(
            'returns a non-empty completion from gpt-4o',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = buildProvider();
                const result = await withTestActor(() =>
                    provider.complete({
                        model: 'gpt-4o',
                        messages: [
                            { role: 'user', content: 'Say hi in one word.' },
                        ],
                        max_tokens: 16,
                    }),
                );
                expectNonEmptyText(result);
            },
        );

        it(
            'returns a non-empty completion from grok-4-20-non-reasoning (no safety_identifier 400)',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const provider = buildProvider();
                const result = await withTestActor(() =>
                    provider.complete({
                        model: 'grok-4-20-non-reasoning',
                        messages: [
                            { role: 'user', content: 'Say hi in one word.' },
                        ],
                        max_tokens: 16,
                    }),
                );
                expectNonEmptyText(result);
            },
        );
    },
);
