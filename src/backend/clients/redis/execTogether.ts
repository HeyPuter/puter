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

import type { RedisClient } from './RedisClient.js';

/** One single-key command: the method name, then its arguments. */
export type RedisStep = [
    command: 'get' | 'exists' | 'set' | 'setex' | 'del',
    ...args: Array<string | number>,
];

type RedisReply = [error: Error | null, result: unknown];

type StepRunner = Record<
    RedisStep[0],
    (...args: Array<string | number>) => unknown
>;

// ioredis refuses a pipeline whose keys are served by different shards.
const CROSS_SHARD = /same slots allocation group/;

/**
 * Runs single-key commands in one round trip, answering like `pipeline.exec`. A
 * cluster that can't route them together gets each on its own, at once.
 */
export const execTogether = async (
    redis: Pick<RedisClient, 'pipeline'>,
    steps: RedisStep[],
): Promise<RedisReply[]> => {
    if (steps.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const [command, ...args] of steps) {
        (pipeline as unknown as StepRunner)[command](...args);
    }
    try {
        return ((await pipeline.exec()) ?? []) as RedisReply[];
    } catch (error) {
        if (!(error instanceof Error) || !CROSS_SHARD.test(error.message)) {
            throw error;
        }
    }
    const each = redis as unknown as StepRunner;
    return Promise.all(
        steps.map(async ([command, ...args]): Promise<RedisReply> => {
            try {
                return [null, await each[command](...args)];
            } catch (error) {
                return [error as Error, null];
            }
        }),
    );
};
