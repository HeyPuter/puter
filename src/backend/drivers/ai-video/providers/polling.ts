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

import { Context } from '../../../core/context.js';
import { HttpError } from '../../../core/http/HttpError.js';
import type { CreditHold } from '../../../services/metering/types.js';
import {
    CONTENT_FILTER_PATTERN,
    isTransientUpstreamError,
    sanitizeUpstreamMessage,
    upstreamErrorStatus,
} from '../../util/upstreamErrors.js';

/**
 * How long a provider's job may run before we stop waiting for it. Kept under
 * the SDK's 15-minute idle timeout so the answer reaches the caller.
 */
export const VIDEO_POLL_WINDOW_MS = 14 * 60 * 1000;

/** A job's credit hold covers the poll window plus the create call. */
export const VIDEO_HOLD_TTL_MS = VIDEO_POLL_WINDOW_MS + 5 * 60 * 1000;

/**
 * How long a job that outlived the window is still followed after the caller
 * got its 504. One still pending after this is charged its estimate.
 */
export const LATE_JOB_WINDOW_MS = 60 * 60 * 1000;
const LATE_HOLD_RENEW_MS = 5 * 60 * 1000;

// Provider wording for input the model does not accept, including Together's
// camelCase codes (`invalidDuration`, `missingFrameImagesForImageToVideoModel`).
const INVALID_INPUT_PATTERN =
    /\b(unsupported|invalid|missing)\w*|not supported|required parameter/i;

/**
 * The upstream job outlived the wait window. That is the provider's pace, not a
 * fault of ours, so it leaves as a 504 tagged `upstream_timeout`, which the
 * alarm gate skips.
 */
export const pollTimeoutError = (
    provider: string,
    providerLabel: string,
    cause?: unknown,
    noun: 'video' | 'image' = 'video',
): HttpError =>
    new HttpError(
        504,
        `Timed out waiting for ${providerLabel} ${noun} generation to complete`,
        {
            legacyCode: 'upstream_timeout',
            fields: { provider },
            ...(cause !== undefined ? { cause } : {}),
        },
    );

/**
 * Classifies a job the provider reports as failed. A content-filter refusal is
 * the caller's to act on; a rejected parameter is theirs to fix; anything else
 * failed on the provider's side.
 */
export const videoJobFailure = (
    provider: string,
    message: string,
    code?: string,
): HttpError => {
    const detail =
        sanitizeUpstreamMessage(message) || 'Video generation failed';
    const haystack = `${code ?? ''} ${detail}`;
    const fields = { provider, upstreamCode: code };
    if (CONTENT_FILTER_PATTERN.test(haystack)) {
        return new HttpError(400, detail, {
            legacyCode: 'bad_request',
            code: 'moderation_flagged',
            fields,
        });
    }
    if (INVALID_INPUT_PATTERN.test(haystack)) {
        return new HttpError(400, detail, {
            legacyCode: 'upstream_bad_request',
            fields,
        });
    }
    return new HttpError(502, detail, {
        legacyCode: 'upstream_failed',
        fields,
    });
};

/** Resolves after `ms`, or as soon as `signal` aborts. */
export const abortableDelay = (
    ms: number,
    signal?: AbortSignal,
): Promise<void> =>
    new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener('abort', done, { once: true });
    });

/**
 * A job's credit hold. Released when the request ends, unless a job that
 * outlived the window took it over; that job releases it once it settles.
 */
export class JobHold {
    #hold: CreditHold;
    #taken = false;

    constructor(hold: CreditHold) {
        this.#hold = hold;
    }

