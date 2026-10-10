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
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RedisClient } from '../clients/redis/RedisClient.ts';
import type { IConfig } from '../types';
import { withRedisLock } from './redisLock.ts';

const redis = new RedisClient({
    port: 0,
    extensions: [],
    redis: {},
} as unknown as IConfig);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const lockKey = () => `test:lock:${randomUUID()}`;

const busy = () => 'busy';

const unexpectedBusy = (): never => {
    throw new Error('lock unexpectedly busy');
};

/**
 * `redis`, except that right after the first command on `key` once it is held,
 * the claim lapses and `nextToken` takes the key: the TTL running out between a
 * holder's release round trips.
 */
const lapsingMidRelease = (key: string, nextToken: string) => {
    const state = { held: false, lapsed: false };
    const proxy = new Proxy(redis, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (!['set', 'get', 'del', 'eval'].includes(String(property)))
                return value;
            return async (...args: unknown[]) => {
                const result = await (
                    value as (...a: unknown[]) => Promise<unknown>
                ).apply(target, args);
                const touched = property === 'eval' ? args[2] : args[0];
                if (touched !== key || state.lapsed) return result;
                if (!state.held) {
                    state.held = property === 'set' && result === 'OK';
                    return result;
                }
                state.lapsed = true;
                await target.del(key);
                await target.set(key, nextToken, 'PX', 60_000, 'NX');
                return result;
            };
        },
    });
    return { proxy, state };
};

describe('withRedisLock', () => {
    afterAll(async () => {
        await redis.onServerShutdown?.();
    });

    it('runs fn under the lock and releases it after', async () => {
        const key = lockKey();
        const result = await withRedisLock(
            redis,
            key,
            async () => {
                expect(await redis.get(key)).not.toBeNull();
                return 42;
            },
            { ttlMs: 5_000, onUnavailable: 'busy', onBusy: unexpectedBusy },
        );
        expect(result).toBe(42);
        expect(await redis.get(key)).toBeNull();
    });

    it('releases the lock when fn throws', async () => {
        const key = lockKey();
        await expect(
            withRedisLock(
                redis,
                key,
                async () => {
                    throw new Error('boom');
                },
                { ttlMs: 5_000, onUnavailable: 'busy', onBusy: unexpectedBusy },
            ),
        ).rejects.toThrow('boom');
        expect(await redis.get(key)).toBeNull();
    });

    it("keeps the next holder's lock when the TTL lapsed before release", async () => {
        const key = lockKey();
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => (finish = resolve));
        let entered!: () => void;
        const inside = new Promise<void>((resolve) => (entered = resolve));

        const first = withRedisLock(
            redis,
            key,
            async () => {
                entered();
                await finished;
            },
            { ttlMs: 20, onUnavailable: 'busy', onBusy: unexpectedBusy },
        );
        await inside;
        await sleep(60);
        expect(await redis.set(key, 'next-holder', 'PX', 60_000, 'NX')).toBe(
            'OK',
        );
        finish();
        await first;

        expect(await redis.get(key)).toBe('next-holder');
    });

    it("keeps the next holder's lock when the TTL lapses mid-release", async () => {
        const key = lockKey();
        const { proxy, state } = lapsingMidRelease(key, 'next-holder');

        await withRedisLock(proxy, key, async () => undefined, {
            ttlMs: 5_000,
            onUnavailable: 'busy',
            onBusy: unexpectedBusy,
        });

        expect(state.lapsed).toBe(true);
        expect(await redis.get(key)).toBe('next-holder');
    });

    it('serializes concurrent callers', async () => {
        const key = lockKey();
        let active = 0;
        let peak = 0;
        const results = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                withRedisLock(
                    redis,
                    key,
                    async () => {
                        active++;
                        peak = Math.max(peak, active);
                        await sleep(10);
                        active--;
                        return i;
                    },
                    {
                        ttlMs: 5_000,
                        attempts: 200,
                        retryMs: 5,
                        onUnavailable: 'busy',
                        onBusy: unexpectedBusy,
                    },
                ),
            ),
        );
        expect(results).toEqual([0, 1, 2, 3, 4]);
        expect(peak).toBe(1);
        expect(await redis.get(key)).toBeNull();
    });

    it('answers onBusy once every attempt finds the lock held', async () => {
        const key = lockKey();
        await redis.set(key, 'other-holder', 'PX', 60_000);
        const set = vi.spyOn(redis, 'set');
        const fn = vi.fn(async () => 'ran');
        const onBusy = vi.fn(busy);
        try {
            const result = await withRedisLock(redis, key, fn, {
                ttlMs: 5_000,
                attempts: 3,
                retryMs: 1,
                onUnavailable: 'run',
                onBusy,
            });
            expect(result).toBe('busy');
            expect(set).toHaveBeenCalledTimes(3);
        } finally {
            set.mockRestore();
        }
        expect(fn).not.toHaveBeenCalled();
        expect(onBusy).toHaveBeenCalledWith();
        expect(await redis.get(key)).toBe('other-holder');
    });

    describe('when Redis is unavailable', () => {
        const down = new Error('redis down');
        const unavailable = {
            set: async () => {
                throw down;
            },
            eval: async () => {
                throw down;
            },
        } as unknown as RedisClient;

        it("runs fn unlocked under 'run'", async () => {
            const onBusy = vi.fn(busy);
            const result = await withRedisLock(
                unavailable,
                lockKey(),
                async () => 'ran',
                { ttlMs: 5_000, attempts: 3, onUnavailable: 'run', onBusy },
            );
            expect(result).toBe('ran');
            expect(onBusy).not.toHaveBeenCalled();
        });

        it("answers onBusy with the error under 'busy'", async () => {
            const fn = vi.fn(async () => 'ran');
            const onBusy = vi.fn(busy);
            const result = await withRedisLock(unavailable, lockKey(), fn, {
                ttlMs: 5_000,
                attempts: 3,
                onUnavailable: 'busy',
                onBusy,
            });
            expect(result).toBe('busy');
            expect(fn).not.toHaveBeenCalled();
            expect(onBusy).toHaveBeenCalledWith(down);
        });
    });
});
