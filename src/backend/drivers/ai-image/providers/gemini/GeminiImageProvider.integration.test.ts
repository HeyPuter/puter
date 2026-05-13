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
 * Integration test for the Gemini image generation provider.
 *
 * Uses `imagen-4.0-fast-generate-001` ($0.02/image — cheapest
 * Gemini imagen variant). Skipped when `PUTER_TEST_AI_GEMINI_API_KEY`
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
import { GeminiImageProvider } from './GeminiImageProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_GEMINI_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'GeminiImageProvider (integration)',
    () => {
        it('returns image data from imagen-4.0-fast', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new GeminiImageProvider(
                { apiKey: optionalEnv(ENV_VAR)! },
                makeMeteringStub(),
            );

            const result = await withTestActor(() =>
                provider.generate({
                    model: 'imagen-4.0-fast-generate-001',
                    prompt: 'a tiny red dot on a white background',
                    ratio: { w: 1, h: 1 },
                }),
            );

            expect(typeof result).toBe('string');
            expect((result as string).length).toBeGreaterThan(0);
        });
    },
);
