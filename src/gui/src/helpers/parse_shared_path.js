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

/** The query parameter a share link arrives on. */
export const SHARED_PATH_PARAM = 'shared';

/**
 * Take `?shared=` off the address bar so a reload doesn't act on it again.
 *
 * @param {string} [hash] - What to leave after the `#`; the current hash if omitted
 */
export function clear_shared_param (hash = window.location.hash) {
    const params = new URLSearchParams(window.location.search);
    params.delete(SHARED_PATH_PARAM);
    const rest = params.toString();
    window.history.replaceState(
        null,
        document.title,
        `${window.location.pathname || '/'}${rest ? `?${rest}` : ''}${hash || ''}`,
    );
}

// The uuid segment of a shared item's path; see the backend's `sharePathMask`.
const UID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read `/<owner>/<uuid>/<name>`, the form a recipient is given. `null` for
 * anything else, so a hand-edited link is refused before it becomes a request.
 *
 * @param {string} shared_path
 * @returns {{ owner: string, uid: string, name: string } | null}
 */
export default function parse_shared_path (shared_path) {
    if ( typeof shared_path !== 'string' || ! shared_path.startsWith('/') ) {
        return null;
    }
    const [, owner, uid, ...rest] = shared_path.split('/');
    if ( ! owner || ! uid || ! UID_PATTERN.test(uid) ) return null;

    const name = rest.join('/');
    // The uuid stands in for the parent; the segment after it is the item.
    if ( ! name ) return null;

    return { owner, uid, name };
}
