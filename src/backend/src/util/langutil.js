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
 * whatis is an alterative to typeof that reports what
 * the type of the value actually is for real.
 */
const whatis = thing => {
    if ( Array.isArray(thing) ) return 'array';
    if ( thing === null ) return 'null';
    return typeof thing;
};

const nou = v => v === null || v === undefined;

const can = (v, ...checking) => {
    if ( nou(v) ) return false;
    const capabilities = {};
    if ( v[Symbol.iterator] ) {
        capabilities['iterate'] = true;
    }
    for ( const to_check of checking ) {
        if ( ! capabilities[to_check] ) {
            return false;
        }
    }
    return true;
}

module.exports = {
    whatis,
    nou,
    can,
};
