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
 * Absent, negative and placeholder prices remain unpriced, including empty
 * strings.
 */
export const catalogPrice = (
    value: unknown,
    multiplier = 1,
): number | undefined => {
    if (typeof value !== 'number' && typeof value !== 'string')
        return undefined;
    if (
        typeof value === 'string' &&
        !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    )
        return undefined;
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) return undefined;
    const converted = price * multiplier;
    return Number.isFinite(converted) && !(price > 0 && converted === 0)
        ? converted
        : undefined;
};
