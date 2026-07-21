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
import {
    POOL_ACQUIRE_TIMEOUT,
    isNeverSentError,
    isRetriableError,
} from './retriableErrors.js';

const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 5_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const ACQUIRE_ATTEMPTS = 3;
const ITEM_RETRY_ATTEMPTS = 2;
const RETRY_BASE_BACKOFF_MS = 100;
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
const fallbackItemRetriesCounter = meter.createCounter(
    'sql_batcher.fallback.item_retries',
    {
        description:
            'Transient per-item failures retried during SQLBatcher fallback',
    },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SQLBatcher {
    dbPool;
    maxTimeInQueue;
    maxBatchSize;
    maxQueueSize;
    failureThreshold;
    cooldownMs;
    poolLabel;
    readOnly;
    acquireTimeoutMs;
    queue = [];
    timeouts = [];
    #consecutiveFailures = 0;
    #lastFailureAt = 0;
    #metricAttrs;

    /**
     * @param {object} dbPool mysql2 pool
     * @param {object} [opts]
     * @param {number} [opts.maxTimeInQueue] ms an item may wait before flush
     * @param {number} [opts.maxBatchSize] items coalesced per flush
     * @param {number} [opts.maxQueueSize] drop-oldest high-water mark
     * @param {number} [opts.failureThreshold] consecutive failures to open the breaker
     * @param {number} [opts.cooldownMs] breaker open duration after last failure
     * @param {'primary'|'replica'} [opts.poolLabel] role label on metrics; in
     *   single-node setups the 'replica' batcher shares the primary pool, so
     *   this reflects the read/write role rather than a physical instance
     * @param {boolean} [opts.readOnly] this batcher only ever carries SELECTs,
     *   so any transient failure is safe to retry
     * @param {number} [opts.acquireTimeoutMs] max wait for a pooled
     *   connection; 0 disables the bound
     */
    constructor(
        dbPool,
        {
            maxTimeInQueue = 20,
            maxBatchSize = 50,
            maxQueueSize = DEFAULT_MAX_QUEUE_SIZE,
            failureThreshold = DEFAULT_FAILURE_THRESHOLD,
            cooldownMs = DEFAULT_COOLDOWN_MS,
            poolLabel = 'primary',
            readOnly = false,
            acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
        } = {},
    ) {
        this.dbPool = dbPool;
        this.maxTimeInQueue = maxTimeInQueue;
        this.maxBatchSize = maxBatchSize;
        this.maxQueueSize = maxQueueSize;
        this.failureThreshold = failureThreshold;
        this.cooldownMs = cooldownMs;
        this.poolLabel = poolLabel;
        this.readOnly = readOnly;
        this.acquireTimeoutMs = acquireTimeoutMs;
        this.#metricAttrs = { pool: poolLabel };
    }

    async execute(sql, values) {
        return this.query(sql, values);
    }

    promise() {
        return this;
    }

    // The public error is deliberately opaque (no SQL, no internals), but
    // `reason` distinguishes the load-shed path for logs and callers:
    // breakerOpen | queueOverflow | connAcquire.
    #createPublicBatchError(reason) {
        const error = new Error('Database operation failed');
        error.code = 'dbBatchFailed';
        error.reason = reason;
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
            enqueueRejectedCounter.add(1, this.#metricAttrs);
            throw this.#createPublicBatchError('breakerOpen');
        }

        const { promise, resolve, reject } = Promise.withResolvers();

        // Drop-oldest at the high-water mark. Bounds memory while preferring
        // to flush the most recent work — older queued entries are likeliest
        // to have already exceeded any caller-side timeout anyway.
        while (this.queue.length >= this.maxQueueSize) {
            const dropped = this.queue.shift();
            dropped.reject(this.#createPublicBatchError('queueOverflow'));
            enqueueDroppedCounter.add(1, this.#metricAttrs);
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

    // Bounded wait for a pooled connection. Without a bound, a stalled
    // database turns every flush into an indefinite hang — nothing fails,
    // so neither the breaker nor callers' own timeouts ever engage.
    #getConnectionWithTimeout() {
        const acquire = this.dbPool.promise().getConnection();
        if (!this.acquireTimeoutMs) return acquire;

        return new Promise((resolve, reject) => {
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                // A connection that arrives late must go back to the pool.
                acquire.then(
                    (conn) => conn.release(),
                    () => {},
                );
                const error = new Error(
                    'Timed out acquiring database connection',
                );
                error.code = POOL_ACQUIRE_TIMEOUT;
                reject(error);
            }, this.acquireTimeoutMs);

            acquire.then(
                (conn) => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    resolve(conn);
                },
                (err) => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    reject(err);
                },
            );
        });
    }

    // Acquisition failures never sent a statement, so retrying is always
    // safe regardless of what the batch contains.
    async #acquireConnection() {
        let lastError;
        for (let attempt = 1; attempt <= ACQUIRE_ATTEMPTS; attempt++) {
            try {
                return await this.#getConnectionWithTimeout();
            } catch (error) {
                lastError = error;
                if (attempt < ACQUIRE_ATTEMPTS) {
                    await sleep(RETRY_BASE_BACKOFF_MS * attempt);
                }
            }
        }
        throw lastError;
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
            connection = await this.#acquireConnection();
        } catch (error) {
            this.#consecutiveFailures++;
            this.#lastFailureAt = Date.now();
            flushFailureCounter.add(1, this.#metricAttrs);
            console.warn(
                'SQLBatcher could not acquire connection for flush:',
                error,
            );
            for (const b of batch) {
                b.reject(this.#createPublicBatchError('connAcquire'));
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
        flushFailureCounter.add(1, this.#metricAttrs);
        fallbackInvocationsCounter.add(1, this.#metricAttrs);

        const settled = new Array(batch.length);
        let cursor = 0;
        const workers = Array.from(
            { length: Math.min(FALLBACK_RETRY_CONCURRENCY, batch.length) },
            async () => {
                while (cursor < batch.length) {
                    const i = cursor++;
                    settled[i] = await this.#runFallbackItem(batch[i]);
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
            fallbackItemFailuresCounter.add(failureCount, this.#metricAttrs);
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

    // Run one fallback item, retrying transient failures with backoff.
    // A read-only batcher may retry anything transient; a batcher that
    // carries writes only retries failures where the statement provably
    // never reached the server — a write that died mid-flight may have
    // committed, and re-running it would double-apply.
    async #runFallbackItem(b) {
        let attempt = 0;
        while (true) {
            let connection;
            try {
                connection = await this.#acquireConnection();
            } catch (error) {
                return { ok: false, error };
            }
            try {
                return {
                    ok: true,
                    value: await connection.query(b.sql, b.values ?? []),
                };
            } catch (error) {
                const canRetry = this.readOnly
                    ? isRetriableError(error)
                    : isNeverSentError(error);
                if (!canRetry || attempt >= ITEM_RETRY_ATTEMPTS) {
                    return { ok: false, error };
                }
                attempt++;
                fallbackItemRetriesCounter.add(1, this.#metricAttrs);
                await sleep(RETRY_BASE_BACKOFF_MS * attempt);
            } finally {
                connection.release();
            }
        }
    }
}
