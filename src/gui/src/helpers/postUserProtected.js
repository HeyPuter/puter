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

// Refusals whose server message is English and, for the password, reads
// like the new and confirmed passwords disagreeing ("Password mismatch").
const CODE_MESSAGES = {
    password_mismatch: 'incorrect_password',
    code_mismatch: 'confirm_code_generic_incorrect',
    too_many_requests: 'confirm_code_generic_too_many_requests',
};

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
 * @param {string} [opts.password] Sent on the first attempt only, and never
 *   for an account without one: signing in with the provider stands in for it.
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
        const known = CODE_MESSAGES[data.code];
        return { ok: false, data, message: known ? i18n(known, [], false) : data.message || res.statusText || i18n('error_unknown_cause', [], false) };
    };

    /** Resolves to null once signed in, or to the i18n key of why it didn't finish. */
    const revalidate = async (url) => {
        onRevalidate?.();
        try {
            await openRevalidatePopup(url);
            return null;
        } catch ( err ) {
            return err?.code === 'popup_blocked' ? 'revalidate_popup_blocked' : 'revalidate_failed';
        }
    };
    const revalidateFailed = (key) => ({ ok: false, data: {}, message: i18n(key, [], false) });

    // The popup opens straight from the click while the sign-in URL is known;
    // without one, the server says where to sign in. A temporary account has
    // no password either, but no linked provider: the routes that admit it
    // (deleting it) need no proof of identity at all.
    const user = window.user;
    if ( user?.oidc_only && ! user.is_temp && user.oidc_revalidate_url ) {
        const failed = await revalidate(user.oidc_revalidate_url);
        if ( failed ) return revalidateFailed(failed);
        return settle(await post(body));
    }

    const sendPassword = password && ! user?.oidc_only;
    const result = await settle(await post(sendPassword ? { ...body, password } : body));
    if ( result.data.code !== 'oidc_revalidation_required' ) return result;
    // The server answers this only for an account without a password, and
    // it has the last word over a cached `oidc_only` that lags.
    if ( ! result.data.revalidate_url ) {
        return { ...result, message: i18n('revalidate_unavailable', [], false) };
    }
    if ( user ) {
        user.oidc_only = true;
        user.oidc_revalidate_url = result.data.revalidate_url;
    }
    const failed = await revalidate(result.data.revalidate_url);
    if ( failed ) return revalidateFailed(failed);
    return settle(await post(body));
}
