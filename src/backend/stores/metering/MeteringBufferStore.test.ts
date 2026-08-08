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

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import type { SystemKVStore } from '../systemKv/SystemKVStore.ts';
import {
    bucketTag,
    flattenAmounts,
    pairsToAmounts,
    parsePendingEntry,
    unflattenAmounts,
    type MeteringBufferStore,
} from './MeteringBufferStore.ts';

describe('MeteringBufferStore', () => {
    // -- Pure shape helpers -------------------------------------------

    describe('amount shapes', () => {
        it('reads a hash reply into amounts', () => {
            expect(pairsToAmounts(['total', '5', 'a.units', '2.5'])).toEqual({
                total: 5,
                'a.units': 2.5,
            });
        });

        it('nests flat paths the way stored counters are nested', () => {
            expect(
                unflattenAmounts({
                    total: 7,
                    'openai:gpt-4o.units': 12,
                    'openai:gpt-4o.cost': 3,
                }),
            ).toEqual({
                total: 7,
                'openai:gpt-4o': { units: 12, cost: 3 },
            });
        });

        it('round-trips a stored counter through flatten and back', () => {
            const stored = {
                total: 42,
                'ai:chat': { units: 100, cost: 42, count: 3 },
            };
            expect(unflattenAmounts(flattenAmounts(stored))).toEqual(stored);
        });

        it('keeps fractional amounts intact', () => {
            expect(unflattenAmounts(flattenAmounts({ total: 0.25 }))).toEqual({
                total: 0.25,
            });
        });

        it('ignores non-numeric leaves when flattening', () => {
            expect(
                flattenAmounts({ total: 1, label: 'nope', nested: null }),
            ).toEqual({ total: 1 });
        });
    });

    describe('pending index entries', () => {
        it('round-trips a key that contains separators', () => {
            const key = 'metering:actor:abc-123:app:os-global:2026-08';
            const parsed = parsePendingEntry(`1750000000000:${key}`);
            expect(parsed).toEqual({ claimedAt: 1750000000000, key });
        });

        it('rejects entries it cannot trust', () => {
            expect(parsePendingEntry('garbage')).toBeNull();
            expect(parsePendingEntry('notanumber:key')).toBeNull();
            expect(parsePendingEntry('123:')).toBeNull();
        });
    });

    // -- Behaviour against a booted backend ---------------------------

    let server: PuterServer;
    let target: MeteringBufferStore;
    let kv: SystemKVStore;

    /** What the KV store itself holds, bypassing the buffer entirely. */
    const storedTotal = async (key: string): Promise<number> => {
        const { res } = await kv.get({ key });
        return (res as { total?: number } | null)?.total ?? 0;
    };

    const cacheKeys = async (): Promise<string[]> =>
        (await server.clients.redis.keys('meter:*')).sort();

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.stores.meteringBuffer;
        kv = server.stores.kv;
        // Stop the background flush loop so every test below drives flushing
        // explicitly. Otherwise a cycle firing mid-test would settle counters
        // the test is asserting are still buffered. The loop gets its own
        // server further down.
        await target.onServerShutdown();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // A fresh counter per test, and a clean cache, so nothing leaks between
    // tests through either layer.
    let key: string;
    beforeEach(async () => {
        key = `metering:actor:buf-${Math.random().toString(36).slice(2)}:2026-08`;
        const stale = await server.clients.redis.keys('meter:*');
        if (stale.length) await server.clients.redis.del(...stale);
    });

    describe('incr', () => {
        it('returns a running total without writing on every call', async () => {
            const first = await target.incr({
                key,
                pathAndAmountMap: { total: 10, 'ai:chat.count': 1 },
            });
            const second = await target.incr({
                key,
                pathAndAmountMap: { total: 5, 'ai:chat.count': 1 },
            });

            expect(first.res).toEqual({ total: 10, 'ai:chat': { count: 1 } });
            expect(second.res).toEqual({ total: 15, 'ai:chat': { count: 2 } });
            expect(first.exact).toBe(false);
            expect(await storedTotal(key)).toBe(0);
        });

        it('writes the accumulated total onward on flush', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 10 } });
            await target.incr({ key, pathAndAmountMap: { total: 5 } });

            await target.flushCycle();

            expect(await storedTotal(key)).toBe(15);
        });

        it('collapses many increments into a single write', async () => {
            const incrSpy = vi.spyOn(kv, 'incr');
            for (let i = 0; i < 5; i++) {
                await target.incr({
                    key,
                    pathAndAmountMap: { total: 2, 'ai:chat.count': 1 },
                });
            }
            expect(incrSpy).not.toHaveBeenCalled();

            await target.flushCycle();

            expect(incrSpy).toHaveBeenCalledTimes(1);
            const { res } = await kv.get({ key });
            expect(res).toEqual({ total: 10, 'ai:chat': { count: 5 } });
            incrSpy.mockRestore();
        });

        it('counts what is already stored when it first sees a counter', async () => {
            await kv.incr({ key, pathAndAmountMap: { total: 80 } });

            const { res } = await target.incr({
                key,
                pathAndAmountMap: { total: 5 },
            });

            expect((res as { total: number }).total).toBe(85);
        });

        it('keeps fractional costs exact through a flush', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 0.25 } });
            const { res } = await target.incr({
                key,
                pathAndAmountMap: { total: 0.5 },
            });

            expect((res as { total: number }).total).toBe(0.75);
            await target.flushCycle();
            expect(await storedTotal(key)).toBe(0.75);
        });

        it('records the increment even when the cache is unreachable', async () => {
            const boom = vi
                .spyOn(
                    server.clients.redis as unknown as {
                        meterIncr: () => Promise<never>;
                    },
                    'meterIncr',
                )
                .mockRejectedValue(new Error('cache down'));

            const { res, exact } = await target.incr({
                key,
                pathAndAmountMap: { total: 9 },
            });

            // Written straight through, so it is authoritative and exact.
            expect(exact).toBe(true);
            expect((res as { total: number }).total).toBe(9);
            expect(await storedTotal(key)).toBe(9);
            boom.mockRestore();
        });
    });

    describe('incrAux', () => {
        it('defers aggregate writes to the flush loop', async () => {
            await target.incrAux({ key, pathAndAmountMap: { total: 7 } });
            expect(await storedTotal(key)).toBe(0);

            await target.flushCycle();
            expect(await storedTotal(key)).toBe(7);
        });

        it('records the aggregate even when the cache is unreachable', async () => {
            const boom = vi
                .spyOn(
                    server.clients.redis as unknown as {
                        meterIncr: () => Promise<never>;
                    },
                    'meterIncr',
                )
                .mockRejectedValue(new Error('cache down'));

            await target.incrAux({ key, pathAndAmountMap: { total: 4 } });

            expect(await storedTotal(key)).toBe(4);
            boom.mockRestore();
        });
    });

    describe('get', () => {
        it('reads back increments that have not been written onward', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 12 } });

            const { res } = await target.get({ key });
            expect((res as { total: number }).total).toBe(12);
            expect(await storedTotal(key)).toBe(0);
        });

        it('reads an unknown counter as absent', async () => {
            const { res } = await target.get({ key });
            expect(res).toBeNull();
        });

        it('sees a counter written straight to the store', async () => {
            await kv.incr({ key, pathAndAmountMap: { total: 3 } });
            const { res } = await target.get({ key });
            expect((res as { total: number }).total).toBe(3);
        });

        it('keeps array reads aligned with the keys asked for', async () => {
            const other = `${key}:other`;
            await target.incr({ key, pathAndAmountMap: { total: 1 } });

            const { res } = await target.get({ key: [key, other] });
            expect(Array.isArray(res)).toBe(true);
            expect((res as [{ total: number }, null])[0].total).toBe(1);
            expect((res as [unknown, null])[1]).toBeNull();
        });

        it('does not mark a counter for flushing just by reading it', async () => {
            await target.get({ key });
            expect(await cacheKeys()).toEqual([]);
        });

        it('is consistent with the total incr returned', async () => {
            const { res: fromIncr } = await target.incr({
                key,
                pathAndAmountMap: { total: 6, 'ai:chat.units': 2 },
            });
            const { res: fromGet } = await target.get({ key });
            expect(fromGet).toEqual(fromIncr);
        });
    });

    describe('readExact', () => {
        it('writes buffered increments onward before reading back', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 33 } });
            expect(await storedTotal(key)).toBe(0);

            const { res } = await target.readExact({ key });

            expect((res as { total: number }).total).toBe(33);
            expect(await storedTotal(key)).toBe(33);
        });

        it('surfaces usage another deployment recorded', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 10 } });
            await target.flushCycle();

            // Stand in for another deployment flushing the same counter; the
            // buffered view has no way to know about it.
            await kv.incr({ key, pathAndAmountMap: { total: 40 } });

            const { res: buffered } = await target.get({ key });
            expect((buffered as { total: number }).total).toBe(10);

            const { res: exact } = await target.readExact({ key });
            expect((exact as { total: number }).total).toBe(50);
        });

        it('reads an untouched counter without inventing one', async () => {
            const { res } = await target.readExact({ key });
            expect(res).toBeNull();
        });
    });

    describe('flush claim', () => {
        it('hands a delta to exactly one of two concurrent flushes', async () => {
            await target.incrAux({ key, pathAndAmountMap: { total: 10 } });

            await Promise.all([target.flushCycle(), target.flushCycle()]);

            expect(await storedTotal(key)).toBe(10);
        });

        it('keeps increments that arrive after a flush', async () => {
            await target.incrAux({ key, pathAndAmountMap: { total: 10 } });
            await target.flushCycle();
            await target.incrAux({ key, pathAndAmountMap: { total: 4 } });
            await target.flushCycle();

            expect(await storedTotal(key)).toBe(14);
        });

        it('leaves nothing buffered once a cycle has drained', async () => {
            await target.incrAux({ key, pathAndAmountMap: { total: 1 } });
            await target.flushCycle();

            const tag = bucketTag(key);
            expect(
                await server.clients.redis.exists(`meter:d:{${tag}}:${key}`),
            ).toBe(0);
            expect(
                await server.clients.redis.scard(`meter:dirty:{${tag}}`),
            ).toBe(0);
            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
        });

        it('maintains the base from what the store returned', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 10 } });
            await target.flushCycle();

            const tag = bucketTag(key);
            expect(
                await server.clients.redis.hget(
                    `meter:b:{${tag}}:${key}`,
                    'total',
                ),
            ).toBe('10');
        });

        it('does not let the base total move backwards', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 100 } });
            await target.flushCycle();

            const tag = bucketTag(key);
            const base = `meter:b:{${tag}}:${key}`;
            // A settle carrying an older, smaller view must not win.
            await server.clients.redis.hset(
                `meter:p:{${tag}}:stalenonce`,
                'total',
                '1',
            );
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                'stalenonce',
                `${Date.now() - 60_000}:${key}`,
            );
            await target.flushCycle();

            expect(Number(await server.clients.redis.hget(base, 'total'))).toBe(
                101,
            );
        });

        it('flushes many counters in one cycle', async () => {
            const keys = Array.from(
                { length: 25 },
                (_, i) => `${key}-many-${i}`,
            );
            for (const k of keys) {
                await target.incrAux({
                    key: k,
                    pathAndAmountMap: { total: 2 },
                });
            }

            await target.flushCycle();

            for (const k of keys) expect(await storedTotal(k)).toBe(2);
        });

        it('groups every key it touches into one hash slot', async () => {
            await target.incrAux({ key, pathAndAmountMap: { total: 1 } });
            const expected = `{${bucketTag(key)}}`;

            const keys = await cacheKeys();
            expect(keys.length).toBeGreaterThan(0);
            for (const cacheKey of keys) {
                expect(cacheKey).toContain(expected);
            }
        });

        it('reports nothing to do on an idle cycle', async () => {
            expect(await target.flushCycle()).toBe(0);
        });
    });

    describe('flush timer', () => {
        // Its own backend, because this is the one test that needs the flush
        // loop the server installs at boot to be left running.
        it('writes buffered counters onward on its own', async () => {
            const own = await setupTestServer();
            try {
                const timerKey = `metering:actor:timer-${Math.random()
                    .toString(36)
                    .slice(2)}:2026-08`;
                await own.stores.meteringBuffer.incrAux({
                    key: timerKey,
                    pathAndAmountMap: { total: 6 },
                });

                // Nothing here calls flushCycle — the loop has to do it.
                await vi.waitFor(
                    async () => {
                        const { res } = await own.stores.kv.get({
                            key: timerKey,
                        });
                        expect((res as { total?: number } | null)?.total).toBe(
                            6,
                        );
                    },
                    { timeout: 15_000, interval: 250 },
                );
            } finally {
                await own.shutdown();
            }
        }, 25_000);
    });

    describe('orphan recovery', () => {
        it('re-drives a claim whose flush never finished', async () => {
            const tag = bucketTag(key);
            const nonce = 'orphanednonce';

            await server.clients.redis.hset(
                `meter:p:{${tag}}:${nonce}`,
                'total',
                '25',
            );
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                nonce,
                `${Date.now() - 60_000}:${key}`,
            );

            await target.flushCycle();

            expect(await storedTotal(key)).toBe(25);
            expect(
                await server.clients.redis.exists(`meter:p:{${tag}}:${nonce}`),
            ).toBe(0);
            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
        });

        it('re-drives an abandoned claim through exactly one of two concurrent flushes', async () => {
            const tag = bucketTag(key);
            const nonce = 'abandonednonce';

            await server.clients.redis.hset(
                `meter:p:{${tag}}:${nonce}`,
                'total',
                '25',
            );
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                nonce,
                `${Date.now() - 60_000}:${key}`,
            );

            // The pending index is read without removing anything, so both
            // cycles see this claim. Only one of them may write it onward —
            // usage counted twice here would over-bill.
            await Promise.all([target.flushCycle(), target.flushCycle()]);

            expect(await storedTotal(key)).toBe(25);
            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
        });

        it('leaves a claim that is still fresh alone', async () => {
            const tag = bucketTag(key);
            await server.clients.redis.hset(
                `meter:p:{${tag}}:freshnonce`,
                'total',
                '25',
            );
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                'freshnonce',
                `${Date.now()}:${key}`,
            );

            await target.flushCycle();

            expect(await storedTotal(key)).toBe(0);
        });

        it('drops an index entry whose data is gone', async () => {
            const tag = bucketTag(key);
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                'lostnonce',
                `${Date.now() - 60_000}:${key}`,
            );

            await target.flushCycle();

            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
        });

        it('leaves the claim in place when the write onward fails', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 5 } });
            const boom = vi
                .spyOn(kv, 'incr')
                .mockRejectedValue(new Error('store unavailable'));

            await target.flushCycle();
            boom.mockRestore();

            // The delta was claimed but never written, so it must still be
            // recoverable rather than silently dropped.
            const tag = bucketTag(key);
            const pending = await server.clients.redis.hgetall(
                `meter:pending:{${tag}}`,
            );
            expect(Object.keys(pending)).toHaveLength(1);
            expect(await storedTotal(key)).toBe(0);
        });
    });

    describe('month boundaries', () => {
        it('keeps the counter for each month independent', async () => {
            const august = `${key}-2026-08`;
            const september = `${key}-2026-09`;

            await target.incr({ key: august, pathAndAmountMap: { total: 10 } });
            const carried = await target.incr({
                key: september,
                pathAndAmountMap: { total: 3 },
            });

            // A new month is a new counter, so nothing carries over.
            expect((carried.res as { total: number }).total).toBe(3);

            await target.flushCycle();
            expect(await storedTotal(august)).toBe(10);
            expect(await storedTotal(september)).toBe(3);
        });

        it('starts a fresh base when the month rolls over mid-flight', async () => {
            const august = `${key}-2026-08`;
            const september = `${key}-2026-09`;

            await target.incr({ key: august, pathAndAmountMap: { total: 10 } });
            await target.flushCycle();
            await target.incr({
                key: september,
                pathAndAmountMap: { total: 1 },
            });
            await target.flushCycle();

            expect(
                await server.clients.redis.hget(
                    `meter:b:{${bucketTag(august)}}:${august}`,
                    'total',
                ),
            ).toBe('10');
            expect(
                await server.clients.redis.hget(
                    `meter:b:{${bucketTag(september)}}:${september}`,
                    'total',
                ),
            ).toBe('1');
        });
    });
});
