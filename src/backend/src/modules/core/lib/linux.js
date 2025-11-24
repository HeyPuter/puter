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
const smol = require('@heyputer/putility').libs.smol;

const parse_meminfo = text => {
    const lines = text.split('\n');

    let meminfo = {};

    for ( const line of lines ) {
        if ( line.trim().length == 0 ) continue;

        const [key, value_and_unit] = smol.split(line, ':', { trim: true });
        const [value, _] = smol.split(value_and_unit, ' ', { trim: true });
        // note: unit is always 'kB' so we discard it
        meminfo[key] = Number.parseInt(value);
    }

    return meminfo;
};

module.exports = {
    parse_meminfo,
};
