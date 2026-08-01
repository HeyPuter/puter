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
 * Mint a GUI token for the **current session**.
 *
 * This is a full account credential — the same grade the desktop itself runs
 * on. Unlike an access token (see `create_access_token.js`) it carries a
 * session, so it passes the account-management gates: whoever holds it can
 * change the password, email, and 2FA settings.
 *
 * Only two callers should exist: the boot path, which fetches one for this
 * tab, and the AuthMe flow's opt-in full-session grant, which hands one to a
 * local development GUI after a type-to-confirm. Anything else wanting API
 * access should use `create_access_token` instead.
 *
 * Revoking it means ending the session it is bound to (Settings → Security →
 * Manage sessions), not just the copy that was handed out.
 *
 * @returns {Promise<string>} the signed GUI token
 */
const create_gui_token = async () => {
    const resp = await fetch(`${window.gui_origin}/get-gui-token`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${puter.authToken || window.auth_token}`,
        },
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

export default create_gui_token;
