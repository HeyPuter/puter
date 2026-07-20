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

import { HttpError } from '../core/http';

/**
 * Shared pagination envelope for list endpoints. A response carries `cursor`
 * only when more pages exist; `total` only when the request asked for it via
 * `includeTotal`. Pages may hold fewer than `limit` items (post-query
 * filtering) — clients iterate until `cursor` is absent.
 */
export interface PageResult<T> {
    items: T[];
    cursor?: string;
    total?: number;
}

export const encodeCursor = (
    payload?: Record<string, unknown>,
): string | undefined => {
    if (!payload || Object.keys(payload).length === 0) return undefined;
    return Buffer.from(JSON.stringify(payload)).toString('base64');
};

export const decodeCursor = (
    cursor?: string | Record<string, unknown> | null,
    label = 'cursor',
): Record<string, unknown> | undefined => {
    if (cursor === undefined || cursor === null) return undefined;
    if (typeof cursor === 'object') return cursor;
    const trimmed = cursor.trim();
    if (trimmed === '') return undefined;
    try {
        return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
        try {
            return JSON.parse(trimmed);
        } catch {
            throw new HttpError(400, `invalid ${label}`, {
                legacyCode: 'bad_request',
            });
        }
    }
};

export const normalizeLimit = (
    limit: unknown,
    { cap, label = 'limit' }: { cap?: number; label?: string } = {},
): number | undefined => {
    if (limit === undefined || limit === null) return undefined;
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HttpError(400, `${label} must be a positive number`, {
            legacyCode: 'bad_request',
        });
    }
    const floored = Math.floor(parsed);
    return cap !== undefined ? Math.min(floored, cap) : floored;
};

export const normalizeOffset = (
    offset: unknown,
    { cap, label = 'offset' }: { cap?: number; label?: string } = {},
): number | undefined => {
    if (offset === undefined || offset === null) return undefined;
    const parsed = Number(offset);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new HttpError(400, `${label} must be a non-negative number`, {
            legacyCode: 'bad_request',
        });
    }
    const floored = Math.floor(parsed);
    if (cap !== undefined && floored > cap) {
        throw new HttpError(400, `${label} may not exceed ${cap}`, {
            legacyCode: 'bad_request',
        });
    }
    return floored;
};
