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

/** Error code set by the pool-acquisition timeout in SQLBatcher. */
export const POOL_ACQUIRE_TIMEOUT = 'POOL_ACQUIRE_TIMEOUT';

const RETRIABLE_ERROR_CODES = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    POOL_ACQUIRE_TIMEOUT,
]);

const RETRIABLE_ERROR_MESSAGES = [
    'Connection lost',
    'read ECONNRESET',
    'ETIMEDOUT',
];

/**
 * Failures where the statement provably never reached the server, so a
 * retry can never double-apply it — safe even for writes. Anything that
 * can occur after the statement was sent (resets, protocol drops) is
 * deliberately excluded: the server may have committed before the
 * connection died.
 */
const NEVER_SENT_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    POOL_ACQUIRE_TIMEOUT,
]);

const errorCode = (error: unknown): string | undefined =>
    (error as { code?: string } | null)?.code;

/**
 * Transient connection-level failures worth retrying — but only for
 * statements that are safe to run twice (reads). Row-level errors
 * (duplicate key, constraint violations) are deterministic and never
 * match.
 */
export const isRetriableError = (error: unknown): boolean => {
    const code = errorCode(error);
    if (code && RETRIABLE_ERROR_CODES.has(code)) return true;

    const msg = String((error as Error)?.message ?? '');
    return RETRIABLE_ERROR_MESSAGES.some((m) => msg.includes(m));
};

export const isNeverSentError = (error: unknown): boolean => {
    const code = errorCode(error);
    return Boolean(code && NEVER_SENT_ERROR_CODES.has(code));
};
