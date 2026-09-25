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
import {
    CONTENT_FILTER_PATTERN,
    isTransientUpstreamError,
    sanitizeUpstreamMessage,
} from '../../util/upstreamErrors.js';

/** How long a provider's job may run before we stop waiting for it. */
export const VIDEO_POLL_WINDOW_MS = 10 * 60 * 1000;

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
): HttpError =>
    new HttpError(
        504,
        `Timed out waiting for ${providerLabel} video generation to complete`,
        {
            legacyCode: 'upstream_timeout',
            fields: { provider },
            ...(cause !== undefined ? { cause } : {}),
        },
    );

/** The caller hung up mid-job; nobody is left to bill or answer. */
export const clientAbortedError = (provider: string): HttpError =>
    new HttpError(400, 'Client disconnected before video generation finished', {
        legacyCode: 'client_aborted',
        fields: { provider },
    });

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

export interface PollOptions<T> {
    /** Goes into `fields.provider` on every error raised here. */
    provider: string;
    /** Human-readable name for the timeout message. */
    providerLabel: string;
    intervalMs: number;
    windowMs?: number;
    /** The state the create call already returned, if it returned one. */
    initial?: T;
    /** Fetches the current job state; receives the last state seen. */
    fetch: (previous: T | undefined) => Promise<T>;
    isPending: (job: T) => boolean;
}

/**
 * Polls a provider job until it settles. A transient poll failure is a missed
 * poll, not a failed job; a client disconnect ends the wait before anything is
 * metered; the window closes with a 504 that carries the last poll error.
 */
export const pollUntilSettled = async <T>(opts: PollOptions<T>): Promise<T> => {
    const windowMs = opts.windowMs ?? VIDEO_POLL_WINDOW_MS;
    const signal = Context.get('abortSignal');
    const start = Date.now();
    let job = opts.initial;
    let lastError: unknown;
    let firstFetch = job === undefined;

    for (;;) {
        if (job !== undefined && !opts.isPending(job)) return job;
        if (signal?.aborted) throw clientAbortedError(opts.provider);
        if (Date.now() - start > windowMs) {
            throw pollTimeoutError(
                opts.provider,
                opts.providerLabel,
                lastError,
            );
        }
        if (!firstFetch) {
            await abortableDelay(opts.intervalMs, signal);
            // The delay ends early on abort; do not spend a poll on it.
            if (signal?.aborted) throw clientAbortedError(opts.provider);
        }
        firstFetch = false;
        try {
            job = await opts.fetch(job);
            lastError = undefined;
        } catch (err) {
            if (!isTransientUpstreamError(err)) throw err;
            lastError = err;
        }
    }
};
