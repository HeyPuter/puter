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
 * Integration test for the Claude provider.
 *
 * Hits the real Anthropic API with a tiny prompt against the cheapest
 * model (Haiku) so the smoke check runs fast and doesn't accumulate
 * cost. Skipped automatically when `PUTER_TEST_AI_CLAUDE_API_KEY` is
 * not set; in CI, only triggered when the Claude provider source
 * actually changes (see `.github/workflows/ai-provider-integration-tests.yaml`).
 */

import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { ClaudeProvider } from './ClaudeProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_CLAUDE_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))('ClaudeProvider (integration)', () => {
    const buildProvider = () =>
        new ClaudeProvider(
            makeMeteringStub(),
            // Stores / FS only consulted for `puter_path` uploads — text-only
            // prompts never reach those code paths.
            { fsEntry: undefined as never, s3Object: undefined as never },
            undefined as never,
            { apiKey: optionalEnv(ENV_VAR)! },
        );

    it('returns a non-empty completion from claude-haiku-4-5', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const provider = buildProvider();
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'Say hi in one word.' }],
                max_tokens: 16,
            }),
        );

        expect(result).toHaveProperty('message');
        const content = (result as { message: { content: unknown } }).message
            .content as Array<{ type: string; text?: string }>;
        expect(Array.isArray(content)).toBe(true);
        const text = content.find((c) => c.type === 'text')?.text ?? '';
        expect(text.length).toBeGreaterThan(0);
    });
});
