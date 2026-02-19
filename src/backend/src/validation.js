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

// Shared validation helpers formerly provided by backend-core-0.
export { is_valid_path } from './filesystem/validation.js';

export const is_valid_uuid = (uuid) => {
    let s = `${ uuid }`;
    s = s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    return !!s;
};

export const is_valid_uuid4 = (uuid) => {
    return is_valid_uuid(uuid);
};

export const is_specifically_uuidv4 = (uuid) => {
    let s = `${ uuid }`;

    s = s.match(/^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i);
    if ( ! s ) {
        return false;
    }
    return true;
};

export const is_valid_url = (url) => {
    let s = `${ url }`;

    try {
        new URL(s);
        return true;
    } catch (e) {
        return false;
    }
};