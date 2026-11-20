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

// Upper-casing first folds ß/SS and the Greek final sigma. Dotted capital I
// lower-cases to i + U+0307, so it maps to I first, as the unique key does.
const foldCase = (value: string): string =>
    value
        .normalize('NFC')
        .replace(/\u0130/g, 'I')
        .toUpperCase()
        .toLowerCase();

/**
 * Whether a stored entry name (or path) is the one requested: equal once both
 * are NFC-normalized and case-folded. The database compares names under its
 * collation, which on MySQL also folds accents and most emoji together, so a
 * row a lookup returns can be a differently named entry.
 */
export const entryNamesMatch = (stored: string, requested: string): boolean =>
    stored === requested || foldCase(stored) === foldCase(requested);
