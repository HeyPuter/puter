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

import { PuterService } from '../types';

/**
 * Applies `outer.cacheUpdate` from peer regions.
 *
 * `PuterStore.publishCacheKeys({ broadcast: true })` writes its own cluster's
 * Redis and emits the same mutation for peers; `BroadcastService` ships it over
 * a webhook. Nothing consumed it on the far side, so cross-region cache
 * replication silently no-oped.
 *
 * Always deletes, never re-writes the sender's payload: their value was derived
 * from their own replica, so forcing a re-read here is the conservative move.
 */
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
            void this.#invalidate(keys);
        });
    }

    // Pipelined rather than a multi-key DEL, which would CROSSSLOT on Valkey.
    async #invalidate(keys: string[]): Promise<void> {
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const key of keys) pipeline.del(key);
            await pipeline.exec();
        } catch {
            console.warn(
                '[CacheReplicationService] failed to apply remote cache update:',
                keys,
            );
        }
    }
}
