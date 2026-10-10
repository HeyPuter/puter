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

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

// -- Transport failures --

// Transport timeouts carry no HTTP status. The Stainless SDKs (OpenAI,
// Together, Gemini) throw `APIConnectionTimeoutError`; undici wraps its own
// in a `fetch failed` TypeError whose cause carries the code.
const TIMEOUT_ERROR_NAMES = new Set([
    'APIConnectionTimeoutError',
    'TimeoutError',
    'ConnectTimeoutError',
    'HeadersTimeoutError',
    'BodyTimeoutError',
]);
const TIMEOUT_ERROR_CODES = new Set([
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
]);
const CONNECTION_ERROR_NAMES = new Set(['APIConnectionError', 'SocketError']);
const CONNECTION_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
]);
const TRANSIENT_STATUSES = new Set([408, 429]);

interface ErrorShape {
    name?: unknown;
    code?: unknown;
    cause?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    constructor?: { name?: string };
}

const asShape = (e: unknown): ErrorShape | undefined =>
    e && typeof e === 'object' ? (e as ErrorShape) : undefined;

const matches = (
    e: ErrorShape,
    names: Set<string>,
    codes: Set<string>,
): boolean =>
    (typeof e.name === 'string' && names.has(e.name)) ||
    names.has(e.constructor?.name ?? '') ||
    (typeof e.code === 'string' && codes.has(e.code));

const upstreamStatus = (e: ErrorShape): number | undefined => {
    const s = e.status ?? e.statusCode ?? e.response?.status;
    return typeof s === 'number' ? s : undefined;
};

/** A request to an upstream provider ran out of time before it answered. */
export const isUpstreamTimeoutError = (err: unknown): boolean => {
    const e = asShape(err);
    if (!e) return false;
    if (matches(e, TIMEOUT_ERROR_NAMES, TIMEOUT_ERROR_CODES)) return true;
    const cause = asShape(e.cause);
    return (
        cause !== undefined &&
        matches(cause, TIMEOUT_ERROR_NAMES, TIMEOUT_ERROR_CODES)
    );
};

/**
 * A failure worth retrying on the next poll: a timeout, a dropped connection,
 * or a status the provider itself treats as temporary (408, 429, 5xx). Any
 * other 4xx is the provider's verdict on the request and is not transient.
 */
export const isTransientUpstreamError = (err: unknown): boolean => {
    if (isUpstreamTimeoutError(err)) return true;
    const e = asShape(err);
    if (!e) return false;
    const status = upstreamStatus(e);
    if (status !== undefined) {
        return status >= 500 || TRANSIENT_STATUSES.has(status);
    }
    if (matches(e, CONNECTION_ERROR_NAMES, CONNECTION_ERROR_CODES)) return true;
    const cause = asShape(e.cause);
    return (
        cause !== undefined &&
        matches(cause, CONNECTION_ERROR_NAMES, CONNECTION_ERROR_CODES)
    );
};

// -- Upstream messages --

const MAX_UPSTREAM_MESSAGE_LENGTH = 300;

/** Model-side content filters, as worded in provider failure payloads. */
export const CONTENT_FILTER_PATTERN =
    /\bnsfw\b|sensitive|content[\s_-]?policy|moderation|safety|\bunsafe\b|\bflagged\b|prohibited|\bE005\b/i;

/** Provider messages that indicate the account cannot fund another request. */
export const CREDIT_EXHAUSTION_PATTERN =
    /insufficient[\s_-]?(credits?|quota|funds|balance)|credits? (have been|are) used up|out of credits|(team )?balance (greater than|below|too low)|billing hard limit/i;

/** A provider account has exhausted its credits or billing allowance. */
export const isCreditExhaustion = (
    status: number | undefined,
    code: string | undefined,
    message: string,
): boolean =>
    status === 402 ||
    (code !== undefined &&
        /insufficient_(user_)?quota|insufficient_credits|billing/i.test(
            code,
        )) ||
    CREDIT_EXHAUSTION_PATTERN.test(message);

/**
 * Strips markup, URLs and request ids, then bounds length so provider details
 * never ride through into a response body or an alarm signature. The fallback
 * bound fits a user-facing error; callers that keep the message only in
 * `fields.attempts` (never serialized to the client on the vendor-compatible
 * routes) can ask for more room.
 */
export const sanitizeUpstreamMessage = (
    raw: string,
    maxLength: number = MAX_UPSTREAM_MESSAGE_LENGTH,
): string => {
    const text = raw
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\(\s*request[\s_-]?id\s*:\s*[^)]*\)/gi, ' ')
        .replace(/\brequest[\s_-]?id\s*:\s*\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength
        ? `${text.slice(0, maxLength - 3)}...`
        : text;
};

// -- Provider HTTP calls --

/** Longest provider error body kept as the message; the boundary trims further. */
const MAX_ERROR_BODY_CHARS = 2000;

/**
 * A provider API answered with a non-2xx status. The driver boundary maps it
 * like any SDK error: by `status`, with `code` and a sanitized message.
 */
export class UpstreamResponseError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
    ) {
        super(message);
        this.name = 'UpstreamResponseError';
    }
}

const stringOr = (...values: unknown[]): string | undefined =>
    values.find((v): v is string => typeof v === 'string' && v !== '');

/** Reads the message and code out of the error shapes providers send. */
const upstreamResponseError = async (
    provider: string,
    response: Response,
): Promise<UpstreamResponseError> => {
    let text = '';
    try {
        text = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
    } catch {
        // Body unreadable; the status alone decides.
    }
    let body: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            body = parsed as Record<string, unknown>;
        }
    } catch {
        // Not JSON; the raw text is the message.
    }
    const error = (body.error ?? {}) as Record<string, unknown>;
    const detail = (body.detail ?? {}) as Record<string, unknown>;
    const message =
        stringOr(
            error.message,
            body.error,
            detail.message,
            body.detail,
            body.message,
            text.trim(),
        ) ?? `${provider} request failed (status ${response.status})`;
    const code = stringOr(error.code, detail.code, body.code);
    return new UpstreamResponseError(message, response.status, code);
};

/**
 * `fetch` against a provider's own API, bounded by `timeoutMs` (body included).
 * A non-2xx answer throws {@link UpstreamResponseError}; a timeout rejects with
 * `TimeoutError`, which the driver boundary maps to a 504.
 */
export async function upstreamFetch(
    provider: string,
    url: string | URL,
    init: RequestInit,
    { timeoutMs }: { timeoutMs: number },
): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
        ...init,
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (response.ok) return response;
    throw await upstreamResponseError(provider, response);
}

/**
 * A provider's response body as a stream to hand straight to the caller. A
 * failure mid-body (a reset, or {@link upstreamFetch}'s timeout) errors the
 * stream, which the driver response path turns into an aborted transfer.
 */
export function upstreamBodyStream(response: Response): Readable {
    return response.body
        ? Readable.fromWeb(response.body as WebReadableStream)
        : Readable.from([]);
}
