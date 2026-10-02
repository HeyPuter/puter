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
 * Integration test for the Together AI provider.
 *
 * Uses `meta-llama/Llama-3.3-70B-Instruct-Turbo`, a serverless
 * non-reasoning model, so a tiny max_tokens still yields visible text
 * (reasoning models spend it on hidden reasoning), and
 * `deepseek-ai/DeepSeek-V4-Flash-0731` for the context-overflow retry.
 * If either leaves the serverless tier, pick a replacement from
 * https://api.together.ai/models?type=serverless. Skipped
 * when `PUTER_TEST_AI_TOGETHER_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { TogetherAIProvider } from './TogetherAIProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_TOGETHER_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'TogetherAIProvider (integration)',
    () => {
        it('returns a non-empty completion from Llama 3.3 70B', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new TogetherAIProvider(
                { apiKey: optionalEnv(ENV_VAR)! },
                makeMeteringStub(),
            );

            const result = await withTestActor(() =>
                provider.complete({
                    model: 'togetherai:meta-llama/Llama-3.3-70B-Instruct-Turbo',
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

        it('recovers when max_tokens leaves no room for the prompt', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new TogetherAIProvider(
                { apiKey: optionalEnv(ENV_VAR)! },
                makeMeteringStub(),
            );

            // Asking for the model's whole context as output leaves no room
            // for the prompt, which Together rejects outright — the provider
            // should retry uncapped rather than surface a 400. This model's
            // rejection reports both the window and the prompt's token count.
            const model = (await provider.models()).find(
                (m) => m.id === 'togetherai:deepseek-ai/DeepSeek-V4-Flash-0731',
            )!;

            const result = await withTestActor(() =>
                provider.complete({
                    model: model.id,
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: model.context!,
                }),
            );

            const text = (result as { message?: { content?: string } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
        });
    },
);
