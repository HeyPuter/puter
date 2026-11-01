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
import { HANDLER_NAME_MAX_LENGTH } from '../../stores/events/EventHandlerStore.js';

/** Request fields shared by the subscription and schedule verbs. */

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
