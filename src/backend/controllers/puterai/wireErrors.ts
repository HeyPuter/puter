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

/**
 * Vendor-compatible error envelopes for the Anthropic and OpenAI-compatible
 * wire routes, used as `RouteOptions.errorRenderer`. These replace the default
 * Puter `{error, message, code, ...fields}` shape for every error that reaches
 * those routes — including gate failures (auth, plan, rate limit) — with the
 * envelope the vendor's own client library expects.
 *
 * `fields` (and so `attempts`, with provider names and raw upstream text) is
 * never serialized here: the alarm gate still sees it through `onError`, which
 * runs before the renderer.
 */

import type { Request } from 'express';
import { Context } from '../../core/context.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import type { ErrorRenderer } from '../../core/http/types.js';

const RETRYABLE_STATUSES = new Set([408, 409, 429]);
const isRetryableStatus = (status: number): boolean =>
    RETRYABLE_STATUSES.has(status) || status >= 500;

/**
 * `req_<requestId, no dashes>` — used on every Anthropic-route response,
 * success or error.
 */
export const anthropicRequestId = (): string =>
    `req_${(Context.get('requestId') ?? '').replaceAll('-', '')}`;

/**
 * An exhausted outage chain (`classifyAttempts`) reaches every renderer as a
 * 400, like main — `upstreamStatus` is where the real status rides.
 */
const OUTAGE_LEGACY_CODES = new Set([
    'upstream_provider_unavailable',
    'upstream_failed',
]);

/**
 * `classifyAttempts`/`requestLevelError` (ChatCompletionDriver.ts) wrap an
 * upstream 4xx in our own 400 `upstream_bad_request` so the caller sees a
 * stable shape; unwrap it back to the upstream's own status when we have one,
 * so e.g. an upstream 413 still reads as 413. 422 is excluded: it isn't one of
 * the status codes either vendor's client expects back.
 *
 * `outageAs5xx` additionally restores an outage chain to the status Claude
 * Code's own gateway expects — 529 when the chain was all-overloaded, 502
 * otherwise. Only the Anthropic route opts in; every other caller keeps main's
 * flat 400.
 */
const effectiveStatus = (
    http: HttpError,
    opts: { outageAs5xx?: boolean } = {},
): number => {
    const upstream = Number(http.fields?.upstreamStatus);
    if (
        http.legacyCode === 'upstream_bad_request' &&
        Number.isFinite(upstream) &&
        upstream >= 400 &&
        upstream < 500 &&
        upstream !== 422
    ) {
        return upstream;
    }
    if (
        opts.outageAs5xx &&
        typeof http.legacyCode === 'string' &&
        OUTAGE_LEGACY_CODES.has(http.legacyCode)
    ) {
        return upstream === 529 ? 529 : 502;
    }
    return http.statusCode;
};

const retryAfterFor = (
    http: HttpError,
    status: number,
): string | number | undefined =>
    (http.fields?.retryAfter as string | number | undefined) ??
    (status === 429 ? 5 : undefined);

/** A generic, never-leaky HttpError for a value that wasn't one already. */
const toHttpError = (err: unknown): HttpError =>
    isHttpError(err) ? err : new HttpError(500, 'Internal server error');

/** Only a curated HttpError's own message is safe to show on a 5xx. */
const messageFor = (http: HttpError, err: unknown, status: number): string =>
    status >= 500 && !isHttpError(err) ? 'Internal server error' : http.message;

// -- Anthropic ---------------------------------------------------------

const ANTHROPIC_TYPES: Record<number, string> = {
    400: 'invalid_request_error',
    401: 'authentication_error',
    402: 'billing_error',
    403: 'permission_error',
    404: 'not_found_error',
    409: 'conflict_error',
    413: 'request_too_large',
    429: 'rate_limit_error',
    504: 'timeout_error',
    529: 'overloaded_error',
};
const ANTHROPIC_KNOWN_TYPES = new Set(Object.values(ANTHROPIC_TYPES));

/**
 * `{type:'error', error:{type, message}, request_id}`, matching live Anthropic
 *
 * - Claude Code's own error map.
 */
export const renderAnthropicError: ErrorRenderer = (err, _req: Request) => {
    const http = toHttpError(err);
    const status = effectiveStatus(http, { outageAs5xx: true });
    const type =
        (http.code && ANTHROPIC_KNOWN_TYPES.has(http.code)
            ? http.code
            : undefined) ??
        ANTHROPIC_TYPES[status] ??
        'api_error';
    const message = messageFor(http, err, status);
    const requestId = anthropicRequestId();
    const retryAfter = retryAfterFor(http, status);

    return {
        status,
        body: {
            type: 'error',
            error: { type, message },
            request_id: requestId,
        },
        headers: {
            'request-id': requestId,
            'x-should-retry': String(isRetryableStatus(status)),
            ...(retryAfter !== undefined ? { 'retry-after': retryAfter } : {}),
        },
    };
};

// -- OpenAI --------------------------------------------------------------

const OPENAI_TYPES: Record<number, string> = {
    401: 'authentication_error',
    403: 'permission_error',
    404: 'not_found_error',
    429: 'rate_limit_error',
};

/** `{error:{message, type, param, code}}`, matching the OpenAI client libraries. */
export const renderOpenAIError: ErrorRenderer = (err, _req: Request) => {
    const http = toHttpError(err);
    const status = effectiveStatus(http);
    const type =
        status >= 500
            ? 'server_error'
            : (OPENAI_TYPES[status] ?? 'invalid_request_error');
    const message = messageFor(http, err, status);
    const retryAfter = retryAfterFor(http, status);

    return {
        status,
        body: {
            error: {
                message,
                type,
                param: null,
                code: http.legacyCode ?? http.code ?? null,
            },
        },
        ...(retryAfter !== undefined
            ? { headers: { 'retry-after': retryAfter } }
            : {}),
    };
};
