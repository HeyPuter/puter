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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import {
    toUploadReservationBytes,
    type UploadReservationStore,
} from './UploadReservationStore.js';

let server: PuterServer;
let store: UploadReservationStore;

const owner = () => Math.floor(Math.random() * 1_000_000_000);
const lease = (bytes: number, ttlMs = 60_000) => ({
    sessionId: randomUUID(),
    bytes,
    deadline: Date.now() + ttlMs,
});

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.uploadReservation as UploadReservationStore;
});

afterAll(async () => {
    await server?.shutdown();
});

describe('toUploadReservationBytes', () => {
    it('rounds the difference up', () => {
        expect(toUploadReservationBytes(10.2, 0)).toBe(11);
    });

    it('never goes negative', () => {
        expect(toUploadReservationBytes(10, 50)).toBe(0);
    });

    it('treats a non-finite delta as the per-lease ceiling', () => {
        expect(toUploadReservationBytes(Number.NaN, 0)).toBe(2 ** 44);
        expect(toUploadReservationBytes(Number.POSITIVE_INFINITY, 0)).toBe(
            2 ** 44,
        );
    });

    it('clamps a huge but finite delta to the per-lease ceiling', () => {
        expect(toUploadReservationBytes(Number.MAX_SAFE_INTEGER, 0)).toBe(
            2 ** 44,
        );
    });
});

