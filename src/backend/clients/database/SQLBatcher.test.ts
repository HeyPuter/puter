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

import { describe, expect, it, vi } from 'vitest';
import { SQLBatcher } from './SQLBatcher.js';

const makeError = (code: string, message = code): Error & { code: string } => {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
};

interface FakeConnection {
    beginTransaction: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
}

// The batch flush sends one coalesced multi-statement (always suffixed
// `; SELECT 1`); fallback items send their original single statement.
const isBatchQuery = (sql: string) => sql.endsWith('; SELECT 1');

const makeConnection = (
    onQuery: (sql: string, values: unknown[]) => unknown,
): FakeConnection => ({
    beginTransaction: vi.fn(async () => {}),
    query: vi.fn(async (sql: string, values: unknown[]) => onQuery(sql, values)),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
});

const makePool = (connection: FakeConnection | (() => Promise<FakeConnection>)) => {
    const getConnection = vi.fn(async () =>
        typeof connection === 'function' ? connection() : connection,
    );
    return {
        pool: { promise: () => ({ getConnection }) },
        getConnection,
    };
};

// Happy-path onQuery: batch returns one result row-set per statement plus
// the trailing SELECT 1 row-set.
const happyBatch = (sql: string) => {
    if (!isBatchQuery(sql)) throw new Error('unexpected fallback query');
    const statements = sql.split(';').length - 1;
    return [
        Array.from({ length: statements + 1 }, (_, i) => [{ n: i }]),
        undefined,
    ];
};

// Each query on this connection waits until the test releases it, so its
// flush stays in flight.
const makeHeldConnection = () => {
    const held: Array<() => void> = [];
    const conn = makeConnection(
        (sql) =>
            new Promise((resolve) => {
                held.push(() => resolve(happyBatch(sql)));
            }),
    );
    const releaseAll = () => {
        for (const release of held.splice(0)) release();
    };
    const sent = () => conn.query.mock.calls.map(([sql]) => sql);
    return { conn, releaseAll, sent };
};

const fakeFlushTimers = () =>
    vi.useFakeTimers({
        toFake: [
            'setTimeout',
            'clearTimeout',
            'setImmediate',
            'clearImmediate',
        ],
    });

