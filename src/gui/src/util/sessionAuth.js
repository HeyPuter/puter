/**
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
 * Helpers for `/user-protected/*` endpoints, which authenticate via the
 * httpOnly session cookie only (bearer tokens are rejected so a leaked
 * token can't drive account changes). The GUI sends these requests with
 * cookies and no Authorization header, so a missing/stale cookie comes
 * back as a 401 whose `code` depends on where it was rejected:
 *
 *   - `token_missing`     — no cookie at all (auth gate)
 *   - `token_auth_failed` — cookie present but invalid (auth gate)
 *   - `reauth_required`   — cookie maps to a revoked/legacy session
 *   - `session_required`  — authenticated via a non-cookie source
 *
 * All of these can usually be self-healed by minting a fresh cookie from
 * the GUI bearer token via `/session/sync-cookie` and retrying once. When
 * that isn't possible the caller should route through
 * `window.handleReauthRequired` so the user signs in again and the cookie
 * gets set.
 */

const SESSION_AUTH_CODES = new Set([
    'token_missing',
    'token_auth_failed',
    'reauth_required',
    'session_required',
]);

export const isSessionAuthError = (res, data) => {
    return res?.status === 401 && SESSION_AUTH_CODES.has(data?.code);
};

export const syncSessionCookie = async ({ origin, authToken, fetchFn = globalThis.fetch }) => {
    if ( ! authToken ) return false;
    try {
        const res = await fetchFn(`${origin}/session/sync-cookie`, {
            method: 'GET',
            credentials: 'include',
            headers: { Authorization: `Bearer ${authToken}` },
        });
        return res.ok;
    } catch ( e ) {
        return false;
    }
};

/**
 * Run `send` (a thunk performing the user-protected fetch); on a 401
 * caused by a missing/bad session cookie, mint the cookie and retry once.
 */
export const fetchWithSessionCookieRetry = async (send, { origin, authToken, fetchFn } = {}) => {
    let res = await send();
    if ( res.status === 401 ) {
        const data = await res.clone().json().catch(() => ({}));
        if ( isSessionAuthError(res, data) && await syncSessionCookie({ origin, authToken, fetchFn }) ) {
            res = await send();
        }
    }
    return res;
};
