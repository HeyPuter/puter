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

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { renderAnthropicError, renderOpenAIError } from './wireErrors.js';

const req = {} as Request;

const withRequestId = <T>(requestId: string, fn: () => T): T =>
    runWithContext({ requestId }, fn);

describe('renderAnthropicError', () => {
    it.each([
        [400, 'invalid_request_error'],
        [401, 'authentication_error'],
        [402, 'billing_error'],
        [403, 'permission_error'],
        [404, 'not_found_error'],
        [409, 'conflict_error'],
        [413, 'request_too_large'],
        [429, 'rate_limit_error'],
        [504, 'timeout_error'],
        [529, 'overloaded_error'],
    ])('maps status %s to error.type %s', (status, type) => {
        const r = renderAnthropicError(new HttpError(status, 'x'), req);
        expect(r.status).toBe(status);
        expect((r.body as { error: { type: string } }).error.type).toBe(type);
    });

    it('falls back to api_error for a status with no Anthropic analog', () => {
        const r = renderAnthropicError(new HttpError(502, 'bad gateway'), req);
        expect((r.body as { error: { type: string } }).error.type).toBe(
            'api_error',
        );
    });

    it('never serializes `fields` (attempts) into the body', () => {
        const err = new HttpError(503, 'AI provider out of credits', {
            legacyCode: 'upstream_credits_exhausted',
            fields: { attempts: [{ provider: 'claude', error: 'secret' }] },
        });
        const r = renderAnthropicError(err, req);
        expect(JSON.stringify(r.body)).not.toContain('attempts');
        expect(JSON.stringify(r.body)).not.toContain('secret');
    });

    it('sets request-id (no dashes) on both the body and the header', () => {
        const r = withRequestId('abc-123-def-456', () =>
            renderAnthropicError(new HttpError(400, 'x'), req),
        );
        expect((r.body as { request_id: string }).request_id).toBe(
            'req_abc123def456',
        );
        expect(r.headers?.['request-id']).toBe('req_abc123def456');
    });

    it('sets x-should-retry for 429/5xx and not for a plain 400', () => {
        const retryable = renderAnthropicError(new HttpError(429, 'x'), req);
        expect(retryable.headers?.['x-should-retry']).toBe('true');
        const notRetryable = renderAnthropicError(new HttpError(400, 'x'), req);
        expect(notRetryable.headers?.['x-should-retry']).toBe('false');
    });

    it('defaults retry-after to 5 on a 429 with none supplied', () => {
        const r = renderAnthropicError(new HttpError(429, 'x'), req);
        expect(r.headers?.['retry-after']).toBe(5);
    });

    it('surfaces an explicit retryAfter field over the 429 default', () => {
        const err = new HttpError(429, 'x', { fields: { retryAfter: 12 } });
        const r = renderAnthropicError(err, req);
        expect(r.headers?.['retry-after']).toBe(12);
    });

    it('unwraps our upstream_bad_request wrapper back to the upstream status', () => {
        const err = new HttpError(400, 'request too large upstream', {
            legacyCode: 'upstream_bad_request',
            code: 'request_too_large',
            fields: { upstreamStatus: 413 },
        });
        const r = renderAnthropicError(err, req);
        expect(r.status).toBe(413);
        expect((r.body as { error: { type: string } }).error.type).toBe(
            'request_too_large',
        );
    });

    it('does not unwrap an upstream 422 — stays our generic 400', () => {
        const err = new HttpError(400, 'x', {
            legacyCode: 'upstream_bad_request',
            fields: { upstreamStatus: 422 },
        });
        const r = renderAnthropicError(err, req);
        expect(r.status).toBe(400);
    });

    it('scrubs the message on an unexpected (non-HttpError) 500', () => {
        const r = renderAnthropicError(new Error('db password hunter2'), req);
        expect(r.status).toBe(500);
        expect(JSON.stringify(r.body)).not.toContain('hunter2');
    });

    it('keeps a curated 5xx HttpError message intact', () => {
        const err = new HttpError(500, 'AI provider authentication failed', {
            legacyCode: 'upstream_auth_failed',
        });
        const r = renderAnthropicError(err, req);
        expect((r.body as { error: { message: string } }).error.message).toBe(
            'AI provider authentication failed',
        );
    });

    it('restores an exhausted outage chain to 502 api_error, with x-should-retry', () => {
        const err = new HttpError(400, 'AI provider unavailable', {
            legacyCode: 'upstream_provider_unavailable',
            fields: { attempts: [] },
        });
        const r = renderAnthropicError(err, req);
        expect(r.status).toBe(502);
        expect((r.body as { error: { type: string } }).error.type).toBe(
            'api_error',
        );
        expect(r.headers?.['x-should-retry']).toBe('true');
    });

    it('restores an all-overloaded chain to 529 overloaded_error via upstreamStatus', () => {
        const err = new HttpError(400, 'AI provider overloaded', {
            legacyCode: 'upstream_provider_unavailable',
            fields: { attempts: [], upstreamStatus: 529 },
        });
        const r = renderAnthropicError(err, req);
        expect(r.status).toBe(529);
        expect((r.body as { error: { type: string } }).error.type).toBe(
            'overloaded_error',
        );
    });

    it('restores a mixed-failure chain to 502', () => {
        const err = new HttpError(400, 'All AI providers failed', {
            legacyCode: 'upstream_failed',
            fields: { attempts: [] },
        });
        const r = renderAnthropicError(err, req);
        expect(r.status).toBe(502);
    });
});

