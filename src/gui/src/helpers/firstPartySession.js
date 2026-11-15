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
 * Pages of this deployment that are served apart from the GUI sign in with a
 * session of their own rather than an app token. The server lists their
 * origins (`gui_params.first_party_session_origins`) and mints the session.
 */

const originOf = (value) => {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

/**
 * Whether a sign-in for the page at `origin` hands over a session.
 *
 * @param {string} origin
 * @param {string[]} [listed]
 * @returns {boolean}
 */
export const isFirstPartySessionOrigin = (
    origin,
    listed = window.gui_params?.first_party_session_origins,
) => {
    const wanted = originOf(origin);
    if ( !wanted || !Array.isArray(listed) ) return false;
    return listed.some(entry => originOf(entry) === wanted);
};

/**
 * The token a sign-in hands the page that asked for it: a session of the
 * page's own for a first-party page, else the app token the exchange returned.
 * Throws when the session can't be minted, since an app token can't run such
 * a page.
 *
 * @param {string} origin - the page's attested origin
 * @param {string} appToken
 * @param {object} [deps]
 * @param {string[]} [deps.listed]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.apiOrigin]
 * @param {string} [deps.authToken] - the GUI session token
 * @returns {Promise<string>}
 */
export const signInTokenForOpener = async (origin, appToken, deps = {}) => {
    if ( ! isFirstPartySessionOrigin(origin, deps.listed) ) return appToken;

    const fetchImpl = deps.fetchImpl ?? fetch;
    const apiOrigin = deps.apiOrigin ?? window.api_origin;
    const authToken = deps.authToken ?? window.auth_token;
    const response = await fetchImpl(`${apiOrigin}/auth/first-party-session`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ origin: originOf(origin) }),
    });
    const body = response.ok ? await response.json() : null;
    if ( typeof body?.token !== 'string' || !body.token ) {
        throw new Error('first-party session request returned no token');
    }
    return body.token;
};
