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

import { HttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { RouteRateLimit } from '../../core/http/types.js';
import {
    HANDLER_NAME_MAX_LENGTH,
    hashContent,
} from '../../stores/events/EventHandlerStore.js';

/** Request and response pieces the subscription and schedule verbs share. */

export const badRequest = (message: string, code: string): HttpError =>
    new HttpError(400, message, { legacyCode: code });

export const parseHandlerName = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.length === 0)
        throw badRequest('handlerName must be a string', 'bad_request');
    if (value.length > HANDLER_NAME_MAX_LENGTH)
        throw badRequest(
            `handlerName may not exceed ${HANDLER_NAME_MAX_LENGTH} characters`,
            'bad_request',
        );
    return value;
};

/** Hex digest of the inline source a subscribe claims it is binding. */
export const parseHandlerHash = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
        throw badRequest(
            'handlerHash must be a sha-256 hex digest',
            'bad_request',
        );
    return value;
};

/** Stored as JSON text; the byte cap is the store's to enforce. */
export const parseContext = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        throw badRequest('context must be JSON-serializable', 'bad_request');
    }
};

const tooManyCalls = (): HttpError =>
    new HttpError(429, 'Too many subscription changes', {
        legacyCode: 'too_many_requests',
    });

/** Spend one call from a per-user window, refusing past it. */
export const spendUserWindow = async (
    limit: RouteRateLimit,
    userId: number,
): Promise<void> => {
    const ok = await checkRateLimit(
        `${limit.scope}:${userId}`,
        limit.limit,
        limit.window,
    );
    if (!ok) throw tooManyCalls();
};

/**
 * A stored context as a listing may describe it: which keys it sets, and a hash
 * of the whole blob. Never the values: the column is where an API key lives.
 */
export const projectContext = (
    context: string | null,
): { contextKeys: string[] | null; contextHash: string | null } => {
    if (context === null) return { contextKeys: null, contextHash: null };
    let keys: string[] = [];
    try {
        const parsed: unknown = JSON.parse(context);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            keys = Object.keys(parsed).sort();
    } catch {
        // Stored as JSON by the verbs, so this cannot normally happen; an
        // unreadable blob still reports its hash rather than failing the list.
    }
    return { contextKeys: keys, contextHash: hashContent(context) };
};
