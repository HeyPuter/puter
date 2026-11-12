/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

/**
 * Env-var gates for tests that need something outside the repo, such as a
 * provider key or a real database. Apart from `testUtil.ts` so a suite can read
 * its gate without importing the server.
 *
 * Filename omits `.test.` so vitest does not treat this helper as a test file.
 */

/**
 * Returns the env var value, or `undefined` if missing/empty. Used as the gate
 * for `describe.skipIf` blocks.
 */
export const optionalEnv = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
};

/**
 * Returns true when the env var is unset, signaling the test block should be
 * skipped. Pair with `describe.skipIf(skipUnlessEnv(...))`.
 */
export const skipUnlessEnv = (name: string): boolean => !optionalEnv(name);
