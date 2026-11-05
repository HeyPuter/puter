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

import type { CompiledMatch } from './matcher.js';

/**
 * Compiled match filters, by subscription.
 *
 * Bounded and least-recently-used, like the other dispatch caches. The TTL is
 * what forgets a subscription ended in another process: only the process that
 * handled the unsubscribe runs `forget`, and every other one would otherwise
 * hold its matcher for good.
 */

export const MATCHER_CACHE_MAX_ENTRIES = 20_000;

/** Long enough that a busy subscription recompiles rarely; compiling is cheap. */
export const MATCHER_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
    matcher: CompiledMatch;
    cachedAt: number;
}

export class MatcherCache {
    readonly #entries = new Map<string, CacheEntry>();
    readonly #maxEntries: number;
    readonly #ttlMs: number;

    constructor(
        maxEntries: number = MATCHER_CACHE_MAX_ENTRIES,
        ttlMs: number = MATCHER_CACHE_TTL_MS,
    ) {
        this.#maxEntries = Math.max(1, maxEntries);
        this.#ttlMs = Math.max(0, ttlMs);
    }

    get size(): number {
        return this.#entries.size;
    }

    /**
     * The matcher for one subscription's pattern, compiled on a miss. A row
     * whose pattern moved (a re-anchor rewrites it) misses on the comparison.
     */
    get(
        subId: string,
        pattern: string,
        compile: (pattern: string) => CompiledMatch,
    ): CompiledMatch {
        const entry = this.#entries.get(subId);
        if (
            entry &&
            entry.matcher.pattern === pattern &&
            Date.now() - entry.cachedAt <= this.#ttlMs
        ) {
            this.#entries.delete(subId);
            this.#entries.set(subId, entry);
            return entry.matcher;
        }

        const matcher = compile(pattern);
        this.#entries.delete(subId);
        this.#entries.set(subId, { matcher, cachedAt: Date.now() });
        while (this.#entries.size > this.#maxEntries) {
            const oldest = this.#entries.keys().next();
            if (oldest.done) break;
            this.#entries.delete(oldest.value);
        }
        return matcher;
    }

    forget(subId: string): void {
        this.#entries.delete(subId);
    }

    clear(): void {
        this.#entries.clear();
    }
}
