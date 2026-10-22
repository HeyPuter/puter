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

import { openRevalidatePopup } from '../util/openid.js';
import { fetchWithSessionCookieRetry, isSessionAuthError } from '../util/sessionAuth.js';

/**
 * @typedef {object} UserProtectedResult
 * @property {boolean} ok The server accepted the change.
 * @property {Record<string, any>} data The response body (`{}` when it had none).
 * @property {string} [message] What to show when `ok` is false.
 * @property {boolean} [reauth] The session cookie could not be restored; the
 *   sign-in flow has been started and the user has to try again after it.
 */

/**
 * POSTs an account change to `/user-protected/<route>`, the way every
 * account dialog has to. Those routes authenticate with the session cookie
 * only: the request carries no Authorization header, a lost cookie is minted
 * again from the GUI token once, and an account that signs in through a
 * linked provider proves itself in the provider's popup instead of with a
 * password — up front when the account has no password, or when the server
 * asks for it.
 *
 * @param {string} route The part after `/user-protected/`.
 * @param {Record<string, unknown>} body The change itself, sent on every attempt.
 * @param {object} [opts]
 * @param {string} [opts.password] Sent on the first attempt only; signing in
 *   with the provider stands in for it on a retry.
 * @param {() => void} [opts.onRevalidate] Runs just before the sign-in popup opens.
 * @returns {Promise<UserProtectedResult>}
 */
export default async function postUserProtected (route, body, { password, onRevalidate } = {}) {
    const origin = window.gui_origin || window.api_origin || '';
    const post = (payload) => fetchWithSessionCookieRetry(() => fetch(`${origin}/user-protected/${route}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }), { origin, authToken: window.auth_token });

    const settle = async (res) => {
        const data = await res.json().catch(() => ({}));
        if ( isSessionAuthError(res, data) ) {
            window.handleReauthRequired({ reason: data.reason, auth_id: data.auth_id });
            return { ok: false, data, reauth: true, message: i18n('reauth_required_message', [], false) };
        }
        if ( res.ok ) return { ok: true, data };
        return { ok: false, data, message: data.message || res.statusText || i18n('error_unknown_cause', [], false) };
    };

    const revalidate = async (url) => {
        onRevalidate?.();
        try {
            await openRevalidatePopup(url || window.user?.oidc_revalidate_url);
            return true;
        } catch {
            return false;
        }
    };
    const revalidateFailed = () => ({ ok: false, data: {}, message: i18n('revalidate_failed', [], false) });

    // A temporary account has no password either, but no linked provider: the
    // routes that admit it (deleting it) need no proof of identity at all.
    if ( window.user?.oidc_only && ! window.user.is_temp && ! password ) {
        if ( ! await revalidate() ) return revalidateFailed();
        return settle(await post(body));
    }

    const result = await settle(await post(password ? { ...body, password } : body));
    // `oidc_only` on the cached user can lag the account's real state, so
    // the server has the last word on whether a provider sign-in is needed.
    if ( result.data.code === 'oidc_revalidation_required' && result.data.revalidate_url ) {
        if ( ! await revalidate(result.data.revalidate_url) ) return revalidateFailed();
        return settle(await post(body));
    }
    return result;
}
