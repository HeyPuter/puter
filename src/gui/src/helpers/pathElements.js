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
 * Narrows `elements` to those whose `attr` is `path`, ignoring case. Reads the
 * attribute, because a path can hold any character a selector can't.
 *
 * @param {string | Element | JQuery} elements - a selector or a set of elements
 * @param {string} path
 * @param {string} [attr]
 * @returns {JQuery}
 */
export const atPath = (elements, path, attr = 'data-path') => {
    // Without this, a missing path matches every element whose attribute is empty.
    if ( ! path ) return $();
    const wanted = String(path).toLowerCase();
    return $(elements).filter(function () {
        const value = this.getAttribute(attr);
        return value !== null && value.toLowerCase() === wanted;
    });
};

/**
 * Narrows `elements` to those whose `data-path` is inside the folder at `path`.
 *
 * @param {string | Element | JQuery} elements - a selector or a set of elements
 * @param {string} path
 * @returns {JQuery}
 */
export const underPath = (elements, path) => {
    if ( ! path ) return $();
    const prefix = `${path}/`;
    return $(elements).filter(function () {
        return this.getAttribute('data-path')?.startsWith(prefix) === true;
    });
};

/**
 * Points every element at `oldPath`, or inside it, to `newPath`.
 *
 * @param {string} oldPath
 * @param {string} newPath
 * @param {string} newName - shown by the breadcrumbs that pointed at `oldPath`
 */
export const retargetPaths = (oldPath, newPath, newName) => {
    if ( ! oldPath ) return;
    const $inside = underPath('[data-path]', oldPath);
    atPath('[data-path]', oldPath).each(function () {
        $(this).attr('data-path', newPath);
        if ( $(this).hasClass('window-navbar-path-dirname') ) {
            $(this).text(newName);
        }
    });
    $inside.each(function () {
        $(this).attr('data-path', newPath + $(this).attr('data-path').slice(oldPath.length));
    });
};
