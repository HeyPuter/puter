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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DDBClient } from '../../clients/dynamodb/DDBClient';
import { RedisClient } from '../../clients/redis/RedisClient';
import { S3Client } from '../../clients/s3/S3Client';
import { PUTER_KV_STORE_TABLE_DEFINITION } from '../../stores/systemKv/tableDefinition';
import type { IConfig } from '../../types';
import { ServerHealthService } from './ServerHealthService';

/**
 * The dependency probes against real client implementations rather than mocks —
 * a probe that passes a stubbed `get`/`ping`/`headBucket` proves nothing about
 * whether the underlying protocol call is one the backing service accepts.
 * Runs fully in-process: dynalite, fauxqs, and the redis mock.
 */

const config = {
    dynamo: { inMemory: true },
    redis: { useMock: true },
    s3: { localConfig: { inMemory: true } },
    s3_bucket: 'puter-local',
} as unknown as IConfig;

let dynamo: DDBClient;
let redis: RedisClient;
let s3: S3Client;

const makeService = (): ServerHealthService => {
    const args = [
        config,
        { dynamo, redis, s3 },
        {},
        {},
    ] as unknown as ConstructorParameters<typeof ServerHealthService>;
    return new ServerHealthService(...args);
};

beforeAll(async () => {
    dynamo = new DDBClient(config);
    await dynamo.createTableIfNotExists(PUTER_KV_STORE_TABLE_DEFINITION, 'ttl');

    redis = new RedisClient(config);

    s3 = new S3Client(config);
    await s3.onServerStart();
}, 60_000);

afterAll(async () => {
    await s3.onServerShutdown();
    await redis.onServerShutdown?.();
});

describe('dependency probes against real clients', () => {
    it('the health loop registers and passes every probe', async () => {
        const service = makeService();
        service.onServerStart();

        // Real timers, and the loop's first cycle only fires once the 5s
        // interval elapses — so poll rather than sleeping a fixed span.
        //
        // The deadline is in wall-clock time but the loop it waits on is not:
        // a worker sharing a busy machine can burn tens of seconds of
        // wall-clock while its 5s interval gets almost no turns, and a budget
        // sized for an idle machine then reports zero probes rather than slow
        // ones. Generous enough to survive that; on an idle machine it still
        // falls through in about one cycle.
        const expected = ['dynamo-liveness', 'redis-liveness', 's3-liveness'];
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
            const ran = Object.keys(service.getStats().check_durations_ms);
            if (expected.every((name) => ran.includes(name))) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        expect(
            Object.keys(service.getStats().check_durations_ms).sort(),
        ).toEqual(expected);
        expect(service.getStats().failed_checks).toEqual([]);
        expect(await service.getStatus()).toEqual({ ok: true });

        service.onServerShutdown();
    }, 60_000);

    it('dynamo answers the liveness point read', async () => {
        const response = await dynamo.get('store-kv-v1', {
            namespace: 'server-health',
            key: 'liveness-probe',
        });
        expect(response.Item).toBeUndefined();
        expect(response.$metadata.httpStatusCode).toBe(200);
    });

    it('redis answers PING', async () => {
        await expect(redis.ping()).resolves.toBe('PONG');
    });

    it('the object store answers HEAD on the default bucket', async () => {
        await expect(s3.headBucket()).resolves.toBeUndefined();
    });

    it('the object store probe rejects for a bucket that is not there', async () => {
        await expect(s3.headBucket('definitely-not-a-bucket')).rejects.toThrow();
    });
});
