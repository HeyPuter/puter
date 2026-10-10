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

/** How long a fetched gateway catalog is served before it's fetched again. */
export const CATALOG_TTL_MS = 15 * 60 * 1000;

export interface CachedRemoteCatalogOptions<T> {
    /** Names the catalog in the warning a failed fetch logs. */
    name: string;
    fetch: (signal: AbortSignal) => Promise<T>;
    /** What callers get when the first fetch fails. */
    fallback: T;
    ttlMs?: number;
    timeoutMs?: number;
    /** How long a failure is remembered before the upstream is asked again. */
    failureTtlMs?: number;
}

/**
 * A remote catalog (a gateway's model list, an account's quota) fetched on
 * demand and served from memory for `ttlMs`. Concurrent callers share one
 * fetch, a fetch past `timeoutMs` is abandoned, and a failure is remembered for
 * `failureTtlMs` so a down upstream isn't asked again on every request. A
 * failed refresh keeps serving the last good value. An outage logs once, not
 * once per retry.
 */
export const cachedRemoteCatalog = <T>({
    name,
    fetch,
    fallback,
    ttlMs = CATALOG_TTL_MS,
    timeoutMs = 10_000,
    failureTtlMs = 30_000,
}: CachedRemoteCatalogOptions<T>): (() => Promise<T>) => {
    let last: { value: T } | undefined;
    let freshUntil = 0;
    let retryAt = 0;
    let inFlight: Promise<T> | undefined;
    let failing = false;

    const load = async (): Promise<T> => {
        try {
            const value = await fetch(AbortSignal.timeout(timeoutMs));
            last = { value };
            freshUntil = Date.now() + ttlMs;
            failing = false;
            return value;
        } catch (e) {
            retryAt = Date.now() + failureTtlMs;
            if (!failing) {
                console.warn(
                    `[ai-chat] ${name} fetch failed: ${(e as Error)?.message ?? e}`,
                );
            }
            failing = true;
            return last ? last.value : fallback;
        }
    };

    return async () => {
        const now = Date.now();
        if (last && now < freshUntil) return last.value;
        if (now < retryAt) return last ? last.value : fallback;
        if (inFlight) return inFlight;
        const pending = load();
        inFlight = pending;
        try {
            return await pending;
        } finally {
            if (inFlight === pending) inFlight = undefined;
        }
    };
};
