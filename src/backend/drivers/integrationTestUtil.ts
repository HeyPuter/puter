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
 * Shared utilities for AI provider integration tests.
 *
 * Each test reads its credentials from `PUTER_TEST_AI_*` env vars
 * (loaded by the vitest config's `PUTER_` prefix) and skips itself
 * when the var is missing — tests run only on developer machines and
 * in CI environments that supply the right secrets.
 *
 * Filename intentionally omits `.test.` so vitest does not treat this
 * helper as a test file.
 */

import type { Actor } from '../core/actor.js';
import { SYSTEM_ACTOR } from '../core/actor.js';
import { runWithContext } from '../core/context.js';
import type { MeteringService } from '../services/metering/MeteringService.js';

/**
 * Returns the env var value, or `undefined` if missing/empty.
 * Used as the gate for `describe.skipIf` blocks.
 */
export const optionalEnv = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
};

/**
 * Returns true when the env var is unset, signaling the test block
 * should be skipped. Pair with `describe.skipIf(skipUnlessEnv(...))`.
 */
export const skipUnlessEnv = (name: string): boolean => !optionalEnv(name);

/**
 * Per-test timeout for provider integration tests. The default 5s
 * vitest timeout is way too short for real API calls — image
 * generation in particular routinely takes 15–30s. Pass this as the
 * third argument to `it(...)`.
 */
export const INTEGRATION_TEST_TIMEOUT_MS = 90_000;

/**
 * Returns a no-op MeteringService stub. Real metering would write to
 * DynamoDB / Redis, which integration tests for AI providers don't
 * care about — we just need the provider's metering calls to not
 * throw and to short-circuit credit checks.
 */
export const makeMeteringStub = (): MeteringService =>
    ({
        utilRecordUsageObject: () => Promise.resolve([] as never),
        incrementUsage: () => Promise.resolve({} as never),
        batchIncrementUsages: () => Promise.resolve([] as never),
        hasEnoughCredits: () => Promise.resolve(true),
        getReportedCosts: () => [],
    }) as unknown as MeteringService;

/**
 * Run `fn` inside a request-scoped context with `SYSTEM_ACTOR` set,
 * which is what providers expect (`Context.get('actor')`). The system
 * actor bypasses metering / quota gates by design.
 */
export const withTestActor = <T>(
    fn: () => T | Promise<T>,
    actor: Actor = SYSTEM_ACTOR,
): Promise<T> =>
    Promise.resolve(
        runWithContext({ actor, requestId: 'integration-test' }, fn),
    );
