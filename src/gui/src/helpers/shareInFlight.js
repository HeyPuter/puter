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
 * Wraps an async call so overlapping callers share one call: until the
 * first settles, every caller gets its promise. The next call after it
 * settles starts afresh, so nothing is cached.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {() => Promise<T>}
 */
export default function shareInFlight (fn) {
    let pending = null;
    return () => {
        pending ??= Promise.resolve().then(fn).finally(() => {
            pending = null;
        });
        return pending;
    };
}
