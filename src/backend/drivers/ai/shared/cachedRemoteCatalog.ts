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

import { AsyncLocalStorage } from 'node:async_hooks';

/** How long a fetched gateway catalog is served before it's fetched again. */
export const CATALOG_TTL_MS = 15 * 60 * 1000;

/** Set while a scheduled refresh runs: when it began. */
const scheduledRefresh = new AsyncLocalStorage<{ since: number }>();

/**
 * Runs a scheduled refresh. A catalog read inside `work` waits for a copy
 * fetched since the refresh began, so a refresh never reuses the copy the
 * previous one fetched, however the two timers line up.
 */
export const refreshingCatalogs = <R>(work: () => Promise<R>): Promise<R> =>
    scheduledRefresh.run({ since: Date.now() }, work);

export interface CachedRemoteCatalogOptions<T> {
    /** Names the catalog in the warning a failed fetch logs. */
    name: string;
    fetch: (signal: AbortSignal, previous?: T) => Promise<T>;
    /** What callers get when the first fetch fails. */
    fallback: T;
    ttlMs?: number;
    timeoutMs?: number;
    /** How long a failure is remembered before the upstream is asked again. */
    failureTtlMs?: number;
    /**
     * Makes a read of an expired copy wait for the new one. For a value that
     * must never be older than `ttlMs`, such as a rate that is billed as read.
     */
    blocking?: boolean;
}

/**
 * A remote catalog (a gateway's model list, an account's quota) served from
 * memory for `ttlMs`. A read of an expired copy returns it and fetches the next
 * one in the background; only a first read, a `blocking` catalog and
 * {@link refreshingCatalogs} wait. Readers share one fetch, and a failed one
 * keeps the last good value and isn't retried for `failureTtlMs`.
 */
export const cachedRemoteCatalog = <T>({
    name,
    fetch,
    fallback,
    ttlMs = CATALOG_TTL_MS,
    timeoutMs = 10_000,
    failureTtlMs = 30_000,
    blocking = false,
}: CachedRemoteCatalogOptions<T>): (() => Promise<T>) => {
    let last: { value: T; fetchedAt: number } | undefined;
    let retryAt = 0;
    let inFlight: Promise<T> | undefined;
    let failing = false;

    // Never rejects, so a fetch nobody awaits can't become an unhandled
    // rejection.
    const load = async (): Promise<T> => {
        try {
            const value = await fetch(
                AbortSignal.timeout(timeoutMs),
                last?.value,
            );
            last = { value, fetchedAt: Date.now() };
            failing = false;
            return value;
        } catch (e) {
            retryAt = Date.now() + failureTtlMs;
            if (!failing) {
                failing = true;
                try {
                    console.warn(
                        `[ai-chat] ${name} fetch failed: ${(e as Error)?.message ?? e}`,
                    );
                } catch {
                    // A thrown value that can't be printed still only fails
                    // the fetch.
                    console.warn(`[ai-chat] ${name} fetch failed`);
                }
            }
            return last ? last.value : fallback;
        }
    };

    const revalidate = (): Promise<T> => {
        inFlight ??= load().finally(() => {
            inFlight = undefined;
        });
        return inFlight;
    };

    return async () => {
        const now = Date.now();
        const refresh = scheduledRefresh.getStore();
        if (
            last &&
            now < last.fetchedAt + ttlMs &&
            (!refresh || last.fetchedAt >= refresh.since)
        )
            return last.value;
        if (now < retryAt) return last ? last.value : fallback;
        if (last && !refresh && !blocking) {
            void revalidate();
            return last.value;
        }
        return revalidate();
    };
};