describe('UploadReservationStore', () => {
    it("take's total includes the new leases, summed", async () => {
        const id = owner();
        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });

        const first = await store.take(id, [lease(1000)], 10_000);
        expect(first).toMatchObject({ added: true, activeBytes: 1000 });

        const second = await store.take(id, [lease(250)], 10_000);
        expect(second).toMatchObject({ added: true, activeBytes: 1250 });

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 1250,
            settledBytes: 0,
        });
    });

    it('release gives the space back', async () => {
        const id = owner();
        const a = lease(1000);
        const b = lease(500);
        await store.take(id, [a, b], 10_000);

        await store.release(id, [a]);

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 500,
            settledBytes: 0,
        });
    });

    it('releases at most once', async () => {
        const id = owner();
        const a = lease(900);
        await store.take(id, [a], 10_000);

        await store.release(id, [a]);
        await store.release(id, [a]);

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });
    });

    it('keeps owners separate', async () => {
        const a = owner();
        const b = owner();
        await store.take(a, [lease(700)], 10_000);

        expect(await store.outstanding(b)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });
    });

    it('settle moves bytes from active to settled', async () => {
        const id = owner();
        const item = lease(400);
        await store.take(id, [item], 10_000);

        await store.settle(
            id,
            [{ sessionId: item.sessionId, bytes: 400 }],
            60_000,
        );

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 400,
        });
    });

    it('a settled lease stops counting once it expires', async () => {
        const id = owner();
        const item = lease(300);
        await store.take(id, [item], 10_000);
        await store.settle(id, [{ sessionId: item.sessionId, bytes: 300 }], 50);

        expect((await store.outstanding(id)).settledBytes).toBe(300);
        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toEqual({
                    activeBytes: 0,
                    settledBytes: 0,
                });
            },
            { timeout: 2000, interval: 25 },
        );
    });

    it('settling a member that was never taken adds nothing', async () => {
        const id = owner();
        await store.settle(
            id,
            [{ sessionId: randomUUID(), bytes: 999 }],
            60_000,
        );

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });
    });

    it('drops leases nobody released once they expire', async () => {
        const id = owner();
        await store.take(id, [lease(5000, 50)], 10_000);
        expect((await store.outstanding(id)).activeBytes).toBe(5000);

        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toEqual({
                    activeBytes: 0,
                    settledBytes: 0,
                });
            },
            { timeout: 2000, interval: 25 },
        );
    });

    // All of an owner's leases share one cache key, so a short-lived lease
    // must never pull the key's expiry in under a longer-lived one.
    it("never shortens the lease set's expiry under a longer-lived lease", async () => {
        const id = owner();
        await store.take(id, [lease(1000, 10 * 60_000)], 10_000);
        await store.take(id, [lease(500, 50)], 10_000);

        const redis = server.clients.redis as unknown as {
            pttl: (key: string) => Promise<number>;
        };
        const pttl = await redis.pttl(`prodfsv2:upload-reservations:{${id}}`);
        expect(pttl).toBeGreaterThan(500_000);
    });

    it('refuses a batch over the cap and adds none of it', async () => {
        const id = owner();
        const leases = Array.from({ length: 3 }, () => lease(10));

        const result = await store.take(id, leases, 2);

        expect(result).toEqual({
            added: false,
            activeBytes: 0,
            settledBytes: 0,
        });
        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });
    });

    // The cap bounds outstanding work, not history — a lease that already
    // committed shouldn't count against it just because it lingers as settled.
    it('counts active leases only against the cap, not settled ones', async () => {
        const id = owner();
        const items = Array.from({ length: 3 }, () => lease(1));
        const filled = await store.take(id, items, 3);
        expect(filled).toMatchObject({ added: true });

        await store.settle(
            id,
            items.map((item) => ({ sessionId: item.sessionId, bytes: 1 })),
            60_000,
        );

        const result = await store.take(id, [lease(1)], 3);
        expect(result).toMatchObject({ added: true });
    });

    it('refuses without adding any of it once active leases reach the cap', async () => {
        const id = owner();
        const first = await store.take(id, [lease(1), lease(1)], 3);
        expect(first).toMatchObject({ added: true, activeBytes: 2 });

        const refused = await store.take(id, [lease(1), lease(1)], 3);
        expect(refused).toMatchObject({ added: false });

        // The refused pair changed nothing.
        expect(await store.outstanding(id)).toEqual({
            activeBytes: 2,
            settledBytes: 0,
        });
    });

    it('does not double-count a sessionId taken twice', async () => {
        const id = owner();
        const item = lease(500);
        await store.take(id, [item], 10_000);
        const again = await store.take(id, [item], 10_000);

        expect(again).toMatchObject({ added: true, activeBytes: 500 });
        expect(await store.outstanding(id)).toEqual({
            activeBytes: 500,
            settledBytes: 0,
        });
    });

    it('releasing a lease that was never taken changes nothing', async () => {
        const id = owner();
        await store.release(id, [{ sessionId: randomUUID(), bytes: 123 }]);

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });
    });

    it('expiry subtracts from the right bucket for active and settled leases independently', async () => {
        const id = owner();
        const stays = lease(700, 10 * 60_000);
        const settledSoon = lease(300, 10 * 60_000);
        await store.take(id, [stays, settledSoon], 10_000);
        await store.settle(
            id,
            [{ sessionId: settledSoon.sessionId, bytes: 300 }],
            50,
        );

        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toEqual({
                    activeBytes: 700,
                    settledBytes: 0,
                });
            },
            { timeout: 2000, interval: 25 },
        );
    });

    it('self-heals the totals once every lease expires', async () => {
        const id = owner();
        await store.take(id, [lease(50, 50)], 10_000);

        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toEqual({
                    activeBytes: 0,
                    settledBytes: 0,
                });
            },
            { timeout: 2000, interval: 25 },
        );

        const redis = server.clients.redis as unknown as {
            exists: (key: string) => Promise<number>;
        };
        expect(
            await redis.exists(`prodfsv2:upload-reservation-totals:{${id}}`),
        ).toBe(0);
    });

    // A per-lease ceiling keeps a run of absurdly large declared sizes from
    // overflowing the cache's 64-bit counters.
    it('clamps each lease so many absurdly large leases sum safely', async () => {
        const id = owner();
        const leases = Array.from({ length: 500 }, () => ({
            sessionId: randomUUID(),
            bytes: Number.MAX_SAFE_INTEGER,
            deadline: Date.now() + 60_000,
        }));

        const result = await store.take(id, leases, 10_000);

        expect(result).toMatchObject({
            added: true,
            activeBytes: 500 * 2 ** 44,
        });
    });

    // The totals hash can go missing on its own (evicted, or deleted
    // independently of the lease set) while leases remain live — the next
    // prune has to notice and rebuild it from the set rather than trust a
    // counter it knows is gone.
    it('rebuilds totals from the lease set when the totals hash is lost', async () => {
        const id = owner();
        const stays = lease(400, 10 * 60_000);
        const expiresSoon = lease(300, 50);
        await store.take(id, [stays, expiresSoon], 10_000);

        const redis = server.clients.redis as unknown as {
            del: (...keys: string[]) => Promise<number>;
        };
        await redis.del(`prodfsv2:upload-reservation-totals:{${id}}`);

        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toEqual({
                    activeBytes: 400,
                    settledBytes: 0,
                });
            },
            { timeout: 2000, interval: 25 },
        );
    });

    // Re-taking a sessionId that was already settled (a retried start after
    // the original upload already completed) and settling it again must not
    // credit settledBytes twice for the same bytes.
    it('does not double-credit settledBytes when a settled lease is re-taken and settled again', async () => {
        const id = owner();
        const item = lease(500);
        await store.take(id, [item], 10_000);
        await store.settle(
            id,
            [{ sessionId: item.sessionId, bytes: 500 }],
            60_000,
        );
        expect((await store.outstanding(id)).settledBytes).toBe(500);

        await store.take(id, [item], 10_000);
        await store.settle(
            id,
            [{ sessionId: item.sessionId, bytes: 500 }],
            60_000,
        );

        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 500,
        });
    });

    // Each call returns the owner's running total, so 10 concurrent takes
    // return 10 distinct partial sums — the order between them is whichever
    // one the script runs first, but every run is exactly one lease further
    // along, with nothing lost or double-counted in between.
    it('serializes concurrent takes for one owner (no lost updates)', async () => {
        const id = owner();
        const amounts = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);

        const results = await Promise.all(
            amounts.map((bytes) => store.take(id, [lease(bytes)], 1000)),
        );

        const sortedTotals = results
            .map((result) => result?.activeBytes ?? -1)
            .sort((a, b) => a - b);
        const stepsBetweenTotals = sortedTotals.map((total, i) =>
            i === 0 ? total : total - (sortedTotals[i - 1] as number),
        );
        expect(stepsBetweenTotals.slice().sort((a, b) => a - b)).toEqual(
            amounts.slice().sort((a, b) => a - b),
        );

        const total = amounts.reduce((sum, n) => sum + n, 0);
        expect(sortedTotals[sortedTotals.length - 1]).toBe(total);
        expect((await store.outstanding(id)).activeBytes).toBe(total);
    });

    it('fails open: take returns null and outstanding reads zero when the cache errors', async () => {
        const id = owner();
        // Trigger lazy script registration before spying on the command.
        await store.take(id, [lease(1)], 10_000);

        const redis = server.clients.redis as unknown as {
            uploadReservationTake: () => Promise<unknown>;
        };
        const spy = vi
            .spyOn(redis, 'uploadReservationTake')
            .mockRejectedValue(new Error('cache down'));

        expect(await store.take(id, [lease(10)], 10_000)).toBeNull();
        expect(await store.outstanding(id)).toEqual({
            activeBytes: 0,
            settledBytes: 0,
        });
        spy.mockRestore();
    });
});