    async release(): Promise<void> {
        if (!this.#taken) await this.#hold.release();
    }

    take(): CreditHold {
        this.#taken = true;
        return this.#hold;
    }
}

export interface PollOptions<T> {
    /** Goes into `fields.provider` on every error raised here. */
    provider: string;
    /** Human-readable name for the timeout message. */
    providerLabel: string;
    noun?: 'video' | 'image';
    intervalMs: number;
    windowMs?: number;
    /** The state the create call already returned, if it returned one. */
    initial?: T;
    /** Fetches the current job state; receives the last state seen. */
    fetch: (previous: T | undefined) => Promise<T>;
    isPending: (job: T) => boolean;
    /**
     * Records what the job cost once it settles, failed or not: the provider
     * bills what it bills. `settled` is false for a job given up on while still
     * pending, which is charged as the provider would charge a finished one.
     */
    meter: (job: T | undefined, settled: boolean) => Promise<unknown>;
    /** Kept past the window for a job still running, until it settles. */
    hold: JobHold;
}

/**
 * Polls a provider job until it settles, then meters it. A transient poll
 * failure is a missed poll, not a failed job. A client disconnect doesn't stop
 * it: the provider bills the job either way. When the window closes the caller
 * gets a 504 carrying the last poll error, and the job is followed in the
 * background, holding its credit and concurrency slot, until it settles.
 */
export const pollUntilSettled = async <T>(opts: PollOptions<T>): Promise<T> => {
    const windowMs = opts.windowMs ?? VIDEO_POLL_WINDOW_MS;
    const start = Date.now();
    let job = opts.initial;
    let lastError: unknown;
    let firstFetch = job === undefined;

    for (;;) {
        if (job !== undefined && !opts.isPending(job)) {
            await opts.meter(job, true);
            return job;
        }
        if (Date.now() - start > windowMs) {
            const late = followLateJob(opts, job, opts.hold.take());
            Context.get('keepDriverSlot')?.(late);
            throw pollTimeoutError(
                opts.provider,
                opts.providerLabel,
                lastError,
                opts.noun,
            );
        }
        if (!firstFetch) await abortableDelay(opts.intervalMs);
        firstFetch = false;
        try {
            job = await opts.fetch(job);
            lastError = undefined;
        } catch (err) {
            if (isTransientUpstreamError(err)) {
                lastError = err;
                continue;
            }
            if (!isJobVerdict(err)) {
                // Lost track of a job the provider still runs: charged as
                // one that never settled, the same as after the window.
                try {
                    await opts.meter(job, false);
                } catch (meterErr) {
                    console.error(
                        `[${opts.provider}] metering a lost job failed:`,
                        meterErr,
                    );
                }
            }
            throw err;
        }
    }
};

/**
 * A poll rejected as a client error is the provider's verdict on the job (a
 * content filter, a rejected input). Auth and not-found errors, and errors with
 * no status, mean we lost track of a job the provider still runs.
 */
const isJobVerdict = (err: unknown): boolean => {
    const status = upstreamErrorStatus(err);
    return (
        status !== undefined &&
        status >= 400 &&
        status < 500 &&
        ![401, 403, 404].includes(status)
    );
};

/** Polls a job past its window and meters it once it settles or is given up. */
const followLateJob = async <T>(
    opts: PollOptions<T>,
    initial: T | undefined,
    hold: CreditHold,
): Promise<void> => {
    const extend = async () => {
        try {
            await hold.extend?.();
        } catch {
            // The next tick retries.
        }
    };
    // The hold is near the end of its TTL by now.
    void extend();
    const renew = setInterval(extend, LATE_HOLD_RENEW_MS);
    renew.unref?.();
    let job = initial;
    try {
        const deadline = Date.now() + LATE_JOB_WINDOW_MS;
        while (job === undefined || opts.isPending(job)) {
            if (Date.now() > deadline) break;
            await abortableDelay(opts.intervalMs);
            try {
                job = await opts.fetch(job);
            } catch (err) {
                if (isTransientUpstreamError(err)) continue;
                // A refusal is a failure the provider doesn't bill.
                if (isJobVerdict(err)) return;
                break;
            }
        }
        await opts.meter(job, job !== undefined && !opts.isPending(job));
    } catch (err) {
        console.error(
            `[${opts.provider}] metering a job that outlived its window failed:`,
            err,
        );
    } finally {
        clearInterval(renew);
        try {
            await hold.release();
        } catch {
            // Left to its TTL.
        }
    }
};
