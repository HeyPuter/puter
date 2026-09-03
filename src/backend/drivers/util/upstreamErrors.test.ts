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

import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import {
    CONTENT_FILTER_PATTERN,
    isTransientUpstreamError,
    isUpstreamTimeoutError,
    sanitizeUpstreamMessage,
} from './upstreamErrors.js';

const withStatus = (status: number) =>
    Object.assign(new Error(`status ${status}`), { status });

describe('isUpstreamTimeoutError', () => {
    it('recognises the Stainless SDK timeout class', () => {
        expect(isUpstreamTimeoutError(new APIConnectionTimeoutError())).toBe(
            true,
        );
    });

    it('recognises an undici timeout wrapped in a fetch failed TypeError', () => {
        const err = new TypeError('fetch failed', {
            cause: Object.assign(new Error('Headers Timeout Error'), {
                name: 'HeadersTimeoutError',
                code: 'UND_ERR_HEADERS_TIMEOUT',
            }),
        });
        expect(isUpstreamTimeoutError(err)).toBe(true);
    });

    it('recognises an AbortSignal.timeout rejection by name', () => {
        expect(isUpstreamTimeoutError({ name: 'TimeoutError' })).toBe(true);
    });

    it('ignores ordinary errors, non-objects, and status-bearing failures', () => {
        expect(isUpstreamTimeoutError(new Error('boom'))).toBe(false);
        expect(isUpstreamTimeoutError('timed out')).toBe(false);
        expect(isUpstreamTimeoutError(withStatus(504))).toBe(false);
    });
});

describe('isTransientUpstreamError', () => {
    it('treats timeouts and dropped connections as transient', () => {
        expect(isTransientUpstreamError(new APIConnectionTimeoutError())).toBe(
            true,
        );
        expect(
            isTransientUpstreamError(new APIConnectionError({ message: 'x' })),
        ).toBe(true);
        expect(
            isTransientUpstreamError(
                Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
            ),
        ).toBe(true);
    });

    it('treats 5xx, 408 and 429 statuses as transient, however they are carried', () => {
        expect(isTransientUpstreamError(withStatus(503))).toBe(true);
        expect(isTransientUpstreamError(withStatus(429))).toBe(true);
        expect(isTransientUpstreamError(withStatus(408))).toBe(true);
        expect(isTransientUpstreamError(new HttpError(502, 'x'))).toBe(true);
        expect(
            isTransientUpstreamError({ response: { status: 500 } }),
        ).toBe(true);
    });

    it('does not treat other 4xx responses or plain errors as transient', () => {
        expect(isTransientUpstreamError(withStatus(404))).toBe(false);
        expect(isTransientUpstreamError(withStatus(400))).toBe(false);
        expect(isTransientUpstreamError(new HttpError(400, 'x'))).toBe(false);
        expect(isTransientUpstreamError(new Error('boom'))).toBe(false);
    });
});

describe('CONTENT_FILTER_PATTERN', () => {
    it('matches the wording providers use for refusals', () => {
        for (const text of [
            'Error generating image: NSFW content detected.',
            'OutputVideoSensitiveContentDetected',
            'content policy violation',
            'blocked by our safety filters',
            'The input or output was flagged as sensitive. (E005)',
        ]) {
            expect(text).toMatch(CONTENT_FILTER_PATTERN);
        }
    });

    it('does not match ordinary failures', () => {
        expect('q_descale must have shape (batch_size, num_heads_k)').not.toMatch(
            CONTENT_FILTER_PATTERN,
        );
        expect('internal server issue').not.toMatch(CONTENT_FILTER_PATTERN);
    });
});

describe('sanitizeUpstreamMessage', () => {
    it('strips markup and collapses whitespace', () => {
        expect(
            sanitizeUpstreamMessage(
                '<html><style>body{color:red}</style><h1>Bad</h1>\n<p>gateway</p></html>',
            ),
        ).toBe('Bad gateway');
    });

    it('bounds the length', () => {
        const out = sanitizeUpstreamMessage('x'.repeat(1000));
        expect(out.length).toBe(300);
        expect(out.endsWith('...')).toBe(true);
    });
});
