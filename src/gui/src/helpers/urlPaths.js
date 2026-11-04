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
 * Splits a GUI pathname into the route segments the boot code matches on
 * (`window.url_paths`), dropping empty segments.
 *
 * @param {string} pathname - the pathname to parse, e.g. `/app/editor`
 * @returns {string[]} route segments
 */
export const parse_url_paths = (pathname) => String(pathname ?? '')
    .split('/')
    .filter((element) => element);

/**
 * The pathname with a leading `/desktop` segment dropped. `/desktop` used to
 * pick the desktop interface, and what follows it is the same route at the
 * root: `/desktop/app/<name>` is `/app/<name>`.
 *
 * @param {string} pathname - e.g. `/desktop/app/editor`
 * @returns {string} e.g. `/app/editor`; `/` when nothing follows the prefix
 */
export const drop_desktop_prefix = (pathname) =>
    String(pathname ?? '').replace(/^\/desktop(?=\/|$)/i, '') || '/';
