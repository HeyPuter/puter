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
 * Polyfill written by Chat GPT that increases the highest suppored
 * radix on Number.prototype.toString from 36 to 62.
 */
(function () {
    const originalToString = Number.prototype.toString;

    const characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const base = characters.length; // 62

    Number.prototype.toString = function (radix) {
        // Use the original toString for bases 36 or lower
        if ( !radix || radix <= 36 ) {
            return originalToString.call(this, radix);
        }

        // Custom implementation for base 62
        let value = this;
        let result = '';
        while ( value > 0 ) {
            result = characters[value % base] + result;
            value = Math.floor(value / base);
        }
        return result || '0';
    };
})();
