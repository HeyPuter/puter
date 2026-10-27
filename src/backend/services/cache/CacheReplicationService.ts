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
    CACHE_TOMBSTONE_SUFFIX,
    CACHE_TOMBSTONE_TTL_SECONDS,
    isCacheTombstoneKey,
} from '../../stores/types';
import { PuterService } from '../types';

/** Applies peer invalidations, evicting rows that raced a delayed tombstone. */
export class CacheReplicationService extends PuterService {
    override onServerStart(): void {
        this.clients.event.on('outer.cacheUpdate', (_key, data, meta) => {
            if (!(meta as { from_outside?: boolean })?.from_outside) return;
            const raw = (data as { cacheKey?: unknown })?.cacheKey;
            if (!Array.isArray(raw)) return;
            const keys = raw.filter(
                (key): key is string => typeof key === 'string' && key !== '',
            );
            if (keys.length === 0) return;
            const hasData = (data as { data?: unknown })?.data !== undefined;
            return this.#invalidate(keys, hasData);
        });
    }

    // Pipelined so keys can live in different cache slots.
    async #invalidate(keys: string[], hasData: boolean): Promise<void> {
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const key of keys) {
                if (hasData && isCacheTombstoneKey(key)) {
                    pipeline.set(key, '1', 'EX', CACHE_TOMBSTONE_TTL_SECONDS);
                    pipeline.del(key.slice(0, -CACHE_TOMBSTONE_SUFFIX.length));
                } else {
                    pipeline.del(key);
                }
            }
            await pipeline.exec();
        } catch {
            console.warn(
                '[CacheReplicationService] failed to apply remote cache update:',
                keys,
            );
        }
    }
}
