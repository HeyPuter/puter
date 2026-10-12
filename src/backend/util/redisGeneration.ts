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

import type { Cluster } from 'ioredis';

/**
 * Increment a generation counter and renew its TTL in one round trip; the two
 * commands travel together, so the counter can't be left without an expiry.
 * Returns the new value.
 */
export const bumpGeneration = async (
    redis: Pick<Cluster, 'pipeline'>,
    key: string,
    ttlSeconds: number,
): Promise<number> => {
    const results = await redis
        .pipeline()
        .incr(key)
        .expire(key, ttlSeconds)
        .exec();
    for (const [error] of results ?? []) {
        if (error) throw error;
    }
    return Number(results?.[0]?.[1]);
};
