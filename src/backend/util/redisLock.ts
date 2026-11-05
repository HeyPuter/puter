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

import { randomUUID } from 'node:crypto';
import type { Cluster } from 'ioredis';

// Compare-and-delete in one step: a GET then DEL could delete a lock another
// holder took after ours lapsed in between.
const RELEASE_SCRIPT =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

export interface RedisLockOptions<T> {
    /** How long a holder that never releases (crashed, stalled) blocks others. */
    ttlMs: number;
    /** Claims tried before giving up, `retryMs` apart. Defaults to one. */
    attempts?: number;
    retryMs?: number;
    /** On a Redis error while claiming: run `fn` unlocked, or call `onBusy`. */
    onUnavailable: 'run' | 'busy';
    /** Every attempt found the lock held; `err` is set when Redis failed. */
    onBusy: (err?: unknown) => T | Promise<T>;
}

/**
 * Run `fn` holding `key`, claimed with a per-call token and released only while
 * that token is still the one stored.
 */
export const withRedisLock = async <T>(
    redis: Pick<Cluster, 'set' | 'eval'>,
    key: string,
    fn: () => Promise<T>,
    options: RedisLockOptions<T>,
): Promise<T> => {
    const { ttlMs, attempts = 1, retryMs = 0, onUnavailable, onBusy } = options;
    const token = randomUUID();
    let held = false;

    try {
        for (let attempt = 0; attempt < attempts; attempt++) {
            if ((await redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK') {
                held = true;
                break;
            }
            if (attempt + 1 < attempts) {
                await new Promise((resolve) => setTimeout(resolve, retryMs));
            }
        }
    } catch (err) {
        if (onUnavailable === 'run') return fn();
        return onBusy(err);
    }
    if (!held) return onBusy();

    try {
        return await fn();
    } finally {
        try {
            await redis.eval(RELEASE_SCRIPT, 1, key, token);
        } catch {
            // The TTL clears it.
        }
    }
};