describe('renderOpenAIError', () => {
    it.each([
        [401, 'authentication_error'],
        [403, 'permission_error'],
        [404, 'not_found_error'],
        [429, 'rate_limit_error'],
    ])('maps status %s to error.type %s', (status, type) => {
        const r = renderOpenAIError(new HttpError(status, 'x'), req);
        expect((r.body as { error: { type: string } }).error.type).toBe(type);
    });

    it('maps every 5xx to server_error', () => {
        const r = renderOpenAIError(new HttpError(500, 'x'), req);
        expect((r.body as { error: { type: string } }).error.type).toBe(
            'server_error',
        );
    });

    it('falls back to invalid_request_error for an unmapped 4xx (e.g. 402)', () => {
        const err = new HttpError(402, 'no funds', {
            legacyCode: 'subscription_required',
        });
        const r = renderOpenAIError(err, req);
        expect(r.status).toBe(402);
        const body = r.body as {
            error: { type: string; code: string | null };
        };
        expect(body.error.type).toBe('invalid_request_error');
        expect(body.error.code).toBe('subscription_required');
    });

    it('carries the legacyCode through as error.code, param always null', () => {
        const r = renderOpenAIError(
            new HttpError(404, 'nope', { legacyCode: 'not_found' }),
            req,
        );
        const body = r.body as { error: { param: null; code: string } };
        expect(body.error.param).toBeNull();
        expect(body.error.code).toBe('not_found');
    });

    it('never serializes `fields` (attempts) into the body', () => {
        const err = new HttpError(502, 'All AI providers failed', {
            legacyCode: 'upstream_failed',
            fields: { attempts: [{ provider: 'openai', error: 'secret' }] },
        });
        const r = renderOpenAIError(err, req);
        expect(JSON.stringify(r.body)).not.toContain('attempts');
        expect(JSON.stringify(r.body)).not.toContain('secret');
    });

    it('scrubs the message on an unexpected (non-HttpError) 500', () => {
        const r = renderOpenAIError(new Error('db password hunter2'), req);
        expect(JSON.stringify(r.body)).not.toContain('hunter2');
    });

    it('leaves an exhausted outage chain at its flat 400, unlike the Anthropic route', () => {
        const err = new HttpError(400, 'AI provider unavailable', {
            legacyCode: 'upstream_provider_unavailable',
            fields: { attempts: [] },
        });
        const r = renderOpenAIError(err, req);
        expect(r.status).toBe(400);
    });
});
