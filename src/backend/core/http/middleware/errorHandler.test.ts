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

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../HttpError';
import { createErrorHandler } from './errorHandler';

// ── Tiny harness ────────────────────────────────────────────────────
//
// The error handler writes a JSON status response; we capture status,
// headers, and the body it would emit.

interface CapturedResponse {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string | number | boolean>;
    headersSent: boolean;
}

const makeRes = (headersSent = false): { res: Response; out: CapturedResponse } => {
    const out: CapturedResponse = { headers: {}, headersSent };
    const res = {
        headersSent,
        status(code: number) {
            out.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            out.body = payload;
            return this;
        },
        setHeader(name: string, value: string | number | boolean) {
            out.headers[name] = value;
            return this;
        },
    } as unknown as Response;
    return { res, out };
};

const makeReq = (
    init: Partial<Request> = {},
): Request =>
    ({
        method: init.method ?? 'GET',
        url: init.url ?? '/x',
        ...init,
    }) as unknown as Request;

const runHandler = (
    handler: ReturnType<typeof createErrorHandler>,
    err: unknown,
    init?: { headersSent?: boolean; req?: Partial<Request> },
) => {
    const { res, out } = makeRes(init?.headersSent ?? false);
    const next = vi.fn();
    handler(err, makeReq(init?.req), res, next);
    return { out, next };
};

// ── HttpError serialization ─────────────────────────────────────────

describe('createErrorHandler — HttpError responses', () => {
    it('serializes message + legacyCode into the standard wire shape', () => {
        const handler = createErrorHandler();
        const err = new HttpError(404, 'Not Found', { legacyCode: 'not_found' });
        const { out } = runHandler(handler, err);
        expect(out.statusCode).toBe(404);
        // Both `error` and `message` are emitted; the legacy GUI keys on
        // `message`, modern clients on `error`.
        expect(out.body).toEqual({
            error: 'Not Found',
            message: 'Not Found',
            code: 'not_found',
        });
    });

    it('emits only the modern `code` when no legacyCode is set', () => {
        const handler = createErrorHandler();
        const err = new HttpError(409, 'Conflict', { code: 'conflict_modern' });
        const { out } = runHandler(handler, err);
        expect(out.body).toEqual({
            error: 'Conflict',
            message: 'Conflict',
            code: 'conflict_modern',
        });
    });

    it('puts modern code under `errorCode` when both legacyCode and code are set', () => {
        const handler = createErrorHandler();
        const err = new HttpError(409, 'Conflict', {
            legacyCode: 'forbidden',
            code: 'conflict_modern',
        });
        const { out } = runHandler(handler, err);
        // Legacy clients keep finding `code`; modern clients still find
        // their code under `errorCode`. This dual emission is intentional.
        expect(out.body).toEqual({
            error: 'Conflict',
            message: 'Conflict',
            code: 'forbidden',
            errorCode: 'conflict_modern',
        });
    });

    it('merges `fields` into the body but never lets them clobber canonical slots', () => {
        const handler = createErrorHandler();
        const err = new HttpError(400, 'Bad', {
            legacyCode: 'bad_request',
            fields: {
                target: 'foo',
                // These four must NOT overwrite the serializer's keys:
                error: 'INJECTED',
                message: 'INJECTED',
                code: 'INJECTED',
                errorCode: 'INJECTED',
            },
        });
        const { out } = runHandler(handler, err);
        expect(out.body).toEqual({
            error: 'Bad',
            message: 'Bad',
            code: 'bad_request',
            target: 'foo',
        });
    });

    it('sets X-Needs-Upgrade for 402 and 413 — and only those', () => {
        const handler = createErrorHandler();
        for (const code of [402, 413]) {
            const { out } = runHandler(
                handler,
                new HttpError(code, 'Upgrade'),
            );
            expect(out.headers['X-Needs-Upgrade']).toBe(true);
        }
        const { out: out500 } = runHandler(
            handler,
            new HttpError(500, 'boom'),
        );
        expect(out500.headers['X-Needs-Upgrade']).toBeUndefined();
    });
});

// ── Non-HttpError handling ──────────────────────────────────────────

describe('createErrorHandler — unexpected (non-HttpError) failures', () => {
    it('returns a generic 500 — never leaks stack traces or messages', () => {
        // Suppress the default console.error logger for this test.
        const handler = createErrorHandler({ onUnhandled: () => {} });
        const err = new Error('database password is hunter2');
        const { out } = runHandler(handler, err);
        expect(out.statusCode).toBe(500);
        expect(out.body).toEqual({
            error: 'Internal Server Error',
            message: 'Internal Server Error',
            code: 'internal_error',
        });
        // The raw message must not appear anywhere in the response body.
        expect(JSON.stringify(out.body)).not.toContain('hunter2');
    });

    it('calls onUnhandled with the raw error and request for logging', () => {
        const onUnhandled = vi.fn();
        const handler = createErrorHandler({ onUnhandled });
        const err = new Error('boom');
        runHandler(handler, err, { req: { method: 'POST', url: '/x' } });
        expect(onUnhandled).toHaveBeenCalledTimes(1);
        const [gotErr, gotReq] = onUnhandled.mock.calls[0];
        expect(gotErr).toBe(err);
        expect(gotReq.method).toBe('POST');
    });

    it('does NOT call onUnhandled for HttpError — only onError fires', () => {
        const onUnhandled = vi.fn();
        const onError = vi.fn();
        const handler = createErrorHandler({ onUnhandled, onError });
        runHandler(handler, new HttpError(404, 'Not Found'));
        expect(onUnhandled).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('fires onError for both HttpError AND non-HttpError failures', () => {
        const onError = vi.fn();
        const handler = createErrorHandler({
            onUnhandled: () => {},
            onError,
        });
        runHandler(handler, new HttpError(404, 'a'));
        runHandler(handler, new Error('b'));
        expect(onError).toHaveBeenCalledTimes(2);
    });
});

// ── Mid-stream errors ───────────────────────────────────────────────

describe('createErrorHandler — when the response has already started streaming', () => {
    it('delegates to express default and never tries to write JSON', () => {
        const handler = createErrorHandler({ onUnhandled: () => {} });
        const err = new HttpError(500, 'boom');
        const { out, next } = runHandler(handler, err, {
            headersSent: true,
        });
        // We never wrote a body — express will abort the connection.
        expect(out.body).toBeUndefined();
        expect(out.statusCode).toBeUndefined();
        // The error is forwarded to express's default error handler.
        expect(next).toHaveBeenCalledWith(err);
    });

    it('still fires onError when headers were already sent (for alerting)', () => {
        const onError = vi.fn();
        const handler = createErrorHandler({ onError });
        const err = new Error('boom');
        runHandler(handler, err, { headersSent: true });
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
