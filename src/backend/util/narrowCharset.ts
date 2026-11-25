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
 * Some MySQL columns are `ascii` or `latin1` while the connection is utf8mb4.
 * Comparing such a column with a value MySQL cannot convert to its charset
 * fails the whole statement (`Illegal mix of collations`) instead of matching
 * no row. A value like that cannot be stored there either, so a lookup can
 * answer "no match" without asking.
 */
export type NarrowCharset = 'ascii' | 'latin1';

/**
 * Whether `value` is certain to convert to `charset`.
 *
 * Deliberately narrower than MySQL's `latin1` (cp1252): the C1 range
 * U+0080–U+009F converts for only a few code points, and cp1252's extras above
 * U+00FF (€, Œ, …) are refused too. No identifier stored in these columns uses
 * either.
 */
export const fitsCharset = (value: string, charset: NarrowCharset): boolean => {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x7f) continue;
        if (charset === 'latin1' && code >= 0xa0 && code <= 0xff) continue;
        return false;
    }
    return true;
};
