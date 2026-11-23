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

// A retry on a fixed cadence turns one broken dependency into a permanent load
// on it, so the wait doubles per attempt up to a ceiling.

/** Wait before the first retry. */
export const EVENTS_RETRY_BASE_MS = 2_000;

/** Longest wait between retries, however many have failed. */
export const EVENTS_RETRY_MAX_MS = 5 * 60 * 1000;

/** `baseMs` after the first failure, doubling per failure up to `maxMs`. */
export const doublingBackoffMs = (
    attempts: number,
    { baseMs, maxMs }: { baseMs: number; maxMs: number },
): number => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));

/** How long to wait after `attempts` failures in a row. */
export const deliveryBackoffMs = (attempts: number): number =>
    doublingBackoffMs(attempts, {
        baseMs: EVENTS_RETRY_BASE_MS,
        maxMs: EVENTS_RETRY_MAX_MS,
    });

/**
 * A `Retry-After` header in ms: decimal seconds or an HTTP date (a past date
 * reads as 0). Null when absent or unreadable.
 */
export const parseRetryAfterMs = (value: unknown): number | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
    const at = Date.parse(trimmed);
    return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};
