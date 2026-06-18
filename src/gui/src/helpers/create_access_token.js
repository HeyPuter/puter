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
 * Mint a named, revocable **full-API-access** token for the current user.
 *
 * Unlike the raw GUI/session token this replaces, the returned access token
 * can do everything the user can via the API (filesystem, drivers, KV, AI,
 * apps, workers) but is rejected by the account-management endpoints
 * (change password/email/username, 2FA, session-cookie sync, minting more
 * tokens) — those gate on actor type, and an access-token actor never passes.
 *
 * The token is listed and revocable under Settings → Security → Manage
 * sessions (it lands there as a labelled `access_token` session row).
 *
 * @param {object} [opts]
 * @param {string|null} [opts.label]     User-facing name (shown in manage-sessions).
 * @param {string|null} [opts.expiresIn] jsonwebtoken duration, e.g. '30d'; null = never.
 * @returns {Promise<string>} the signed access token
 */
const create_access_token = async ({ label = null, expiresIn = null } = {}) => {
    const body = {
        // Sentinel grant — see FULL_API_ACCESS in the backend auth types.
        permissions: ['full-api-access'],
    };
    if ( label ) body.label = label;
    if ( expiresIn ) body.expiresIn = expiresIn;

    const resp = await fetch(`${window.api_origin}/auth/create-access-token`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${puter.authToken || window.auth_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if ( ! resp.ok ) {
        let message;
        try {
            message = (await resp.clone().json())?.message;
        } catch {
            try {
                message = await resp.text();
            } catch { /* ignore */ }
        }
        throw new Error(message || `Failed to create token (${resp.status})`);
    }

    const { token } = await resp.json();
    return token;
};

export default create_access_token;
