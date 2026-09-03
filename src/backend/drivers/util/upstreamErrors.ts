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

/**
 * Strips markup and bounds length so an upstream HTML error page never rides
 * through into a response body or an alarm signature.
 */
export const sanitizeUpstreamMessage = (raw: string): string => {
    const text = raw
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > MAX_UPSTREAM_MESSAGE_LENGTH
        ? `${text.slice(0, MAX_UPSTREAM_MESSAGE_LENGTH - 3)}...`
        : text;
};
