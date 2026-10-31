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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig, IRedisConfig } from '../../types.js';
import type { CreditHoldStore } from './CreditHoldStore.js';

let server: PuterServer;
let store: CreditHoldStore;

const user = () => `hold-user-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.creditHold as CreditHoldStore;
});

afterAll(async () => {
    await server?.shutdown();
});

describe('CreditHoldStore', () => {
    it('sums what an actor has taken', async () => {
        const id = user();
        expect(await store.outstanding(id)).toBe(0);

        await store.take(id, 1000);
        await store.take(id, 250);

        expect(await store.outstanding(id)).toBe(1250);
    });

    it('gives budget back on release', async () => {
        const id = user();
        const first = await store.take(id, 1000);
        await store.take(id, 500);

        await store.release(id, first);

        expect(await store.outstanding(id)).toBe(500);
    });

    it('releases at most once', async () => {
        const id = user();
        const member = await store.take(id, 900);
        await store.release(id, member);
        await store.release(id, member);

        expect(await store.outstanding(id)).toBe(0);
    });

    it('keeps actors separate', async () => {
        const [a, b] = [user(), user()];
        await store.take(a, 700);

        expect(await store.outstanding(b)).toBe(0);
    });

    // A deployment that dies mid-request never releases; without a deadline
    // the account would be short that budget until the month turned over.
    it('drops holds nobody released once they expire', async () => {
        const id = user();
        await store.take(id, 5000, 50);
        expect(await store.outstanding(id)).toBe(5000);

        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toBe(0);
            },
            { timeout: 2000, interval: 25 },
        );
    });

    // All of an actor's holds share one redis key, so a short-lived hold must
    // never pull the key's expiry in under a longer-lived one — key expiry
    // drops every hold in the set at once.
    it('never shortens the hold set’s expiry under a longer-lived hold', async () => {
        const id = user();
        await store.take(id, 1000); // default 10-minute TTL
        await store.take(id, 500, 50); // much shorter TTL

        const redis = server.clients.redis as unknown as {
            pttl: (key: string) => Promise<number>;
        };
        const pttl = await redis.pttl(`meter:holds:{${id}}`);
        // Still on the long hold's clock, not the short one's.
        expect(pttl).toBeGreaterThan(500_000);
    });

    it('refresh pushes a hold’s deadline out for a still-running operation', async () => {
        const id = user();
        const member = await store.take(id, 800, 50);

        await store.refresh(id, member); // default 10-minute TTL

        // Well past the original 50ms deadline, the hold is still counted.
        await new Promise((r) => setTimeout(r, 100));
        expect(await store.outstanding(id)).toBe(800);
    });

    it('ignores amounts that aren’t worth holding', async () => {
        const id = user();
        expect(await store.take(id, 0)).toBeNull();
        expect(await store.take(id, -5)).toBeNull();
        expect(await store.take(id, Number.NaN)).toBeNull();
        expect(await store.outstanding(id)).toBe(0);
    });

    // Holds gate spending, so an unreachable cache has to mean "no holds", not
    // "no spending" — the alternative is a cache blip presenting as every
    // account being out of credit.
    it('reads zero rather than failing when the cache is unreachable', async () => {
        const id = user();
        await store.take(id, 4000);

        const redis = server.clients.redis as unknown as {
            creditHoldSum: () => Promise<unknown>;
        };
        const spy = vi
            .spyOn(redis, 'creditHoldSum')
            .mockRejectedValue(new Error('cache down'));

        expect(await store.outstanding(id)).toBe(0);
        spy.mockRestore();
    });
});

// Opt in to a real Redis Cluster with PUTER_TEST_REDIS_CLUSTER=host:port.
const clusterNode = process.env.PUTER_TEST_REDIS_CLUSTER;
const backends: { name: string; redis: IRedisConfig }[] = [
    { name: 'the redis mock', redis: { useMock: true } },
    ...(clusterNode
        ? [
              {
                  name: `redis cluster ${clusterNode}`,
                  redis: {
                      useMock: false,
                      tls: false,
                      startupNodes: [
                          {
                              host: clusterNode.split(':')[0],
                              port: Number(clusterNode.split(':')[1]),
                          },
                      ],
                  },
              },
          ]
        : []),
];

describe.each(backends)('CreditHoldStore.reserve on $name', ({ redis }) => {
    // Two backends sharing one cache, as separate instances do in production.
    let servers: PuterServer[];
    let a: CreditHoldStore;
    let b: CreditHoldStore;
    const BUDGET = 20_000_000;
    const HOLD = 16_200_000;

    beforeAll(async () => {
        servers = await Promise.all(
            [0, 1].map(() => setupTestServer({ redis } as IConfig)),
        );
        [a, b] = servers.map((s) => s.stores.creditHold as CreditHoldStore);
    });

    afterAll(async () => {
        await Promise.all((servers ?? []).map((s) => s.shutdown()));
    });

    const reserve = async (
        on: CreditHoldStore,
        id: string,
        amount: number,
        budget = BUDGET,
        ttlMs?: number,
    ) => on.reserve(id, amount, budget, (await on.version(id))!, ttlMs);

    it('admits exactly one of two concurrent holds that only fit alone', async () => {
        const id = user();
        const results = await Promise.all([
            reserve(a, id, HOLD),
            reserve(b, id, HOLD),
        ]);

        expect(results.map((r) => r.outcome).sort()).toEqual([
            'accepted',
            'insufficient',
        ]);
        expect(await a.outstanding(id)).toBe(HOLD);
        expect(await b.outstanding(id)).toBe(HOLD);
    });

    it('admits exact headroom and refuses one unit more', async () => {
        const id = user();
        expect((await reserve(a, id, 15_000_000)).outcome).toBe('accepted');
        expect((await reserve(b, id, 5_000_001)).outcome).toBe('insufficient');
        expect((await reserve(b, id, 5_000_000)).outcome).toBe('accepted');
        expect(await a.outstanding(id)).toBe(BUDGET);
    });

    it('rounds a fractional amount up once', async () => {
        const id = user();
        expect((await reserve(a, id, 9.2, 10)).outcome).toBe('accepted');
        expect(await a.outstanding(id)).toBe(10);
        expect((await reserve(a, id, 0.5, 10)).outcome).toBe('insufficient');
    });

    it('admits several holds that fit together, and keeps actors apart', async () => {
        const [id, other] = [user(), user()];
        const results = await Promise.all(
            [a, b, a, b].map((s) => reserve(s, id, 5_000_000)),
        );
        expect(results.every((r) => r.outcome === 'accepted')).toBe(true);
        expect((await reserve(a, other, HOLD)).outcome).toBe('accepted');
        expect(await a.outstanding(id)).toBe(BUDGET);
        expect(await a.outstanding(other)).toBe(HOLD);
    });

    it('leaves nothing behind when it refuses', async () => {
        const id = user();
        await reserve(a, id, HOLD);
        await reserve(b, id, HOLD);
        await reserve(b, id, HOLD, 0);
        expect(await a.outstanding(id)).toBe(HOLD);
    });

    it('frees headroom on release and on expiry', async () => {
        const id = user();
        const first = await reserve(a, id, HOLD);
        expect((await reserve(b, id, HOLD)).outcome).toBe('insufficient');
        await a.release(id, first.outcome === 'accepted' ? first.member : null);
        expect((await reserve(b, id, HOLD, BUDGET, 50)).outcome).toBe(
            'accepted',
        );
        await vi.waitFor(
            async () =>
                expect((await reserve(a, id, HOLD)).outcome).toBe('accepted'),
            { timeout: 2000, interval: 25 },
        );
    });

    it('keeps a long hold when a short one is reserved beside it', async () => {
        const id = user();
        await reserve(a, id, 1000);
        await reserve(b, id, 500, BUDGET, 50);
        const pttl = await (
            servers[0].clients.redis as unknown as {
                pttl: (key: string) => Promise<number>;
            }
        ).pttl(`meter:holds:{${id}}`);
        expect(pttl).toBeGreaterThan(500_000);
    });

    it('refuses a budget read before a usage write landed, but not one before a release', async () => {
        const id = user();
        // A release alone leaves the balance as it was.
        const before = (await a.version(id))!;
        const held = await reserve(a, id, 1000);
        await b.release(id, held.outcome === 'accepted' ? held.member : null);
        const after = await a.reserve(id, 1000, BUDGET, before);
        expect(after.outcome).toBe('accepted');
        await a.release(id, after.outcome === 'accepted' ? after.member : null);

        const read = (await a.version(id))!;
        await b.bump(id);
        expect((await a.reserve(id, 1000, BUDGET, read)).outcome).toBe('stale');
        expect(await a.outstanding(id)).toBe(0);

        // Skipping the check still can't overlap another hold.
        await reserve(a, id, HOLD);
        expect((await a.reserve(id, HOLD, BUDGET, '')).outcome).toBe(
            'insufficient',
        );
    });

    it('keeps renewal and release consistent when they race', async () => {
        const id = user();
        const held = await reserve(a, id, HOLD, BUDGET, 200);
        const member = held.outcome === 'accepted' ? held.member : null;
        await Promise.all([a.refresh(id, member), b.release(id, member)]);
        // Whichever ran last decides; a renewal that lost the race only
        // brings the hold back until its owner releases it again.
        await a.release(id, member);
        expect(await a.outstanding(id)).toBe(0);
        expect((await reserve(b, id, HOLD)).outcome).toBe('accepted');
    });

    it('refuses amounts it can’t hold without touching the hold set', async () => {
        const id = user();
        await reserve(a, id, 1000);
        for (const amount of [0, -5_000, Number.NaN, Infinity]) {
            expect((await reserve(a, id, amount)).outcome).toBe('insufficient');
        }
        expect(await a.outstanding(id)).toBe(1000);
    });

    it('starts a missing version from a random value', async () => {
        const id = user();
        expect(await a.version(id)).toBe('0');
        await b.bump(id);
        const first = (await a.version(id))!;
        expect(first).not.toBe('1');
        await b.bump(id);
        expect(Number(await a.version(id))).toBe(Number(first) + 1);
    });

    it('reports an unreachable cache as unavailable, not as insufficient', async () => {
        const id = user();
        const client = servers[0].clients.redis as unknown as {
            creditHoldReserve: () => Promise<unknown>;
            get: () => Promise<unknown>;
        };
        const reserveSpy = vi
            .spyOn(client, 'creditHoldReserve')
            .mockRejectedValueOnce(new Error('cache down'));
        expect((await a.reserve(id, 1000, BUDGET, '0')).outcome).toBe(
            'unavailable',
        );
        const getSpy = vi
            .spyOn(client, 'get')
            .mockRejectedValueOnce(new Error('cache down'));
        expect(await a.version(id)).toBeNull();
        reserveSpy.mockRestore();
        getSpy.mockRestore();
        expect(await a.outstanding(id)).toBe(0);
    });
});
