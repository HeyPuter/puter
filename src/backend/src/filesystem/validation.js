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
/* ~~~ Filesystem validation ~~~

This module contains functions that validate filesystem operations.

*/

/* eslint-disable no-control-regex */

const config = require("../config");

const path_excludes = () => /[\x00-\x1F]/g;
const node_excludes = () => /[/\x00-\x1F]/g;

// this characters are not allowed in path names because
// they might be used to trick the user into thinking
// a filename is different from what it actually is.
const safety_excludes = [
    /[\u202A-\u202E]/, // RTL and LTR override
    /[\u200E-\u200F]/, // RTL and LTR mark
    /[\u2066-\u2069]/, // RTL and LTR isolate
    /[\u2028-\u2029]/, // line and paragraph separator
    /[\uFF01-\uFF5E]/, // fullwidth ASCII
    /[\u2060]/,        // word joiner
    /[\uFEFF]/,        // zero width no-break space
    /[\uFFFE-\uFFFF]/, // non-characters
];

const is_valid_node_name = function is_valid_node_name (name) {
    if ( typeof name !== 'string' ) return false;
    if ( node_excludes().test(name) ) return false;
    for ( const exclude of safety_excludes ) {
        if ( exclude.test(name) ) return false;
    }
    if ( name.length > config.max_fsentry_name_length ) return false;
    // Names are allowed to contain dots, but cannot
    // contain only dots. (this covers '.' and '..')
    const name_without_dots = name.replace(/\./g, '');
    if ( name_without_dots.length < 1 ) return false;

    return true;
}

const is_valid_path = function is_valid_path (path, {
    no_relative_components,
    allow_path_fragment,
} = {}) {
    if ( typeof path !== 'string' ) return false;
    if ( path.length < 1 ) false;
    if ( path_excludes().test(path) ) return false;
    for ( const exclude of safety_excludes ) {
        if ( exclude.test(path) ) return false;
    }

    if ( ! allow_path_fragment ) if ( path[0] !== '/' && path[0] !== '.' ) {
        return false;
    }

    if ( no_relative_components ) {
        const components = path.split('/');
        for ( const component of components ) {
            if ( component === '' ) continue;
            const name_without_dots = component.replace(/\./g, '');
            if ( name_without_dots.length < 1 ) return false;
        }
    }

    return true;
}

module.exports = {
    is_valid_node_name,
    is_valid_path,
};
