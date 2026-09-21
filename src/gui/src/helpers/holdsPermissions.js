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

// The dialog waits behind this check, so a stalled read must not hold it up.
const CHECK_TIMEOUT_MS = 5000;

/**
 * One `/auth/check-permissions` round trip: `token` says whose access is in question, unless `appUid` names an app under that user.
 *
 * @param {string[]} permissions
 * @param {object} options
 * @param {string} options.token
 * @param {string} [options.appUid]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiOrigin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<boolean>}
 */
const queryHeld = async (
    permissions,
    {
        token,
        appUid,
        fetchImpl = globalThis.fetch?.bind(globalThis),
        apiOrigin = window.api_origin,
        timeoutMs = CHECK_TIMEOUT_MS,
    },
) => {
    if ( ! token || ! Array.isArray(permissions) || permissions.length === 0 ) {
        return false;
    }
    const controller = typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
    const expiry = setTimeout(() => controller?.abort(), timeoutMs);
    try {
        const resp = await fetchImpl(`${apiOrigin}/auth/check-permissions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                permissions: [...new Set(permissions)],
                ...(appUid ? { app_uid: appUid } : {}),
            }),
            ...(controller ? { signal: controller.signal } : {}),
        });
        if ( ! resp.ok ) return false;
        const held = (await resp.json())?.permissions ?? {};
        // Every scope: one prompt is one decision, so partly-held is unheld.
        return permissions.every((p) => held[p] === true);
    } catch (e) {
        console.error('Failed to check held permissions', e);
        return false;
    } finally {
        clearTimeout(expiry);
    }
};

/**
 * Whether every one of these permissions is already held by whoever `token`
 * identifies — an app-under-user token, so the answer is about that app's
 * access and not the user's own.
 *
 * Used to skip a permission prompt that has nothing to ask about. A check that
 * couldn't be made is not an answer: no token, an empty list, a failed read, or
 * one that times out all report `false`, leaving the prompt to run.
 *
 * @param {string[]} permissions
 * @param {string} token - App-under-user token to check as.
 * @param {object} [deps] Injectable seams for tests.
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.apiOrigin]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<boolean>}
 */
export const holdsPermissions = (permissions, token, deps = {}) =>
    queryHeld(permissions, { ...deps, token });

/**
 * The same question asked as the user, for flows holding no app token yet.
 *
 * A missing uid reports not held: asked as the user alone, their own file answers `true`.
 *
 * @param {string[]} permissions
 * @param {string} appUid
 * @param {object} [deps] Injectable seams for tests.
 * @param {string} [deps.authToken]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.apiOrigin]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<boolean>}
 */
export const appHoldsPermissions = (permissions, appUid, deps = {}) => {
    if ( ! appUid ) return Promise.resolve(false);
    const { authToken = window.auth_token, ...rest } = deps;
    return queryHeld(permissions, { ...rest, appUid, token: authToken });
};

export default holdsPermissions;
