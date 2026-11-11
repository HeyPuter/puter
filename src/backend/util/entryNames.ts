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
 * Whether a stored entry name (or path) is the one requested: equal once both
 * are NFC-normalized and lower-cased. The database compares names under its
 * collation, which on MySQL also folds accents and most emoji together, so a
 * row a lookup returns can be a differently named entry.
 */
export const entryNamesMatch = (stored: string, requested: string): boolean =>
    stored === requested ||
    stored.normalize('NFC').toLowerCase() ===
        requested.normalize('NFC').toLowerCase();
