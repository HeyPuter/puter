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
 * A framed popup that serves the framing page's user while the GUI's active
 * session is another of the browser's saved accounts. The user switched away
 * from that account here without signing out of it, so its token is still
 * among `logged_in_users`; the frame runs as it in memory only. The GUI's
 * stored session, its cookie and its other tabs stay on the active account.
 */

let borrowed = false;

/**
 * Whether this page runs as a saved account other than the GUI's active one,
 * so it must not store, sync or sign out the session it holds.
 *
 * @returns {boolean}
 */
export const frameSessionIsBorrowed = () => borrowed;

/**
 * Makes this page send `token` without storing it as the active session. The
 * boot's `update_auth_data` then takes on its user, as for any session.
 *
 * @param {{ token: string }} session
 * @param {Window} [win]
 */
export const adoptBorrowedSession = ({ token }, win = window) => {
    borrowed = true;
    win.auth_token = token;
    win.puter?.setAuthToken?.(token, win.api_origin);
};

/**
 * The saved account the framing page is signed in as, when it isn't the GUI's
 * active one: its token from `logged_in_users`, still accepted by the API, and
 * an account that has signed in to the framing page. Null otherwise, which
 * leaves the page to open the popup or tab. Never rejects.
 *
 * @param {Object} opts
 * @param {string | null} opts.hostUser - the framing page's user uuid, in lower case
 * @param {Array<Record<string, unknown>>} opts.savedUsers - `logged_in_users`
 * @param {string} opts.hostOrigin - the framing page's origin
 * @param {string} opts.apiOrigin
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ token: string, user: Record<string, unknown> } | null>}
 */
export const savedAccountSession = async ({ hostUser, savedUsers, hostOrigin, apiOrigin, fetchImpl = fetch }) => {
    if ( !hostUser || !hostOrigin || !Array.isArray(savedUsers) ) return null;
    const saved = savedUsers.find(user =>
        typeof user?.uuid === 'string' && user.uuid.toLowerCase() === hostUser);
    const token = saved?.auth_token;
    if ( typeof token !== 'string' || !token ) return null;
    const headers = { Authorization: `Bearer ${token}` };
    try {
        const whoami = await fetchImpl(new URL('/whoami', apiOrigin), { headers });
        if ( ! whoami.ok ) return null;
        const user = await whoami.json();
        if ( typeof user?.uuid !== 'string' || user.uuid.toLowerCase() !== hostUser ) return null;

        // The page names its user itself, so the frame serves only an account
        // that signed in to the page, as the active account's frame does.
        const relationship = await fetchImpl(new URL('/auth/check-app', apiOrigin), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: hostOrigin }),
        });
        if ( ! relationship.ok ) return null;
        if ( (await relationship.json())?.authenticated !== true ) return null;
        return { token, user };
    } catch {
        return null;
    }
};
