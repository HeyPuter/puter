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
export const validate_string = (str, meta) => {
    if ( str === undefined ) {
        if ( ! meta.allow_empty ) {
            throw new Error(`${meta?.name} is required`);
        }
        return '';
    }

    if ( typeof str !== 'string' ) {
        throw new Error(`${meta?.name} must be a string`);
    }

    if ( ! meta.allow_empty && str.length === 0 ) {
        throw new Error(`${meta?.name} must not be empty`);
    }

    return str;
}
