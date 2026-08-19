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
 * Integration test for the Gemini Interactions chat provider.
 *
 * Hits the real `/v1beta/interactions` endpoint. Skipped when
 * `PUTER_TEST_AI_GEMINI_API_KEY` is unset.
 *
 * The thinking-tokens case is the reason this file exists rather than being
 * optional: `INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS` encodes an assumption about
 * whether Google counts thought tokens inside `total_output_tokens`, and
 * getting it wrong silently over- or under-bills every reasoning request.
 * Nothing offline can settle it — only a live response can.
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { GeminiInteractionsChatProvider } from './GeminiInteractionsChatProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_GEMINI_API_KEY';
const MODEL = 'gemini-3.7-flash';

const makeProvider = () =>
    new GeminiInteractionsChatProvider(makeMeteringStub(), {
        apiKey: optionalEnv(ENV_VAR)!,
    });

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'GeminiInteractionsChatProvider (integration)',
    () => {
        it(
            'returns a non-empty completion',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const result = await withTestActor(() =>
                    makeProvider().complete({
                        model: MODEL,
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

        it(
            'reports thought tokens as a subset of the output it bills',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const result = (await withTestActor(() =>
                    makeProvider().complete({
                        model: MODEL,
                        messages: [
                            {
                                role: 'user',
                                content:
                                    'A bat and ball cost $1.10. The bat costs $1 more than the ball. How much is the ball? Think it through.',
                            },
                        ],
                        reasoning_effort: 'high',
                    }),
                )) as { usage: Record<string, number> };

                // The adapter has already normalised to the OpenAI convention:
                // thinking is its own line, and completion_tokens is what is
                // left of the output after thinking is taken out. If Google
                // counts thoughts inside total_output_tokens after all, this
                // is where it shows up — completion_tokens collapses toward
                // zero while the model plainly produced an answer.
                expect(result.usage.thinking_tokens).toBeGreaterThan(0);
                expect(result.usage.completion_tokens).toBeGreaterThan(0);
            },
        );

        it(
            'streams text through the shared pipeline',
            { timeout: INTEGRATION_TEST_TIMEOUT_MS },
            async () => {
                const result = (await withTestActor(() =>
                    makeProvider().complete({
                        model: MODEL,
                        messages: [
                            { role: 'user', content: 'Count to three.' },
                        ],
                        stream: true,
                    }),
                )) as { stream: true };

                expect(result.stream).toBe(true);
            },
        );
    },
);
