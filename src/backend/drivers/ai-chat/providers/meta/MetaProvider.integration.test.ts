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
 * Integration test for the Meta Model API (Muse Spark) provider.
 *
 * Muse Spark always reasons, and those tokens come out of the same output
 * budget, so a tight `max_tokens` comes back as `content: null` with
 * `finish_reason: 'length'` — hence the generous cap on a one-word prompt.
 * Skipped when `PUTER_TEST_AI_META_API_KEY` is unset.
 */

import { describe, expect, it } from 'vitest';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { MetaProvider } from './MetaProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_META_API_KEY';

// Only `puter_path` content parts reach the filesystem, and this test sends
// plain text, so the stores stay untouched.
const UNUSED_STORES = {} as { fsEntry: FSEntryStore; s3Object: S3ObjectStore };
const UNUSED_FS_SERVICE = {} as FSService;

describe.skipIf(skipUnlessEnv(ENV_VAR))('MetaProvider (integration)', () => {
    it(
        'returns a non-empty completion from muse-spark-1.2',
        { timeout: INTEGRATION_TEST_TIMEOUT_MS },
        async () => {
            const provider = new MetaProvider(
                makeMeteringStub(),
                UNUSED_STORES,
                UNUSED_FS_SERVICE,
                { apiKey: optionalEnv(ENV_VAR)! },
            );

            const result = await withTestActor(() =>
                provider.complete({
                    model: 'muse-spark-1.2',
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: 2048,
                    reasoning_effort: 'low',
                }),
            );

            const text = (result as { message?: { content?: string } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
        },
    );
});
