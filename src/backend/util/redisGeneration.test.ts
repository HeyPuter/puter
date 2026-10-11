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

import MockRedis from 'ioredis-mock';
import type { Cluster } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { bumpGeneration } from './redisGeneration';

const redis = new MockRedis() as unknown as Cluster;
const freshKey = () => `gen-test:${Math.random().toString(36).slice(2)}`;

describe('bumpGeneration', () => {
    it('increments from zero and renews the TTL each time', async () => {
        const key = freshKey();
        expect(await bumpGeneration(redis, key, 60)).toBe(1);
        await redis.expire(key, 5);
        expect(await bumpGeneration(redis, key, 60)).toBe(2);
        expect(await redis.ttl(key)).toBeGreaterThan(5);
    });

    it('sends the increment and the expiry in one round trip', async () => {
        const pipeline = vi.spyOn(redis, 'pipeline');
        const incr = vi.spyOn(redis, 'incr');
        try {
            await bumpGeneration(redis, freshKey(), 60);
            expect(pipeline).toHaveBeenCalledTimes(1);
            expect(incr).not.toHaveBeenCalled();
        } finally {
            pipeline.mockRestore();
            incr.mockRestore();
        }
    });

    it('throws the error redis reports for either command', async () => {
        const failing = {
            pipeline: () => {
                const chain = {
                    incr: () => chain,
                    expire: () => chain,
                    exec: async () => [
                        [new Error('WRONGTYPE not an integer'), null],
                        [null, 1],
                    ],
                };
                return chain;
            },
        } as unknown as Cluster;
        await expect(bumpGeneration(failing, freshKey(), 60)).rejects.toThrow(
            'WRONGTYPE',
        );
    });
});
