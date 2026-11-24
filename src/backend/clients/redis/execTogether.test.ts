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
import { describe, expect, it, vi } from 'vitest';

import { execTogether } from './execTogether.js';
import type { RedisClient } from './RedisClient.js';

const CROSS_SHARD =
    'All keys in the pipeline should belong to the same slots allocation group';

const makeRedis = () => new MockRedis() as unknown as RedisClient;

/** Every pipeline of `redis` is refused the way a multi-shard cluster refuses one. */
const refusePipelines = (redis: RedisClient, message = CROSS_SHARD) => {
    const real = redis.pipeline.bind(redis);
    return vi.spyOn(redis, 'pipeline').mockImplementation(() => {
        const pipeline = real();
        pipeline.exec = () => Promise.reject(new Error(message));
        return pipeline;
    });
};

describe('execTogether', () => {
    it('answers each command in order from one pipeline', async () => {
        const redis = makeRedis();
        await redis.set('a', '1');
        const pipeline = vi.spyOn(redis, 'pipeline');

        expect(
            await execTogether(redis, [
                ['get', 'a'],
                ['exists', 'b'],
                ['set', 'c', '3', 'EX', 60],
            ]),
        ).toEqual([
            [null, '1'],
            [null, 0],
            [null, 'OK'],
        ]);
        expect(pipeline).toHaveBeenCalledTimes(1);
        expect(await redis.get('c')).toBe('3');
    });

    it('issues nothing for no commands', async () => {
        const redis = makeRedis();
        const pipeline = vi.spyOn(redis, 'pipeline');
        expect(await execTogether(redis, [])).toEqual([]);
        expect(pipeline).not.toHaveBeenCalled();
    });

    it('runs each command on its own when the cluster cannot route them together', async () => {
        const redis = makeRedis();
        await redis.set('a', '1');
        await redis.set('a:deleted', '1');
        refusePipelines(redis);

        expect(
            await execTogether(redis, [
                ['get', 'a'],
                ['exists', 'a:deleted'],
                ['setex', 'b', 60, '2'],
            ]),
        ).toEqual([
            [null, '1'],
            [null, 1],
            [null, 'OK'],
        ]);
        expect(await redis.get('b')).toBe('2');
    });

    it('reports a failed command in its own slot on that path', async () => {
        const redis = makeRedis();
        await redis.set('a', '1');
        refusePipelines(redis);
        vi.spyOn(redis, 'exists').mockRejectedValue(new Error('down'));

        const replies = await execTogether(redis, [
            ['get', 'a'],
            ['exists', 'a:deleted'],
        ]);
        expect(replies[0]).toEqual([null, '1']);
        expect(replies[1]?.[0]?.message).toBe('down');
    });

    it('rethrows any other pipeline failure', async () => {
        const redis = makeRedis();
        refusePipelines(redis, 'Redis unavailable');
        const get = vi.spyOn(redis, 'get');

        await expect(execTogether(redis, [['get', 'a']])).rejects.toThrow(
            'Redis unavailable',
        );
        expect(get).not.toHaveBeenCalled();
    });
});
