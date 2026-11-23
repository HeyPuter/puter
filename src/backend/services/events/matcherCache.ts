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

import { BoundedTtlMap } from '../../util/boundedTtlMap.js';
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

export class MatcherCache {
    readonly #entries: BoundedTtlMap<string, CompiledMatch>;

    constructor(
        maxEntries: number = MATCHER_CACHE_MAX_ENTRIES,
        ttlMs: number = MATCHER_CACHE_TTL_MS,
    ) {
        this.#entries = new BoundedTtlMap({ maxEntries, ttlMs });
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
        const cached = this.#entries.get(subId);
        if (cached && cached.pattern === pattern) return cached;
        const matcher = compile(pattern);
        this.#entries.set(subId, matcher);
        return matcher;
    }

    forget(subId: string): void {
        this.#entries.delete(subId);
    }

    clear(): void {
        this.#entries.clear();
    }
}
