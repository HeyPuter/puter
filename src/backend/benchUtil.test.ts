import { afterEach, describe, expect, it } from 'vitest';
import {
    DISTRIBUTED_LATENCY_MS,
    instrumentClientIo,
    profileIo,
    type IoInstrumentation,
} from './benchUtil.js';
import type { PuterServer } from './server.js';

const fakeClients = () => {
    const db = {
        read: async () => [{ id: 1 }],
        // As in the SQLite client, a primary read is a read underneath.
        pread: async () => db.read(),
        write: async () => ({ affectedRows: 1 }),
        batchWrite: async () => undefined,
        hasReadReplica: () => false,
    };
    const dynamo = {
        get: async () => ({ Item: {} }),
        put: async () => ({}),
        batchGet: async () => ({}),
    };
    const redis = {
        get: async () => 'value',
        set: async () => 'OK',
        xread: async () => null,
        pipeline: () => ({ exec: async () => [] }),
    };
    const s3Client = { send: async () => ({}) };
    const s3 = { get: () => s3Client };
    return { db, dynamo, redis, s3 };
};

describe('instrumentClientIo', () => {
    let io: IoInstrumentation | undefined;
    const setup = () => {
        const clients = fakeClients();
        io = instrumentClientIo({ clients } as unknown as PuterServer);
        return clients;
    };
    const profile = async (run: () => Promise<unknown>) => {
        io!.begin();
        await run();
        const answeredAt = io!.now();
        return profileIo(await io!.end(), answeredAt);
    };

    afterEach(() => io?.restore());

    it('counts calls issued together as one stage', async () => {
        const { db } = setup();
        const result = await profile(() =>
            Promise.all([db.read(), db.read(), db.read()]),
        );
        expect(result).toEqual({
            roundTrips: { dbRead: 3 },
            serialStages: 1,
            latencyMs: DISTRIBUTED_LATENCY_MS.dbRead,
        });
    });

    it('keeps real time between calls off the modeled clock', async () => {
        const { db } = setup();
        const result = await profile(() =>
            Promise.all([
                db.read(),
                (async () => {
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    await db.read();
                })(),
            ]),
        );
        expect(result.serialStages).toBe(1);
        expect(result.latencyMs).toBe(DISTRIBUTED_LATENCY_MS.dbRead);
    });

    it('counts calls issued one after another as a waterfall', async () => {
        const { db } = setup();
        const result = await profile(async () => {
            await db.read();
            await db.read();
            await db.read();
        });
        expect(result).toEqual({
            roundTrips: { dbRead: 3 },
            serialStages: 3,
            latencyMs: 3 * DISTRIBUTED_LATENCY_MS.dbRead,
        });
    });

    it('charges a primary read and a write the cross-region cost', async () => {
        const { db } = setup();
        const result = await profile(async () => {
            await db.pread();
            await db.write();
        });
        // The primary read's inner `read()` is the same round trip.
        expect(result.roundTrips).toEqual({ dbPrimaryRead: 1, dbWrite: 1 });
        expect(result.latencyMs).toBe(
            DISTRIBUTED_LATENCY_MS.dbPrimaryRead +
                DISTRIBUTED_LATENCY_MS.dbWrite,
        );
    });

    it('takes the slowest branch of parallel work as the latency', async () => {
        const { db, redis, dynamo } = setup();
        const result = await profile(() =>
            Promise.all([
                db.write(),
                (async () => {
                    await redis.get();
                    await dynamo.get();
                })(),
            ]),
        );
        expect(result.roundTrips).toEqual({
            dbWrite: 1,
            redis: 1,
            dynamoRead: 1,
        });
        expect(result.serialStages).toBe(2);
        expect(result.latencyMs).toBe(DISTRIBUTED_LATENCY_MS.dbWrite);
    });

    it('counts work left running after the answer as load, not latency', async () => {
        const { db, redis } = setup();
        const result = await profile(async () => {
            await redis.get();
            void db.write();
        });
        expect(result.roundTrips).toEqual({ redis: 1, dbWrite: 1 });
        expect(result.serialStages).toBe(1);
        expect(result.latencyMs).toBe(DISTRIBUTED_LATENCY_MS.redis);
    });

    it('counts a pipeline as one round trip and skips blocking polls', async () => {
        const { redis, s3 } = setup();
        const result = await profile(async () => {
            await redis.pipeline().exec();
            await redis.xread();
            await s3.get().send();
        });
        expect(result.roundTrips).toEqual({ redis: 1, s3: 1 });
    });

    it('reports a read replica while instrumented and restores the clients', async () => {
        const clients = setup();
        const original = fakeClients();
        expect(clients.db.hasReadReplica()).toBe(true);

        io!.restore();
        expect(clients.db.hasReadReplica()).toBe(false);
        expect(Object.keys(clients.db)).toEqual(Object.keys(original.db));
        io!.begin();
        await clients.db.read();
        expect(await io!.end()).toEqual([]);
    });
});
