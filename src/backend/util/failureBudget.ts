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

import {
    checkRateLimit,
    peekRateLimit,
} from '../core/http/middleware/rateLimit.js';

/** One window of a budget of failures, such as wrong passwords. */
export interface FailureLimit {
    scope: string;
    limit: number;
    window: number;
}

/** Whether every window of a failure budget has room left. Fails open. */
export const failureBudgetOpen = async (
    limits: readonly FailureLimit[],
    subject: string,
    backend?: 'kv' | 'redis',
): Promise<boolean> =>
    (
        await Promise.all(
            limits.map(({ scope, limit, window }) =>
                peekRateLimit(`${scope}:${subject}`, limit, window, backend),
            ),
        )
    ).every(Boolean);

/** Charge one failure to every window of a budget. */
export const chargeFailure = async (
    limits: readonly FailureLimit[],
    subject: string,
    backend?: 'kv',
): Promise<void> => {
    await Promise.all(
        limits.map(({ scope, limit, window }) =>
            checkRateLimit(`${scope}:${subject}`, limit, window, backend),
        ),
    );
};
