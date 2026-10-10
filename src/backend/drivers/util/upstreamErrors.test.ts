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

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translateProviderError } from '../../controllers/drivers/DriverController.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    CONTENT_FILTER_PATTERN,
    CREDIT_EXHAUSTION_PATTERN,
    isCreditExhaustion,
    isTransientUpstreamError,
    isUpstreamTimeoutError,
    sanitizeUpstreamMessage,
    upstreamFetch,
    UpstreamResponseError,
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

describe('credit exhaustion detection', () => {
    it('matches provider credit and billing failures', () => {
        for (const { status, code, message } of [
            {
                status: 403,
                code: undefined,
                message:
                    'Your current credits have been used up and we are unable to process further requests. Please visit https://openrouter.ai/settings/credits to add credits.',
            },
            {
                status: 402,
                code: undefined,
                message:
                    'Insufficient credits. Add more using https://openrouter.ai/settings/credits',
            },
            {
                status: 429,
                code: undefined,
                message:
                    'Free model requires Team balance greater than $4.999999. (request id: 20260921210512505339070jYB)',
            },
            {
                status: 403,
                code: 'insufficient_user_quota',
                message: 'request rejected',
            },
            {
                status: 429,
                code: 'insufficient_quota',
                message: 'request rejected',
            },
        ]) {
            if (message !== 'request rejected') {
                expect(message).toMatch(CREDIT_EXHAUSTION_PATTERN);
            }
            expect(isCreditExhaustion(status, code, message)).toBe(true);
        }
    });

    it('does not mistake ordinary rate limits for exhausted credits', () => {
        for (const message of [
            'Rate limit exceeded',
            'Too many requests',
            'Quota exceeded for this key',
        ]) {
            expect(message).not.toMatch(CREDIT_EXHAUSTION_PATTERN);
            expect(isCreditExhaustion(429, undefined, message)).toBe(false);
        }
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

    it('accepts a longer bound for callers that never serialize the result to a client', () => {
        const out = sanitizeUpstreamMessage('x'.repeat(2000), 1000);
        expect(out.length).toBe(1000);
        expect(out.endsWith('...')).toBe(true);
    });

    it('redacts URLs and request identifiers', () => {
        expect(
            sanitizeUpstreamMessage(
                'Add credits at https://vendor.test/billing (request id: req-parenthesized) request_id: req_standalone',
            ),
        ).toBe('Add credits at');
    });
});

describe('upstreamFetch', () => {
    // A provider stand-in: `/status/<n>` answers with that status and the
    // request body echoed back as the response body; `/hang` never answers.
    let server: Server;
    let base: string;
    beforeAll(async () => {
        server = createServer((req, res) => {
            if (req.url === '/hang') return;
            const status = Number(req.url?.split('/')[2] ?? 200);
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(Buffer.concat(chunks));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });

    const fail = async (status: number, body: unknown): Promise<unknown> => {
        try {
            await upstreamFetch(
                'Vendor',
                `${base}/status/${status}`,
                {
                    method: 'POST',
                    body:
                        typeof body === 'string' ? body : JSON.stringify(body),
                },
                { timeoutMs: 5000 },
            );
        } catch (e) {
            return e;
        }
        throw new Error('expected upstreamFetch to reject');
    };

    it('returns a 2xx response untouched', async () => {
        const res = await upstreamFetch(
            'Vendor',
            `${base}/status/200`,
            { method: 'POST', body: '{"ok":true}' },
            { timeoutMs: 5000 },
        );
        expect(await res.json()).toEqual({ ok: true });
    });

    it.each([
        [
            { error: { message: 'openai-style', code: 'bad_voice' } },
            'openai-style',
            'bad_voice',
        ],
        [{ error: 'flat error', code: 'flat_code' }, 'flat error', 'flat_code'],
        [
            { detail: { message: 'nested detail', code: 'voice_not_found' } },
            'nested detail',
            'voice_not_found',
        ],
        [{ detail: 'string detail' }, 'string detail', undefined],
        [{ message: 'top-level message' }, 'top-level message', undefined],
        ['plain text body', 'plain text body', undefined],
        ['', 'Vendor request failed (status 422)', undefined],
    ])('reads the message and code out of %j', async (body, message, code) => {
        const err = await fail(422, body);
        expect(err).toBeInstanceOf(UpstreamResponseError);
        expect(err).toMatchObject({ status: 422, message, code });
    });

    it.each([
        [429, 429, 'upstream_rate_limited'],
        [401, 500, 'upstream_auth_failed'],
        [403, 500, 'upstream_auth_failed'],
        [402, 503, 'upstream_credits_exhausted'],
        [500, 400, 'upstream_provider_unavailable'],
        [422, 400, 'upstream_bad_request'],
    ])(
        'maps an upstream %i to %i %s at the driver boundary',
        async (upstreamStatus, statusCode, legacyCode) => {
            const err = await fail(upstreamStatus, {
                error: { message: 'nope', code: 'vendor_code' },
            });
            expect(translateProviderError(err)).toMatchObject({
                statusCode,
                legacyCode,
                fields: { upstreamStatus },
            });
        },
    );

    it('keeps raw provider text out of what the caller sees', async () => {
        const err = await fail(400, {
            detail: {
                message:
                    '<b>Invalid</b> voice, see https://vendor.test/docs (request id: abc)',
            },
        });
        expect(translateProviderError(err)).toMatchObject({
            statusCode: 400,
            message: 'Invalid voice, see',
        });
    });

    it('gives up after timeoutMs and surfaces as a 504 upstream_timeout', async () => {
        let err: unknown;
        try {
            await upstreamFetch(
                'Vendor',
                `${base}/hang`,
                {},
                { timeoutMs: 50 },
            );
        } catch (e) {
            err = e;
        }
        expect(isUpstreamTimeoutError(err)).toBe(true);
        expect(translateProviderError(err)).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
    });

    it('still honours a caller abort signal', async () => {
        const controller = new AbortController();
        const pending = upstreamFetch(
            'Vendor',
            `${base}/hang`,
            { signal: controller.signal },
            { timeoutMs: 5000 },
        );
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});
