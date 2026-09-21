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

// The initial-and-color avatar the share modal shows next to each person.

/**
 * Stable, name-derived hue so a person keeps the same color across reopenings.
 *
 * @param {string} [name]
 * @returns {number} hue in [0, 360)
 */
export const avatarHue = (name) => {
    let hue = 0;
    for ( const char of String(name ?? '') ) {
        hue = (hue * 31 + char.codePointAt(0)) % 360;
    }
    return hue;
};

/**
 * The name's first character, uppercased; `?` when there is no name.
 *
 * @param {string} [name]
 * @returns {string}
 */
export const avatarInitial = (name) => {
    const trimmed = String(name ?? '').trim();
    // Iterating takes a whole code point; charAt(0) halves an emoji into tofu.
    for ( const char of trimmed ) return char.toUpperCase();
    return '?';
};
