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
 * @typedef {Object} LegacyLanding
 * @property {{ tab: string, path: string|null }} [route] dashboard route to open on
 * @property {string} [open_path] a path to open as double-clicking it would
 * @property {boolean} [invalid_username] `/@<name>` named no valid username
 */

const decode_segment = (segment) => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
};

/**
 * Where a URL that used to open on the desktop lands in the dashboard:
 * `/@<user>/<path>` and `/show/<path>` open that path, `/settings` opens Home,
 * and `?app=explorer[&path=]` opens Files. The URL is spent once read: the
 * caller swaps it for the dashboard's own.
 *
 * @param {string[]} url_paths route segments (see parse_url_paths)
 * @param {URLSearchParams} query_params
 * @returns {LegacyLanding|null} null for any other URL
 */
export const legacy_landing = (url_paths, query_params) => {
    const first = url_paths[0] ?? '';

    if ( first.startsWith('@') ) {
        const username = first.substring(1);
        if ( ! /^[a-z0-9_]+$/i.test(username) ) {
            return { invalid_username: true };
        }
        const rest = url_paths.slice(1).map(decode_segment);
        return {
            open_path: [`/${username}/Public`, ...rest].join('/'),
        };
    }

    if ( first.toLowerCase() === 'show' && url_paths.length > 1 ) {
        return {
            open_path: `/${url_paths.slice(1).map(decode_segment).join('/')}`,
        };
    }

    if ( first.toLowerCase() === 'settings' ) {
        return { route: { tab: 'home', path: null } };
    }

    if ( query_params.get('app') === 'explorer' ) {
        return {
            route: { tab: 'files', path: query_params.get('path') || null },
        };
    }

    return null;
};
