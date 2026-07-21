/**
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

    it('drops the oldest item with reason queueOverflow at the high-water mark', async () => {
        const conn = makeConnection(happyBatch);
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
