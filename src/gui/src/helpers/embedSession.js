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

import { embedHostUser } from './embedHostUser.js';

/**
 * @typedef {Object} EmbedSession
 * @property {string} token - the GUI session's token
 * @property {Record<string, unknown>} user - `/whoami` for that token
 */

/**
 * The GUI session, from local storage or else the session cookie. Safari keys a
 * frame's local storage by the top-level origin, so under a sibling subdomain
 * the GUI's stored token is out of reach while its cookie is still sent.
 *
 * @returns {Promise<string | null>}
 */
async function readSession () {
    let stored = null;
    try {
        stored = localStorage.getItem('auth_token_v2');
    } catch { /* Storage the browser refuses holds no session; the cookie may. */ }
    if ( stored ) return stored;
    const response = await fetch('/get-gui-token', { credentials: 'include' });
    // Only a 401 means there is no session; a rate limit or server error
    // must not pass a signed-in user off as signed out.
    if ( response.status === 401 ) return null;
    if ( ! response.ok ) throw new Error(`Session lookup responded ${response.status}`);
    return (await response.json())?.token || null;
}

/**
 * `/whoami` for a GUI token, or null when the API refuses it.
 *
 * @param {string} token
 * @param {string} apiOrigin
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function whoami (token, apiOrigin) {
    const response = await fetch(new URL('/whoami', apiOrigin), {
        headers: { Authorization: `Bearer ${token}` },
    });
    if ( response.status === 401 ) return null;
    if ( ! response.ok ) throw new Error(`Session check responded ${response.status}`);
    const user = await response.json();
    return user && typeof user === 'object' ? user : null;
}

/**
 * The GUI session, only when it belongs to the user the embedding page names
 * in its `#user=<uuid>` fragment. A host signed out, or signed in as someone
 * else, gets null. Rejects when the session can't be checked.
 *
 * @param {string} apiOrigin
 * @param {string} hash - `location.hash`
 * @returns {Promise<EmbedSession | null>}
 */
export async function embedSession (apiOrigin, hash) {
    const hostUser = embedHostUser(hash);
    if ( ! hostUser ) return null;
    const token = await readSession();
    if ( ! token ) return null;
    const user = await whoami(token, apiOrigin);
    const uuid = typeof user?.uuid === 'string' ? user.uuid.toLowerCase() : null;
    return uuid === hostUser ? { token, user } : null;
}
