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

const isBindable = (value: unknown): boolean => {
    if (value === null || value === undefined) return true;
    switch (typeof value) {
        case 'number':
            // mysql writes NaN and Infinity into the SQL as bare words, and
            // integers past 2^53 lose precision or overflow BIGINT.
            return Math.abs(value as number) <= Number.MAX_SAFE_INTEGER;
        case 'string':
        case 'bigint':
        case 'boolean':
            return true;
        case 'object':
            // Buffer is a Uint8Array.
            return value instanceof Date || value instanceof Uint8Array;
        default:
            return false;
    }
};

/**
 * Refuses a bound value that isn't a scalar. mysql formats queries in the
 * client and expands an array into a value list and an object into `col = val`
 * pairs, so a request value of the wrong shape would change the statement
 * instead of failing to match. `IN` lists bind one `?` per item.
 */
export const assertBindableParams = (
    statement: string,
    params: readonly unknown[] | undefined,
): void => {
    if (!params) return;
    for (const value of params) {
        if (isBindable(value)) continue;
        console.warn(
            `[db] refused a ${Array.isArray(value) ? 'array' : typeof value} parameter:`,
            statement.slice(0, 200),
        );
        throw new HttpError(400, 'Invalid parameter.', {
            legacyCode: 'bad_request',
        });
    }
};
