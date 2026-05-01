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

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError, isHttpError } from '../HttpError';

interface ErrorHandlerOptions {
    /**
     * Optional logger for non-HttpError failures. Receives `(err, req)`.
     * Defaults to `console.error` with the request method/url.
     */
    onUnhandled?: (err: unknown, req: Parameters<RequestHandler>[0]) => void;
    /**
     * Optional hook fired for every error caught (HttpError and otherwise).
     * Use for alarm wiring (e.g., page on 500s) without coupling the
     * middleware to a specific service.
     */
    onError?: (err: unknown, req: Parameters<RequestHandler>[0]) => void;
}

/**
 * Terminal express error middleware. Install last, after all routes and
 * controllers have been registered.
 *
 * Express 5 forwards thrown errors (sync and async) here automatically, so
 * controllers and gate middlewares can simply `throw new HttpError(...)`.
 *
 * Response shape is kept for wire-compat with existing clients:
 * ```json
 * {
 *   "error": "<message>",
 *   "message": "<message>",
 *   "code": "<legacyCode || code>",
 *   "errorCode": "<code, only when both legacyCode and code are set>",
 *   ...fields
 * }
 * ```
 *
 * `message` is a duplicate of `error` kept for the legacy GUI, which keys on
 * `errorJson.message` when parsing auth-window AJAX error responses.
 *
 * Non-HttpError failures (programming bugs, unexpected exceptions) become
 * a generic 500 response — no internal details leak. The full error is
 * passed to `onUnhandled` for logging/alerting.
 */
export const createErrorHandler = (
    opts: ErrorHandlerOptions = {},
): ErrorRequestHandler => {
    const onUnhandled =
        opts.onUnhandled ??
        ((err, req) => {
            console.error(
                `[v2] unhandled error on ${req.method} ${req.url}:`,
                err,
            );
        });

    return (err, req, res, next): void => {
        // If the response already started streaming, we can't send a JSON
        // error. Defer to express's default handler to abort the connection.
        if (res.headersSent) {
            opts.onError?.(err, req);
            next(err);
            return;
        }

        if (isHttpError(err)) {
            opts.onError?.(err, req);
            res.status(err.statusCode).json(serializeHttpError(err));
            return;
        }

        // Anything else is treated as an unexpected 500. We never serialize
        // it back to the client to avoid leaking stack traces, internal
        // error messages, etc.
        opts.onError?.(err, req);
        onUnhandled(err, req);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Internal Server Error',
            code: 'internal_error',
        });
    };
};

const serializeHttpError = (err: HttpError): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
        error: err.message,
        message: err.message,
    };

    // `code` slot precedence: legacyCode wins for back-compat. If both are
    // set, the modern code goes to `errorCode` so clients that key on either
    // field find what they expect.
    if (err.legacyCode) {
        payload.code = err.legacyCode;
        if (err.code) payload.errorCode = err.code;
    } else if (err.code) {
        payload.code = err.code;
    }

    if (err.fields) {
        for (const [k, v] of Object.entries(err.fields)) {
            // Don't let `fields` clobber the canonical slots.
            if (
                k === 'error' ||
                k === 'message' ||
                k === 'code' ||
                k === 'errorCode'
            )
                continue;
            payload[k] = v;
        }
    }

    return payload;
};
