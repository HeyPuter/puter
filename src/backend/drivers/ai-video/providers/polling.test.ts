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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context, runWithContext } from '../../../core/context.js';
import { HttpError } from '../../../core/http/HttpError.js';
import {
    VIDEO_POLL_WINDOW_MS,
    abortableDelay,
    clientAbortedError,
    pollTimeoutError,
    pollUntilSettled,
    videoJobFailure,
} from './polling.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('pollTimeoutError', () => {
    it('builds a 504 upstream_timeout that names the provider and keeps the cause', () => {
        const cause = new Error('last poll failed');
        const err = pollTimeoutError('together', 'Together AI', cause);
        expect(err).toBeInstanceOf(HttpError);
        expect(err).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
            message:
                'Timed out waiting for Together AI video generation to complete',
            fields: { provider: 'together' },
            cause,
        });
    });
});

describe('clientAbortedError', () => {
    it('builds a 400 client_aborted that names the provider', () => {
        expect(clientAbortedError('gemini')).toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
            fields: { provider: 'gemini' },
        });
    });
});

describe('videoJobFailure', () => {
    it('maps content-filter wording to 400 moderation_flagged', () => {
        expect(
            videoJobFailure('together', 'content policy violation'),
        ).toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            code: 'moderation_flagged',
            message: 'content policy violation',
            fields: { provider: 'together' },
        });
    });

    it('reads the filter from the code when the message does not say', () => {
        expect(
            videoJobFailure(
                'byteplus',
                'blocked',
                'OutputVideoSensitiveContentDetected',
            ),
        ).toMatchObject({
            statusCode: 400,
            code: 'moderation_flagged',
            fields: {
                provider: 'byteplus',
                upstreamCode: 'OutputVideoSensitiveContentDetected',
            },
        });
    });

    it('maps a rejected parameter to 400 upstream_bad_request', () => {
        expect(
            videoJobFailure(
                'together',
                'fps is not supported by this model',
                'unsupportedParameter',
            ),
        ).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
    });

    it('reads Together-style camelCase input codes as rejections', () => {
        for (const [code, message] of [
            ['invalidDuration', "Invalid value for 'seconds' parameter."],
            [
                'missingFrameImagesForImageToVideoModel',
                'Missing required parameter for Kling 2.1 Standard image-to-video model',
            ],
        ]) {
            expect(videoJobFailure('together', message, code)).toMatchObject({
                statusCode: 400,
                legacyCode: 'upstream_bad_request',
                fields: { upstreamCode: code },
            });
        }
    });

    it('maps anything else to 502 upstream_failed and strips markup', () => {
        const err = videoJobFailure(
            'gemini',
            '<html><body><h1>Bad gateway</h1></body></html>',
        );
        expect(err).toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
            message: 'Bad gateway',
        });
    });

    it('falls back to a generic message when the provider sent none', () => {
        expect(videoJobFailure('gemini', '').message).toBe(
            'Video generation failed',
        );
    });
});

describe('abortableDelay', () => {
    it('resolves early when the signal aborts', async () => {
        vi.useFakeTimers();
        const abort = new AbortController();
        const delay = abortableDelay(60_000, abort.signal);
        abort.abort();
        await expect(delay).resolves.toBeUndefined();
    });

    it('resolves after the delay otherwise', async () => {
        vi.useFakeTimers();
        let done = false;
        void abortableDelay(1_000).then(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(999);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });
});

describe('pollUntilSettled', () => {
    type Job = { status: 'pending' | 'done' };
    const pending: Job = { status: 'pending' };
    const done: Job = { status: 'done' };

    const poll = (
        fetch: (previous: Job | undefined) => Promise<Job>,
        extra: { initial?: Job; windowMs?: number } = {},
    ) =>
        runWithContext({}, () =>
            pollUntilSettled<Job>({
                provider: 'together',
                providerLabel: 'Together AI',
                intervalMs: 5_000,
                fetch,
                isPending: (job) => job.status === 'pending',
                ...extra,
            }),
        );

    it('fetches immediately, then on the interval, until the job settles', async () => {
        vi.useFakeTimers();
        const fetch = vi
            .fn<(p: Job | undefined) => Promise<Job>>()
            .mockResolvedValueOnce(pending)
            .mockResolvedValueOnce(pending)
            .mockResolvedValueOnce(done);

        const result = poll(fetch);
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(await result).toBe(done);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('waits one interval before re-fetching a pending initial state', async () => {
        vi.useFakeTimers();
        const fetch = vi
            .fn<(p: Job | undefined) => Promise<Job>>()
            .mockResolvedValueOnce(done);

        const result = poll(fetch, { initial: pending });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5_000);

        expect(await result).toBe(done);
        expect(fetch).toHaveBeenCalledWith(pending);
    });

    it('treats a transient poll failure as a missed poll', async () => {
        vi.useFakeTimers();
        const fetch = vi
            .fn<(p: Job | undefined) => Promise<Job>>()
            .mockRejectedValueOnce(
                Object.assign(new Error('bad gateway'), { status: 502 }),
            )
            .mockResolvedValueOnce(done);

        const result = poll(fetch);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(await result).toBe(done);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('rethrows a poll failure that is the provider\'s verdict', async () => {
        const notFound = Object.assign(new Error('no such job'), {
            status: 404,
        });
        await expect(poll(() => Promise.reject(notFound))).rejects.toBe(
            notFound,
        );
    });

    it('gives up after the window with a 504 carrying the last poll error', async () => {
        vi.useFakeTimers();
        const flaky = Object.assign(new Error('still down'), { status: 503 });
        const fetch = vi
            .fn<(p: Job | undefined) => Promise<Job>>()
            .mockRejectedValue(flaky);

        const rejection = poll(fetch).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(VIDEO_POLL_WINDOW_MS + 5_000);

        expect(await rejection).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
            cause: flaky,
        });
    });

    it('honours a shorter window when one is given', async () => {
        vi.useFakeTimers();
        const rejection = poll(() => Promise.resolve(pending), {
            windowMs: 20_000,
        }).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(25_000);

        expect(await rejection).toMatchObject({ statusCode: 504 });
    });

    it('stops as soon as the request context signals a client abort', async () => {
        vi.useFakeTimers();
        const abort = new AbortController();
        const fetch = vi
            .fn<(p: Job | undefined) => Promise<Job>>()
            .mockResolvedValue(pending);

        const rejection = runWithContext({}, () => {
            Context.set('abortSignal', abort.signal);
            return pollUntilSettled<Job>({
                provider: 'gemini',
                providerLabel: 'Gemini',
                intervalMs: 10_000,
                fetch,
                isPending: (job) => job.status === 'pending',
            });
        }).catch((e: unknown) => e);

        await vi.advanceTimersByTimeAsync(10_000);
        abort.abort();
        await vi.advanceTimersByTimeAsync(0);

        expect(await rejection).toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
            fields: { provider: 'gemini' },
        });
        // The abort cut the second wait short; no third poll went out.
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