describe('SQLBatcher flush timing', () => {
    it('flushes a lone query on the next turn while under the in-flight cap', async () => {
        const conn = makeConnection(happyBatch);
        const { pool, getConnection } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            readOnly: true,
            maxTimeInQueue: 60_000,
            maxInFlightImmediate: 2,
        });

        const pending = batcher.query('SELECT a', []);
        expect(getConnection).not.toHaveBeenCalled();
        await new Promise((resolve) => setImmediate(resolve));
        expect(getConnection).toHaveBeenCalledTimes(1);
        expect((await pending)[0]).toEqual([{ n: 0 }]);
    });

    it('holds a lone query for maxTimeInQueue without an in-flight cap', async () => {
        fakeFlushTimers();
        try {
            const conn = makeConnection(happyBatch);
            const { pool, getConnection } = makePool(conn);
            const batcher = new SQLBatcher(pool, {
                readOnly: true,
                maxTimeInQueue: 30,
            });

            const pending = batcher.query('SELECT a', []);
            await vi.advanceTimersByTimeAsync(29);
            expect(getConnection).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(getConnection).toHaveBeenCalledTimes(1);
            expect((await pending)[0]).toEqual([{ n: 0 }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('batches queries from the same turn and sends later ones separately', async () => {
        const conn = makeConnection(happyBatch);
        const { pool, getConnection } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            readOnly: true,
            maxInFlightImmediate: 8,
        });

        const sameTurn = [
            batcher.query('SELECT a', []),
            batcher.query('SELECT b', []),
            batcher.query('SELECT c', []),
        ];
        await new Promise((resolve) => setImmediate(resolve));
        const nextTurn = batcher.query('SELECT d', []);
        const results = await Promise.all([...sameTurn, nextTurn]);

        expect(results.map((r) => r[0])).toEqual([
            [{ n: 0 }],
            [{ n: 1 }],
            [{ n: 2 }],
            [{ n: 0 }],
        ]);
        expect(getConnection).toHaveBeenCalledTimes(2);
        expect(conn.query.mock.calls.map(([sql]) => sql)).toEqual([
            'SELECT a;SELECT b;SELECT c; SELECT 1',
            'SELECT d; SELECT 1',
        ]);
    });

    it('gives a query enqueued during an in-flight flush its own flush while under the cap', async () => {
        const { conn, releaseAll, sent } = makeHeldConnection();
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            readOnly: true,
            maxInFlightImmediate: 2,
        });
        const turn = () => new Promise((resolve) => setImmediate(resolve));

        const a = batcher.query('SELECT a', []);
        await turn();
        const b = batcher.query('SELECT b', []);
        await turn();
        expect(sent()).toEqual(['SELECT a; SELECT 1', 'SELECT b; SELECT 1']);

        releaseAll();
        expect((await a)[0]).toEqual([{ n: 0 }]);
        expect((await b)[0]).toEqual([{ n: 0 }]);
    });

    it('holds a lone query for maxTimeInQueue at the in-flight cap and coalesces what follows', async () => {
        fakeFlushTimers();
        try {
            const { conn, releaseAll, sent } = makeHeldConnection();
            const { pool } = makePool(conn);
            const batcher = new SQLBatcher(pool, {
                readOnly: true,
                maxTimeInQueue: 30,
                maxInFlightImmediate: 1,
            });

            const a = batcher.query('SELECT a', []);
            await vi.advanceTimersByTimeAsync(0);
            expect(sent()).toEqual(['SELECT a; SELECT 1']);

            const b = batcher.query('SELECT b', []);
            await vi.advanceTimersByTimeAsync(29);
            const c = batcher.query('SELECT c', []);
            expect(sent()).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(sent()).toEqual([
                'SELECT a; SELECT 1',
                'SELECT b;SELECT c; SELECT 1',
            ]);

            releaseAll();
            expect((await a)[0]).toEqual([{ n: 0 }]);
            expect((await b)[0]).toEqual([{ n: 0 }]);
            expect((await c)[0]).toEqual([{ n: 1 }]);

            // Settled flushes free the cap again.
            const d = batcher.query('SELECT d', []);
            await vi.advanceTimersByTimeAsync(0);
            expect(sent()).toHaveLength(3);
            releaseAll();
            expect((await d)[0]).toEqual([{ n: 0 }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('shares the in-flight cap between batchers given one counter', async () => {
        fakeFlushTimers();
        try {
            const { conn, releaseAll, sent } = makeHeldConnection();
            const { pool } = makePool(conn);
            const inFlight = { count: 0 };
            const opts = {
                readOnly: true,
                maxTimeInQueue: 30,
                maxInFlightImmediate: 1,
                inFlight,
            };
            const first = new SQLBatcher(pool, opts);
            const second = new SQLBatcher(pool, opts);
            const own = new SQLBatcher(pool, { ...opts, inFlight: undefined });

            const a = first.query('SELECT a', []);
            await vi.advanceTimersByTimeAsync(0);
            const b = second.query('SELECT b', []);
            const c = own.query('SELECT c', []);
            await vi.advanceTimersByTimeAsync(0);
            expect(sent()).toEqual([
                'SELECT a; SELECT 1',
                'SELECT c; SELECT 1',
            ]);
            await vi.advanceTimersByTimeAsync(30);
            expect(sent()).toHaveLength(3);
            expect(sent()[2]).toBe('SELECT b; SELECT 1');

            releaseAll();
            await Promise.all([a, b, c]);
            expect(inFlight.count).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('counts a flush as in flight until its per-item fallback settles', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fakeFlushTimers();
        try {
            const held: Array<() => void> = [];
            const conn = makeConnection((sql) => {
                if (isBatchQuery(sql)) throw makeError('ECONNRESET');
                return new Promise((resolve) => {
                    held.push(() => resolve([[{ ok: sql }], undefined]));
                });
            });
            const { pool } = makePool(conn);
            const sent = () => conn.query.mock.calls.map(([sql]) => sql);
            const batcher = new SQLBatcher(pool, {
                readOnly: true,
                maxTimeInQueue: 30,
                maxInFlightImmediate: 1,
                acquireTimeoutMs: 0,
            });

            const a = batcher.query('SELECT a', []);
            await vi.advanceTimersByTimeAsync(0);
            // The batch failed; the per-item retry of `a` is still running.
            expect(sent()).toEqual(['SELECT a; SELECT 1', 'SELECT a']);

            const b = batcher.query('SELECT b', []);
            await vi.advanceTimersByTimeAsync(29);
            expect(sent()).toHaveLength(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(sent()).toEqual([
                'SELECT a; SELECT 1',
                'SELECT a',
                'SELECT b; SELECT 1',
                'SELECT b',
            ]);

            for (const release of held.splice(0)) release();
            expect((await a)[0]).toEqual([{ ok: 'SELECT a' }]);
            expect((await b)[0]).toEqual([{ ok: 'SELECT b' }]);
        } finally {
            vi.useRealTimers();
            warnSpy.mockRestore();
        }
    });

    it('flushes a full batch at once past the cap and cancels the armed wait', async () => {
        fakeFlushTimers();
        try {
            const { conn, releaseAll, sent } = makeHeldConnection();
            const { pool, getConnection } = makePool(conn);
            const batcher = new SQLBatcher(pool, {
                readOnly: true,
                maxBatchSize: 2,
                maxTimeInQueue: 30,
                maxInFlightImmediate: 1,
                acquireTimeoutMs: 0,
            });

            const a = batcher.query('SELECT a', []);
            await vi.advanceTimersByTimeAsync(0);
            const b = batcher.query('SELECT b', []);
            expect(vi.getTimerCount()).toBe(1);
            const c = batcher.query('SELECT c', []);
            expect(getConnection).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);

            // A later lone query waits its own full maxTimeInQueue.
            await vi.advanceTimersByTimeAsync(10);
            const d = batcher.query('SELECT d', []);
            await vi.advanceTimersByTimeAsync(29);
            expect(getConnection).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(getConnection).toHaveBeenCalledTimes(3);
            expect(sent()).toEqual([
                'SELECT a; SELECT 1',
                'SELECT b;SELECT c; SELECT 1',
                'SELECT d; SELECT 1',
            ]);

            releaseAll();
            await Promise.all([a, b, c, d]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels the pending next-turn flush when a batch fills up', async () => {
        fakeFlushTimers();
        try {
            const conn = makeConnection(happyBatch);
            const { pool, getConnection } = makePool(conn);
            const batcher = new SQLBatcher(pool, {
                maxBatchSize: 2,
                readOnly: true,
                maxInFlightImmediate: 8,
                acquireTimeoutMs: 0,
            });

            const a = batcher.query('SELECT a', []);
            expect(vi.getTimerCount()).toBe(1);
            const b = batcher.query('SELECT b', []);
            expect(vi.getTimerCount()).toBe(0);

            const c = batcher.query('SELECT c', []);
            expect(vi.getTimerCount()).toBe(1);
            await vi.runAllTimersAsync();
            await Promise.all([a, b, c]);

            expect(vi.getTimerCount()).toBe(0);
            expect(getConnection).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves no timer armed after a failed flush, a drop or a breaker rejection', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fakeFlushTimers();
        try {
            const getConnection = vi.fn(async () => {
                throw makeError('ECONNREFUSED');
            });
            const batcher = new SQLBatcher(
                { promise: () => ({ getConnection }) },
                {
                    readOnly: true,
                    maxQueueSize: 1,
                    failureThreshold: 1,
                    cooldownMs: 60_000,
                    maxInFlightImmediate: 8,
                },
            );

            const dropped = expect(
                batcher.query('SELECT a', []),
            ).rejects.toMatchObject({ reason: 'queueOverflow' });
            const failed = expect(
                batcher.query('SELECT b', []),
            ).rejects.toMatchObject({ reason: 'connAcquire' });
            expect(vi.getTimerCount()).toBe(1);
            await vi.runAllTimersAsync();
            await dropped;
            await failed;
            expect(vi.getTimerCount()).toBe(0);

            await expect(batcher.query('SELECT c', [])).rejects.toMatchObject({
                reason: 'breakerOpen',
            });
            expect(vi.getTimerCount()).toBe(0);
            expect(batcher.queue).toHaveLength(0);
        } finally {
            vi.useRealTimers();
            warnSpy.mockRestore();
        }
    });
});

describe('SQLBatcher', () => {
    it('resolves each batched item with its own result', async () => {
        const conn = makeConnection(happyBatch);
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxTimeInQueue: 5 });

        const [a, b] = await Promise.all([
            batcher.query('SELECT a', []),
            batcher.query('SELECT b', []),
        ]);
        expect(a[0]).toEqual([{ n: 0 }]);
        expect(b[0]).toEqual([{ n: 1 }]);
        expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('skips the transaction wrapper on a readOnly batcher', async () => {
        const conn = makeConnection(happyBatch);
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            readOnly: true,
        });

        const [a, b] = await Promise.all([
            batcher.query('SELECT a', []),
            batcher.query('SELECT b', []),
        ]);
        expect(a[0]).toEqual([{ n: 0 }]);
        expect(b[0]).toEqual([{ n: 1 }]);
        // BEGIN and COMMIT are round trips; a SELECT-only batch has nothing to
        // roll back, so it must not pay for them.
        expect(conn.beginTransaction).not.toHaveBeenCalled();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('does not roll back a failed readOnly batch', async () => {
        const conn = makeConnection((sql: string) => {
            if (isBatchQuery(sql)) throw makeError('ER_LOCK_DEADLOCK');
            return [[{ n: 0 }], undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            readOnly: true,
        });

        await Promise.all([
            batcher.query('SELECT a', []),
            batcher.query('SELECT b', []),
        ]);
        expect(conn.rollback).not.toHaveBeenCalled();
    });

    it('drops the oldest item with reason queueOverflow at the high-water mark', async () => {
        const conn = makeConnection(() => [[{ n: 0 }], undefined]);
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            maxQueueSize: 1,
        });

        const first = batcher.query('SELECT a', []);
        const second = batcher.query('SELECT b', []);

        await expect(first).rejects.toMatchObject({
            code: 'dbBatchFailed',
            reason: 'queueOverflow',
        });
        await expect(second).resolves.toBeTruthy();
    });

    it('rejects with reason connAcquire after exhausting acquisition retries', async () => {
        const getConnection = vi.fn(async () => {
            throw makeError('ECONNREFUSED');
        });
        const pool = { promise: () => ({ getConnection }) };
        const batcher = new SQLBatcher(pool, { maxTimeInQueue: 5 });

        await expect(batcher.query('SELECT a', [])).rejects.toMatchObject({
            code: 'dbBatchFailed',
            reason: 'connAcquire',
        });
        expect(getConnection).toHaveBeenCalledTimes(3);
    });

    it('bounds connection acquisition and rejects when the pool never answers', async () => {
        const getConnection = vi.fn(
            () => new Promise(() => {}), // pool never yields a connection
        );
        const pool = { promise: () => ({ getConnection }) };
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            acquireTimeoutMs: 30,
        });

        await expect(batcher.query('SELECT a', [])).rejects.toMatchObject({
            code: 'dbBatchFailed',
            reason: 'connAcquire',
        });
        expect(getConnection).toHaveBeenCalledTimes(3);
    });

    it('opens the breaker after consecutive failures and rejects with reason breakerOpen', async () => {
        // Batch and fallback both fail with an ambiguous (non-retriable for
        // writes) connection error, so no item gets through.
        const conn = makeConnection(() => {
            throw makeError('ECONNRESET');
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            failureThreshold: 1,
            cooldownMs: 60_000,
        });

        await expect(batcher.query('INSERT x', [])).rejects.toMatchObject({
            code: 'ECONNRESET',
        });
        await expect(batcher.query('INSERT y', [])).rejects.toMatchObject({
            code: 'dbBatchFailed',
            reason: 'breakerOpen',
        });
    });

    it('retries transient fallback failures when readOnly', async () => {
        let fallbackAttempts = 0;
        const conn = makeConnection((sql) => {
            if (isBatchQuery(sql)) throw makeError('ECONNRESET');
            fallbackAttempts++;
            if (fallbackAttempts === 1) throw makeError('ECONNRESET');
            return [[{ ok: 1 }], undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            readOnly: true,
        });

        const result = await batcher.query('SELECT a', []);
        expect(result[0]).toEqual([{ ok: 1 }]);
        expect(fallbackAttempts).toBe(2);
    });

    it('does not retry ambiguous failures on a batcher that carries writes', async () => {
        let fallbackAttempts = 0;
        const conn = makeConnection((sql) => {
            if (isBatchQuery(sql)) throw makeError('ECONNRESET');
            fallbackAttempts++;
            throw makeError('ECONNRESET');
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxTimeInQueue: 5 });

        await expect(batcher.query('INSERT x', [])).rejects.toMatchObject({
            code: 'ECONNRESET',
        });
        expect(fallbackAttempts).toBe(1);
    });

    it('retries never-sent failures even on a batcher that carries writes', async () => {
        let fallbackAttempts = 0;
        const conn = makeConnection((sql) => {
            if (isBatchQuery(sql)) throw makeError('ECONNRESET');
            fallbackAttempts++;
            if (fallbackAttempts === 1) throw makeError('ECONNREFUSED');
            return [[{ ok: 1 }], undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxTimeInQueue: 5 });

        const result = await batcher.query('INSERT x', []);
        expect(result[0]).toEqual([{ ok: 1 }]);
        expect(fallbackAttempts).toBe(2);
    });

    it('retries a deadlocked write instead of surfacing it', async () => {
        let fallbackAttempts = 0;
        const conn = makeConnection((sql) => {
            if (isBatchQuery(sql)) throw makeError('ER_LOCK_DEADLOCK');
            fallbackAttempts++;
            if (fallbackAttempts === 1) throw makeError('ER_LOCK_DEADLOCK');
            return [[{ ok: 1 }], undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxTimeInQueue: 5 });

        // The victim statement was rolled back by the server, so re-running it
        // can't double-apply — the caller should never see the deadlock.
        const result = await batcher.query('UPDATE notification SET x', []);
        expect(result[0]).toEqual([{ ok: 1 }]);
        expect(fallbackAttempts).toBe(2);
    });

    it('gives up on a write that deadlocks past the retry budget', async () => {
        const conn = makeConnection(() => {
            throw makeError('ER_LOCK_DEADLOCK');
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxTimeInQueue: 5 });

        await expect(batcher.query('UPDATE hot SET x', [])).rejects.toMatchObject(
            { code: 'ER_LOCK_DEADLOCK' },
        );
    });

    it('sends a lone write as-is, outside a transaction', async () => {
        const conn = makeConnection((sql) => {
            if (isBatchQuery(sql)) throw new Error('unexpected batch query');
            return [{ affectedRows: 1 }, undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxBatchSize: 1 });

        const result = await batcher.query('UPDATE t SET x = ?', [1]);
        expect(result[0]).toEqual({ affectedRows: 1 });
        expect(conn.query).toHaveBeenCalledTimes(1);
        expect(conn.query).toHaveBeenCalledWith('UPDATE t SET x = ?', [1]);
        expect(conn.beginTransaction).not.toHaveBeenCalled();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('runs a lone write the server rejects once, without tripping the breaker', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const conn = makeConnection((sql) => {
            if (sql === 'INSERT dup') throw makeError('ER_DUP_ENTRY');
            return [{ affectedRows: 1 }, undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxBatchSize: 1,
            failureThreshold: 1,
            cooldownMs: 60_000,
        });

        await expect(batcher.query('INSERT dup', [])).rejects.toMatchObject({
            code: 'ER_DUP_ENTRY',
        });
        expect(conn.query).toHaveBeenCalledTimes(1);
        expect(conn.rollback).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        // The server answered, so it is up: the next write goes through.
        await expect(batcher.query('INSERT fine', [])).resolves.toBeTruthy();
        warnSpy.mockRestore();
    });

    it('retries a lone write on a connection the server closed for inactivity', async () => {
        let attempts = 0;
        const conn = makeConnection(() => {
            attempts++;
            if (attempts === 1) {
                throw makeError('ER_CLIENT_INTERACTION_TIMEOUT');
            }
            return [{ affectedRows: 1 }, undefined];
        });
        const { pool, getConnection } = makePool(conn);
        const batcher = new SQLBatcher(pool, { maxBatchSize: 1 });

        const result = await batcher.query('INSERT x', []);
        expect(result[0]).toEqual({ affectedRows: 1 });
        expect(attempts).toBe(2);
        expect(getConnection).toHaveBeenCalledTimes(2);
    });

    it('never retries deterministic row-level errors and does not escalate the breaker', async () => {
        let fallbackAttempts = 0;
        const conn = makeConnection((sql) => {
            if (isBatchQuery(sql)) throw makeError('ER_DUP_ENTRY');
            fallbackAttempts++;
            if (sql === 'INSERT dup') throw makeError('ER_DUP_ENTRY');
            return [[{ ok: 1 }], undefined];
        });
        const { pool } = makePool(conn);
        const batcher = new SQLBatcher(pool, {
            maxTimeInQueue: 5,
            failureThreshold: 1,
            cooldownMs: 60_000,
            readOnly: true,
        });

        const dup = batcher.query('INSERT dup', []);
        const fine = batcher.query('INSERT fine', []);
        await expect(dup).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
        await expect(fine).resolves.toBeTruthy();
        expect(fallbackAttempts).toBe(2);

        // One fallback item succeeded, so the breaker must stay closed.
        const conn2 = makeConnection(happyBatch);
        // reuse same batcher/pool: next query must not be rejected upfront
        conn.query.mockImplementation(conn2.query.getMockImplementation()!);
        await expect(batcher.query('SELECT a', [])).resolves.toBeTruthy();
    });
});
