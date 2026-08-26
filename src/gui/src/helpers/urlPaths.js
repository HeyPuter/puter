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
 * A leading `desktop` segment is dropped with them: `/desktop` only picks the
 * interface, and everything after it is the same route it would be at the
 * root. So `/desktop/app/<name>` yields `['app', '<name>']` — the app landing
 * every route check downstream already understands — and the only difference
 * from `/app/<name>` is that the dashboard-mode check (see initgui.js) doesn't
 * claim the path, leaving the app to open on the desktop.
 *
 * @param {string} pathname - the pathname to parse, e.g. `/desktop/app/editor`
 * @returns {string[]} route segments
 */
export const parse_url_paths = (pathname) => {
    const paths = String(pathname ?? '')
        .split('/')
        .filter((element) => element);
    if ( paths[0]?.toLocaleLowerCase() === 'desktop' ) {
        paths.shift();
    }
    return paths;
};
