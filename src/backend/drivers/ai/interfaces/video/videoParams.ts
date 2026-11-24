/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

/**
 * `width`×`height` reduced to the `w:h` ratio it is, when that ratio is one of
 * `allowed`; undefined for non-numbers, non-positive sizes and other ratios.
 */
export const snapAspectRatio = (
    width: unknown,
    height: unknown,
    allowed: readonly string[],
): string | undefined => {
    if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
    ) {
        return undefined;
    }
    const w = Math.round(width);
    const h = Math.round(height);
    if (w <= 0 || h <= 0) return undefined;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(w, h);
    const candidate = `${w / d}:${h / d}`;
    return allowed.includes(candidate) ? candidate : undefined;
};

/**
 * A duration given as a number or a numeric string, as whole seconds; undefined
 * unless it comes to at least one second.
 */
export const positiveWholeSeconds = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const rounded = Math.round(value);
        return rounded > 0 ? rounded : undefined;
    }
    if (typeof value === 'string') {
        const numeric = Number.parseInt(value, 10);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
    }
    return undefined;
};
