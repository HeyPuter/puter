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
import {
    INCR_EXPRESSION_BUDGET_BYTES,
    incrExpressionBytes,
    type SystemKVStore,
} from '../systemKv/SystemKVStore.ts';
import {
    bucketTag,
    chunkAmounts,
    flattenAmounts,
    isBilledCounter,
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

        it('leaves a counter that already fits in one piece', () => {
            const amounts = { total: 5, 'ai:chat.units': 2 };
            expect(chunkAmounts(amounts)).toEqual([amounts]);
        });

        it('splits a counter too wide for one write, losing nothing', () => {
            const amounts: Record<string, number> = {};
            for (let i = 0; i < 200; i++) amounts[`ai${i}.units`] = i;

            const chunks = chunkAmounts(amounts);

            expect(chunks.length).toBeGreaterThan(1);
            expect(Object.assign({}, ...chunks)).toEqual(amounts);
        });

        it('splits on the size of the write, not the number of paths', () => {
            // Long usage types are the case a path count gets wrong: the name
            // is what makes an expression long, and it lands in it twice.
            const long: Record<string, number> = {};
            const short: Record<string, number> = {};
            for (let i = 0; i < 24; i++) {
                long[
                    `together:meta-llama/Meta-Llama-3_dot_1-405B-Instruct-Turbo:kind${i}.units`
                ] = 1;
                short[`m${i}.units`] = 1;
            }

            expect(chunkAmounts(short)).toHaveLength(1);
            expect(chunkAmounts(long).length).toBeGreaterThan(1);
            expect(Object.assign({}, ...chunkAmounts(long))).toEqual(long);
        });
    });

    describe('counter kinds', () => {
        it("tells an actor's own month from the aggregates", () => {
            const uuid = '0f6a1b2c-3d4e-5f60-7182-93a4b5c6d7e8';
            expect(isBilledCounter(`metering:actor:${uuid}:2026-08`)).toBe(
                true,
            );
            expect(
                isBilledCounter(`metering:actor:${uuid}:app:app-1:2026-08`),
            ).toBe(false);
            expect(isBilledCounter(`metering:actor:${uuid}:apps:2026-08`)).toBe(
                false,
            );
            expect(isBilledCounter('metering:puter:412:2026-08')).toBe(false);
            expect(isBilledCounter('metering:app:app-1:412:2026-08')).toBe(
                false,
            );
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

        it('splits a counter too wide for one expression across writes', async () => {
            // Buffering is what makes this reachable: a single call meters a
            // handful of paths, but a cycle's worth of calls for a busy counter
            // adds up past what one update expression can hold.
            const paths: Record<string, number> = {};
            for (let i = 0; i < 60; i++) paths[`ai${i}.units`] = 1;
            await target.incr({ key, pathAndAmountMap: paths });

            const incrSpy = vi.spyOn(kv, 'incr');
            await target.flushCycle();

            expect(incrSpy.mock.calls.length).toBeGreaterThan(1);
            for (const [input] of incrSpy.mock.calls) {
                expect(
                    incrExpressionBytes(Object.keys(input.pathAndAmountMap)),
                ).toBeLessThanOrEqual(INCR_EXPRESSION_BUDGET_BYTES);
            }
            incrSpy.mockRestore();

            const stored = flattenAmounts((await kv.get({ key })).res);
            expect(Object.keys(stored)).toHaveLength(60);
        });

        it('settles a counter whose paths are long, losing nothing', async () => {
            // A count-based split accepted these and the store rejected the
            // write, which cost the whole counter: two models' worth of long
            // usage types renders past what one expression can hold.
            const models = [
                'together:meta-llama/Meta-Llama-3_dot_1-405B-Instruct-Turbo',
                'openrouter:anthropic/claude-sonnet-4_dot_5-20250929',
            ];
            const paths: Record<string, number> = { total: 12 };
            for (const model of models) {
                for (const kind of [
                    'input_tokens',
                    'output_tokens',
                    'cache_read_input_tokens',
                    'usd_cents',
                ]) {
                    for (const field of ['units', 'cost', 'count'])
                        paths[`${model}:${kind}.${field}`] = 1;
                }
            }
            await target.incr({ key, pathAndAmountMap: paths });

            const incrSpy = vi.spyOn(kv, 'incr');
            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            await target.flushCycle();
            expect(logged).not.toHaveBeenCalled();
            logged.mockRestore();

            // The store the real deployment writes to rejects an expression
            // past its limit outright, so what matters is that none of these
            // writes was ever built that big.
            for (const [input] of incrSpy.mock.calls) {
                expect(
                    incrExpressionBytes(Object.keys(input.pathAndAmountMap)),
                ).toBeLessThanOrEqual(INCR_EXPRESSION_BUDGET_BYTES);
            }
            incrSpy.mockRestore();

            const stored = flattenAmounts((await kv.get({ key })).res);
            expect(stored).toEqual(paths);
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
            expect(
                await server.clients.redis.zcard(`meter:inflight:{${tag}}`),
            ).toBe(0);
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

        it('raises the alarm for an index entry whose data is gone', async () => {
            // The claim's amounts left the cache and only the entry pointing at
            // them survived. Nothing downstream will ever notice the gap, so
            // dropping the entry quietly is the one thing this must not do.
            const tag = bucketTag(key);
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                'lostnonce',
                `${Date.now() - 60_000}:${key}`,
            );
            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');

            await target.flushCycle();

            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
            expect(logged).toHaveBeenCalledWith(
                expect.stringContaining('lost its amounts'),
            );
            expect(alarmSpy).toHaveBeenCalledWith(
                `metering_claim_lost:${key}`,
                expect.stringContaining('under-billed'),
                { key },
                'critical',
                expect.objectContaining({ dedup: true }),
            );
            logged.mockRestore();
            alarmSpy.mockRestore();
        });

        it('stays quiet when another flush re-keyed the claim first', async () => {
            // Both cycles see the same abandoned claim; the one that loses the
            // rename finds nothing where the claim used to be. That is the
            // ordinary outcome of the race, not usage lost, and calling it loss
            // would make the alarm fire on every deploy.
            const tag = bucketTag(key);
            await server.clients.redis.hset(
                `meter:p:{${tag}}:racednonce`,
                'total',
                '25',
            );
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                'racednonce',
                `${Date.now() - 60_000}:${key}`,
            );
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');

            await Promise.all([target.flushCycle(), target.flushCycle()]);

            expect(await storedTotal(key)).toBe(25);
            expect(alarmSpy).not.toHaveBeenCalledWith(
                `metering_claim_lost:${key}`,
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
            );
            alarmSpy.mockRestore();
        });

        it('retires an abandoned claim whose amounts all landed, quietly', async () => {
            // Every path was written onward and taken off the claim, and then
            // the deployment went away before it could retire it. Nothing was
            // lost here, so the sweep has to finish the bookkeeping without
            // reporting loss — and without settling, which would replace a good
            // base with this claim's stale view.
            const tag = bucketTag(key);
            await target.incr({ key, pathAndAmountMap: { total: 40 } });
            await target.flushCycle();

            await server.clients.redis.hset(
                `meter:p:{${tag}}:appliednonce`,
                '__claim',
                String(Date.now() - 60_000),
            );
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                'appliednonce',
                `${Date.now() - 60_000}:${key}`,
            );
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');

            await target.flushCycle();

            expect(alarmSpy).not.toHaveBeenCalled();
            expect(await storedTotal(key)).toBe(40);
            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
            expect(
                await server.clients.redis.hget(
                    `meter:b:{${tag}}:${key}`,
                    'total',
                ),
            ).toBe('40');
            alarmSpy.mockRestore();
        });

        it('keeps a claim addressable once its last amount is applied', async () => {
            // Amounts come off a claim as they land, and a hash with nothing
            // left in it stops existing — which would make a finished claim
            // indistinguishable from one whose amounts were lost.
            await target.incr({ key, pathAndAmountMap: { total: 5 } });

            const tag = bucketTag(key);
            const settle = vi
                .spyOn(
                    server.clients.redis as unknown as {
                        meterSettle: () => Promise<unknown>;
                    },
                    'meterSettle',
                )
                .mockImplementation(async () => {
                    // Mid-settle: every amount has been applied and taken off
                    // the claim, but the claim itself has not been retired.
                    const pending = await server.clients.redis.hgetall(
                        `meter:pending:{${tag}}`,
                    );
                    const nonce = Object.keys(pending)[0]!;
                    expect(
                        await server.clients.redis.exists(
                            `meter:p:{${tag}}:${nonce}`,
                        ),
                    ).toBe(1);
                    return 1;
                });

            await target.flushCycle();
            settle.mockRestore();

            expect(await storedTotal(key)).toBe(5);
        });

        it('gives up on a path the store will never accept', async () => {
            // Named so the give-up is remembered against a path no other test
            // settles — the memo that stops it being rediscovered every cycle
            // outlives this test.
            const doomed = 'never_writable_by_this_test.units';
            await target.incr({ key, pathAndAmountMap: { [doomed]: 5 } });
            // A rejection, not an outage: the next attempt would be rejected
            // identically. Re-driving it every cycle for as long as the counter
            // exists is what turned one bad counter into a write loop.
            const rejected = Object.assign(
                new Error(
                    'Invalid UpdateExpression: Expression size has exceeded the maximum allowed size',
                ),
                { name: 'ValidationException' },
            );
            const boom = vi.spyOn(kv, 'incr').mockRejectedValue(rejected);
            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');

            await target.flushCycle();
            boom.mockRestore();

            const tag = bucketTag(key);
            expect(
                await server.clients.redis.hgetall(`meter:pending:{${tag}}`),
            ).toEqual({});
            expect(await server.clients.redis.keys('meter:p:*')).toEqual([]);
            // The amounts are lost, so this must not be quiet.
            expect(logged).toHaveBeenCalledWith(
                expect.stringContaining('unwritable path'),
            );
            logged.mockRestore();

            // Losing an actor's own spending is somebody's money, so it pages.
            expect(alarmSpy).toHaveBeenCalledWith(
                `metering_usage_dropped:${key}`,
                expect.stringContaining('under-billed'),
                expect.objectContaining({ key, paths: [doomed] }),
                'critical',
                expect.objectContaining({ dedup: true }),
            );
            alarmSpy.mockRestore();

            // And a second cycle finds nothing left to re-drive.
            const after = vi.spyOn(kv, 'incr');
            await target.flushCycle();
            expect(after).not.toHaveBeenCalled();
            after.mockRestore();
        });

        it('keeps every path an unwritable one was batched with', async () => {
            const doomed = 'poison_path_kept_test.units';
            await target.incr({
                key,
                pathAndAmountMap: {
                    total: 9,
                    'ai:chat.units': 4,
                    [doomed]: 1,
                    'egress:bytes.units': 7,
                },
            });

            // Only the one path is refused; anything batched with it is fine.
            const passThrough = kv.incr.bind(kv);
            const picky = vi
                .spyOn(kv, 'incr')
                .mockImplementation((...args: Parameters<typeof kv.incr>) => {
                    if (doomed in args[0].pathAndAmountMap) {
                        return Promise.reject(
                            Object.assign(new Error('nope'), {
                                name: 'ValidationException',
                            }),
                        );
                    }
                    return passThrough(...args);
                });
            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            await target.flushCycle();
            picky.mockRestore();
            logged.mockRestore();

            // The good paths land in full; only the refused one is missing.
            const stored = flattenAmounts((await kv.get({ key })).res);
            expect(stored).toEqual({
                total: 9,
                'ai:chat.units': 4,
                'egress:bytes.units': 7,
            });
        });

        it('records an aggregate drop without paging', async () => {
            const aggregate = `metering:puter:7:2026-08`;
            const doomed = 'aggregate_poison_test.units';
            await target.incrAux({
                key: aggregate,
                pathAndAmountMap: { [doomed]: 3 },
            });

            const boom = vi.spyOn(kv, 'incr').mockRejectedValue(
                Object.assign(new Error('nope'), {
                    name: 'ValidationException',
                }),
            );
            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const alarmSpy = vi.spyOn(server.clients.alarm, 'create');

            await target.flushCycle();
            boom.mockRestore();
            logged.mockRestore();

            expect(alarmSpy).toHaveBeenCalledWith(
                'metering_aggregate_usage_dropped',
                expect.stringContaining('under-count'),
                expect.objectContaining({ key: aggregate }),
                'warning',
                expect.objectContaining({ dedup: true }),
            );
            alarmSpy.mockRestore();
        });

        it('does not write an applied chunk twice when a later one fails', async () => {
            const paths: Record<string, number> = {};
            for (let i = 0; i < 30; i++) paths[`ai${i}.units`] = 1;
            await target.incr({ key, pathAndAmountMap: paths });

            // Two chunks: let the first through and fail the second, the way a
            // throttle landing mid-settle would.
            const passThrough = kv.incr.bind(kv);
            let call = 0;
            const flaky = vi
                .spyOn(kv, 'incr')
                .mockImplementation((...args: Parameters<typeof kv.incr>) => {
                    if (++call === 2)
                        return Promise.reject(new Error('throttled'));
                    return passThrough(...args);
                });

            await target.flushCycle();
            flaky.mockRestore();

            // Age the surviving claim so the sweep takes it, then let it finish.
            const tag = bucketTag(key);
            const pending = await server.clients.redis.hgetall(
                `meter:pending:{${tag}}`,
            );
            const nonce = Object.keys(pending)[0]!;
            await server.clients.redis.hset(
                `meter:pending:{${tag}}`,
                nonce,
                `${Date.now() - 60_000}:${key}`,
            );

            await target.flushCycle();

            // Every path lands exactly once: the applied chunk came off the
            // claim as it was written, so the re-drive carried only the rest.
            const stored = flattenAmounts((await kv.get({ key })).res);
            expect(Object.keys(stored)).toHaveLength(30);
            expect([...new Set(Object.values(stored))]).toEqual([1]);
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

        it('recovers a counter whose claim never happens', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 5 } });
            const tag = bucketTag(key);

            // A cycle that takes the counter and then cannot claim it — the
            // cache dropped the call, or the deployment went away mid-flush.
            // Between those two steps the in-flight record is the only thing
            // that knows this counter has amounts waiting.
            const boom = vi
                .spyOn(
                    server.clients.redis as unknown as {
                        meterClaim: () => Promise<unknown>;
                    },
                    'meterClaim',
                )
                .mockRejectedValue(new Error('cache unreachable'));
            const warned = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            await target.flushCycle();
            boom.mockRestore();

            expect(await storedTotal(key)).toBe(0);
            expect(
                await server.clients.redis.zscore(
                    `meter:inflight:{${tag}}`,
                    key,
                ),
            ).not.toBeNull();

            // Nothing has been in flight long enough to look abandoned yet, so
            // a cycle right behind it leaves the counter alone.
            await target.flushCycle();
            expect(await storedTotal(key)).toBe(0);

            // Once it has, the counter goes back on the dirty set and settles
            // in full — the amounts were never at risk, only delayed.
            await server.clients.redis.zadd(
                `meter:inflight:{${tag}}`,
                String(Date.now() - 60_000),
                key,
            );
            await target.flushCycle();
            warned.mockRestore();

            expect(await storedTotal(key)).toBe(5);
            expect(
                await server.clients.redis.zcard(`meter:inflight:{${tag}}`),
            ).toBe(0);
        });

        it('takes each counter for one deployment only', async () => {
            // Two drains overlapping in time must divide a bucket rather than
            // both working through it from the front, or the drain rate stops
            // improving when deployments are added.
            const keys = Array.from(
                { length: 6 },
                (_, i) => `${key}-share-${i}`,
            );
            const tag = 'mshare';
            for (const k of keys) {
                await server.clients.redis.sadd(`meter:dirty:{${tag}}`, k);
            }

            const drain = (): Promise<[string[], number]> =>
                (
                    server.clients.redis as unknown as {
                        meterDrain: (
                            ...args: string[]
                        ) => Promise<[string[], number]>;
                    }
                ).meterDrain(
                    `meter:dirty:{${tag}}`,
                    `meter:inflight:{${tag}}`,
                    '3',
                    String(Date.now()),
                    '60000',
                    String(Date.now() - 30_000),
                );

            const [first, remainingAfterFirst] = await drain();
            const [second, remainingAfterSecond] = await drain();

            expect(first).toHaveLength(3);
            expect(second).toHaveLength(3);
            expect([...first, ...second].sort()).toEqual([...keys].sort());
            expect(Number(remainingAfterFirst)).toBe(3);
            expect(Number(remainingAfterSecond)).toBe(0);
        });

        it('does not write a settled counter twice when its base is not replaced', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 5 } });

            // The write onward lands, then the cache call that adopts the new
            // base fails. The amounts are already applied, so a re-drive must
            // not apply them again.
            const boom = vi
                .spyOn(
                    server.clients.redis as unknown as {
                        meterSettle: () => Promise<unknown>;
                    },
                    'meterSettle',
                )
                .mockRejectedValue(new Error('cache unreachable'));
            const warned = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            await target.flushCycle();
            boom.mockRestore();
            expect(await storedTotal(key)).toBe(5);

            // Age whatever is left of the claim so the sweep takes it.
            const tag = bucketTag(key);
            const pending = await server.clients.redis.hgetall(
                `meter:pending:{${tag}}`,
            );
            for (const nonce of Object.keys(pending)) {
                await server.clients.redis.hset(
                    `meter:pending:{${tag}}`,
                    nonce,
                    `${Date.now() - 60_000}:${key}`,
                );
            }

            await target.flushCycle();
            await target.flushCycle();
            warned.mockRestore();

            expect(await storedTotal(key)).toBe(5);
        });
    });

    describe('reconciliation', () => {
        it('puts back a delta that fell off its dirty set', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 17 } });

            // The delta survives but the working list forgot it — a failover,
            // or a set that went while the counter it pointed at stayed. From
            // here nothing would ever flush this: reads keep answering from it
            // right up until the TTL takes the amounts with it.
            const tag = bucketTag(key);
            await server.clients.redis.del(`meter:dirty:{${tag}}`);
            expect(await target.flushCycle()).toBe(0);
            expect(await storedTotal(key)).toBe(0);

            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            await target.reconcile();
            expect(logged).toHaveBeenCalledWith(
                expect.stringContaining('recovered 1 buffered counter'),
            );
            logged.mockRestore();

            await target.flushCycle();
            expect(await storedTotal(key)).toBe(17);
        });

        it('leaves a counter that is only between the drain and its claim', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 8 } });
            const tag = bucketTag(key);

            // Taken off the dirty set and not yet claimed. It is not lost — the
            // in-flight record is holding it — and putting it back here would
            // hand the same delta to two flushes at once.
            await server.clients.redis.del(`meter:dirty:{${tag}}`);
            await server.clients.redis.zadd(
                `meter:inflight:{${tag}}`,
                String(Date.now()),
                key,
            );

            await target.reconcile();

            expect(
                await server.clients.redis.scard(`meter:dirty:{${tag}}`),
            ).toBe(0);
        });

        it('retires what it tracks once a counter has settled', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 3 } });
            const tag = bucketTag(key);
            expect(
                await server.clients.redis.smembers(`meter:tracked:{${tag}}`),
            ).toEqual([key]);

            await target.flushCycle();

            // Otherwise every counter the bucket ever saw stays on the list and
            // each sweep costs more than the last.
            expect(
                await server.clients.redis.smembers(`meter:tracked:{${tag}}`),
            ).toEqual([]);
        });

        it('keeps tracking a counter that took on more mid-flush', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 3 } });
            const tag = bucketTag(key);

            // An increment landing between the claim and the settle starts a
            // fresh delta. Retiring the entry on the settle that is finishing
            // would leave that delta with nothing pointing at it.
            const settle = server.clients.redis as unknown as {
                meterSettle: (...args: string[]) => Promise<number>;
            };
            const real = settle.meterSettle.bind(settle);
            const racing = vi
                .spyOn(settle, 'meterSettle')
                .mockImplementation(async (...args: string[]) => {
                    await target.incr({ key, pathAndAmountMap: { total: 4 } });
                    return real(...args);
                });

            await target.flushCycle();
            racing.mockRestore();

            expect(
                await server.clients.redis.smembers(`meter:tracked:{${tag}}`),
            ).toEqual([key]);

            await target.flushCycle();
            expect(await storedTotal(key)).toBe(7);
        });

        it('reports nothing when every bucket is in order', async () => {
            await target.incr({ key, pathAndAmountMap: { total: 1 } });
            const logged = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            await target.reconcile();

            expect(logged).not.toHaveBeenCalled();
            logged.mockRestore();
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
