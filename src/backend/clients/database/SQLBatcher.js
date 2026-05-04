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

import { metrics } from '@opentelemetry/api';

const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 5_000;
const FALLBACK_RETRY_CONCURRENCY = 8;

const meter = metrics.getMeter('puter-backend');
const enqueueDroppedCounter = meter.createCounter(
    'sql_batcher.enqueue.dropped',
    {
        description:
            'Items dropped from SQLBatcher queue at the high-water mark',
    },
);
const enqueueRejectedCounter = meter.createCounter(
    'sql_batcher.enqueue.rejected',
    { description: 'Items rejected because the SQLBatcher circuit is open' },
);
const flushFailureCounter = meter.createCounter('sql_batcher.flush.failed', {
    description: 'SQLBatcher flush attempts that threw',
});
const fallbackInvocationsCounter = meter.createCounter(
    'sql_batcher.fallback.invocations',
    {
        description:
            'Times SQLBatcher fell back to per-item retry after a batch error',
    },
);
const fallbackItemFailuresCounter = meter.createCounter(
    'sql_batcher.fallback.item_failures',
    {
        description:
            'Per-item failures observed during SQLBatcher per-item retry',
    },
);

export class SQLBatcher {
    dbPool;
    maxTimeInQueue;
    maxBatchSize;
    maxQueueSize;
    failureThreshold;
    cooldownMs;
    queue = [];
    timeouts = [];
    #consecutiveFailures = 0;
    #lastFailureAt = 0;

    constructor(
        dbPool,
        maxTimeInQueue = 20,
        maxBatchSize = 50,
        maxQueueSize = DEFAULT_MAX_QUEUE_SIZE,
        failureThreshold = DEFAULT_FAILURE_THRESHOLD,
        cooldownMs = DEFAULT_COOLDOWN_MS,
    ) {
        this.dbPool = dbPool;
        this.maxTimeInQueue = maxTimeInQueue;
        this.maxBatchSize = maxBatchSize;
        this.maxQueueSize = maxQueueSize;
        this.failureThreshold = failureThreshold;
        this.cooldownMs = cooldownMs;
    }

    async execute(sql, values) {
        return this.query(sql, values);
    }

    promise() {
        return this;
    }

    #createPublicBatchError() {
        const error = new Error('Database operation failed');
        error.code = 'dbBatchFailed';
        return error;
    }

    // Open while we've seen `failureThreshold` consecutive flush failures and
    // the cooldown window since the most recent failure hasn't elapsed. After
    // cooldown a probe request is allowed through; success resets the counter.
    #isBreakerOpen() {
        if (this.#consecutiveFailures < this.failureThreshold) return false;
        return Date.now() - this.#lastFailureAt < this.cooldownMs;
    }

    async query(sql, values) {
        if (this.#isBreakerOpen()) {
            enqueueRejectedCounter.add(1);
            throw this.#createPublicBatchError();
        }

        const { promise, resolve, reject } = Promise.withResolvers();

        // Drop-oldest at the high-water mark. Bounds memory while preferring
        // to flush the most recent work — older queued entries are likeliest
        // to have already exceeded any caller-side timeout anyway.
        while (this.queue.length >= this.maxQueueSize) {
            const dropped = this.queue.shift();
            dropped.reject(this.#createPublicBatchError());
            enqueueDroppedCounter.add(1);
        }

        this.queue.push({
            sql,
            values,
            resolve,
            reject,
            timestamp: Date.now(),
        });

        if (this.queue.length >= this.maxBatchSize) {
            this.flush(this.queue.splice(0, this.maxBatchSize));
        } else if (this.queue.length === 1) {
            this.timeouts.push(
                setTimeout(() => {
                    this.flush(this.queue.splice(0, this.queue.length));
                }, this.maxTimeInQueue),
            );
        }

        return promise;
    }

    async flush(batch) {
        const timeout = this.timeouts.shift();
        if (timeout && !timeout._destroyed) {
            clearTimeout(timeout);
        }
        if (batch.length === 0) return;

        const query = `${batch.map((b) => b.sql.replace(/;+\s*$/, '')).join(';')}; SELECT 1`; // SELECT 1 forces mysql2 to return array
        const values = batch.map((b) => b.values ?? []).flat();

        let connection;
        try {
            connection = await this.dbPool.promise().getConnection();
        } catch (error) {
            this.#consecutiveFailures++;
            this.#lastFailureAt = Date.now();
            flushFailureCounter.add(1);
            console.warn(
                'SQLBatcher could not acquire connection for flush:',
                error,
            );
            for (const b of batch) {
                b.reject(this.#createPublicBatchError());
            }
            return;
        }

        // Run the coalesced multi-statement inside an explicit transaction so
        // a single bad statement (e.g. a duplicate-key INSERT) rolls back the
        // whole batch atomically, leaving us free to re-run each item
        // individually below. Without this, MySQL would commit every
        // statement up to the failure point and a per-item retry would
        // misreport already-committed inserts as duplicate-key failures.
        let batchSucceeded = false;
        try {
            await connection.beginTransaction();
            const [results, fields] = await connection.query(query, values);
            await connection.commit();
            batchSucceeded = true;
            this.#consecutiveFailures = 0;
            for (let i = 0; i < batch.length; i++) {
                const b = batch[i];
                b.resolve([results[i], fields?.[i]]);
            }
        } catch (batchError) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.warn('SQLBatcher rollback failed:', rollbackError);
            }
            console.warn(
                'SQLBatcher batch failed; retrying items individually:',
                batchError,
            );
        } finally {
            connection.release();
        }

        if (batchSucceeded) return;

        // Per-item fallback. The transaction was rolled back so no statement
        // committed; re-running each item independently produces clean
        // success/failure outcomes for each caller. Concurrency is capped to
        // avoid briefly saturating the pool when a large batch fails.
        flushFailureCounter.add(1);
        fallbackInvocationsCounter.add(1);

        const settled = new Array(batch.length);
        let cursor = 0;
        const workers = Array.from(
            { length: Math.min(FALLBACK_RETRY_CONCURRENCY, batch.length) },
            async () => {
                while (cursor < batch.length) {
                    const i = cursor++;
                    const b = batch[i];
                    try {
                        settled[i] = {
                            ok: true,
                            value: await this.dbPool
                                .promise()
                                .query(b.sql, b.values ?? []),
                        };
                    } catch (error) {
                        settled[i] = { ok: false, error };
                    }
                }
            },
        );
        await Promise.all(workers);

        let anySucceeded = false;
        let failureCount = 0;
        for (let i = 0; i < batch.length; i++) {
            const b = batch[i];
            const r = settled[i];
            if (r.ok) {
                anySucceeded = true;
                b.resolve(r.value);
            } else {
                failureCount++;
                b.reject(r.error);
            }
        }
        if (failureCount > 0) {
            fallbackItemFailuresCounter.add(failureCount);
        }

        // Only escalate the breaker when the database itself looks unhealthy
        // (no item got through). Row-level errors like duplicate-key are
        // application concerns, not DB outages, and shouldn't trip it.
        this.#lastFailureAt = Date.now();
        if (anySucceeded) {
            this.#consecutiveFailures = 0;
        } else {
            this.#consecutiveFailures++;
        }
    }
}
