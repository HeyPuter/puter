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
const parse_meminfo = text => {
    const lines = text.split('\n');

    let meminfo = {};

    for ( const line of lines ) {
        if ( line.trim().length == 0 ) continue;

        const [keyPart, rest] = line.split(':');
        if ( rest === undefined ) continue;

        const key = keyPart.trim();
        // rest looks like "      123 kB"; parseInt ignores the unit.
        const value = Number.parseInt(rest, 10);
        meminfo[key] = value;
    }

    return meminfo;
};

module.exports = {
    parse_meminfo,
};
