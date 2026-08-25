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
 * Pick the session rows that belong to one app, out of a /auth/list-sessions
 * response.
 *
 * Only `kind === 'app'` rows: `worker` rows also carry an `app_uid` but are
 * deployment credentials rather than this user's grant to the app, and access
 * tokens the app issued follow on their own through the server-side cascade.
 *
 * @param {{ uuid?: string; kind?: string; app_uid?: string | null }[]} sessions
 * @param {string} appUid
 * @returns {string[]} Uuids to revoke, in list order
 */
export const appSessionUuids = (sessions, appUid) => {
    if (!Array.isArray(sessions) || !appUid) return [];
    return sessions
        .filter((s) => s?.kind === 'app' && s?.app_uid === appUid && s?.uuid)
        .map((s) => s.uuid);
};

/**
 * Revoke every session the current user holds for one app, so a token the app
 * already has stops authenticating.
 *
 * Withdrawing an app's permissions is deliberately separate from this on the
 * server: `/auth/revoke-user-app` clears granted permissions and nothing else,
 * because revoking grants without ending the app's sign-in is a real use case.
 * Uninstall is the case that wants both, so it asks for both.
 *
 * Best-effort per row: a 404 means the row already went away, which is the
 * outcome we wanted, and one failed row shouldn't strand the others. Returns
 * the count actually revoked so a caller can tell "nothing to do" from "we
 * tried and the server said no".
 *
 * @param {string} appUid
 * @param {object} [deps] Injectable seams for tests.
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => Promise<string>} [deps.antiCsrfToken]
 * @param {string} [deps.apiOrigin]
 * @param {string} [deps.authToken]
 * @returns {Promise<number>} How many sessions were revoked
 */
export const revokeAppSessions = async (
    appUid,
    {
        fetchImpl = globalThis.fetch?.bind(globalThis),
        antiCsrfToken = () => globalThis.services.get('anti-csrf').token(),
        apiOrigin = window.api_origin,
        authToken = undefined,
    } = {},
) => {
    if (!appUid) return 0;
    const token = authToken ?? (puter.authToken || window.auth_token);
    const authHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    const listResp = await fetchImpl(`${apiOrigin}/auth/list-sessions`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResp.ok) {
        throw new Error(`Failed to list sessions (${listResp.status})`);
    }
    const uuids = appSessionUuids(await listResp.json(), appUid);
    if (uuids.length === 0) return 0;

    // One anti-CSRF token per row: the service issues single-use tokens, so a
    // token reused across the loop would be rejected from the second row on.
    let revoked = 0;
    for (const uuid of uuids) {
        const anti_csrf = await antiCsrfToken();
        const resp = await fetchImpl(`${apiOrigin}/auth/revoke-session`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ uuid, anti_csrf }),
        });
        if (resp.ok || resp.status === 404) revoked++;
    }
    return revoked;
};

export default revokeAppSessions;
