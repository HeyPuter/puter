import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { Actor, makeActor } from '../../core/actor.ts';
import { runWithContext } from '../../core/context.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import { KV_CACHED_READ_RATE_SHARE, KV_COSTS } from './costs.ts';
import type { KVStoreDriver } from './KVStoreDriver.ts';

describe('KVStoreDriver read-cache metering', () => {
    let server: PuterServer;
    let target: KVStoreDriver;

    beforeAll(async () => {
        server = await setupTestServer({
            kvCache: { enabled: true, broadcastCoalesceMs: 0 },
        });
        target = server.drivers.kvStore;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const actorFor = (): Actor =>
        makeActor({
            user: {
                uuid: `test-user-${Math.random().toString(36).slice(2)}`,
                id: 1,
                username: 'test-user',
                email: 'test@test.com',
                email_confirmed: true,
            },
            app: { uid: 'test-app', id: 1 },
        });

    /** Cache fills are not awaited by the read that triggers them. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    it('prices a cached read at a tenth of the rate an uncached one pays', () => {
        expect(KV_COSTS['kv:read:cached']).toBeCloseTo(
            KV_COSTS['kv:read'] * KV_CACHED_READ_RATE_SHARE,
            10,
        );
    });

    it('charges the cached rate for the read the cache answered', async () => {
        const actor = actorFor();
        const increment = vi.spyOn(server.services.metering, 'incrementUsage');
        const buffer = vi.spyOn(
            server.services.metering,
            'bufferIncrementUsages',
        );

        // A key that was never written: the absence is what gets cached, so no
        // write is involved and the second read is free to be served from it.
        await runWithContext({ actor }, () => target.get({ key: 'absent' }));
        const uncached = increment.mock.calls.find(
            (call) => call[1] === 'kv:read',
        );
        expect(uncached).toBeDefined();
        const units = uncached![2];
        expect(units).toBeGreaterThan(0);
        expect(uncached![3]).toBe(KV_COSTS['kv:read'] * units);

        await settle();
        increment.mockClear();
        await runWithContext({ actor }, () => target.get({ key: 'absent' }));

        // Nothing consumed capacity, so nothing is charged at the read rate.
        expect(
            increment.mock.calls.filter((call) => call[1] === 'kv:read'),
        ).toHaveLength(0);
        expect(buffer).toHaveBeenCalledWith(actor, [
            {
                usageType: 'kv:read:cached',
                usageAmount: units,
                costOverride: KV_COSTS['kv:read:cached'] * units,
            },
        ]);
    });

    it('reports the cached rate alongside the rates it discounts', () => {
        expect(target.getReportedCosts()).toEqual(
            expect.arrayContaining([
                {
                    usageType: 'kv:read:cached',
                    ucentsPerUnit: KV_COSTS['kv:read:cached'],
                    unit: 'capacity-unit',
                    source: 'driver:kvStore',
                },
            ]),
        );
    });
});
