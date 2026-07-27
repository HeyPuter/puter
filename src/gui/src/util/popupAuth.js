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
 * Rules for what a GUI popup may hand back to the site that opened it.
 *
 * A popup boot (`?embedded_in_popup=true`) mints a user-app token on several
 * different paths — the plain token exchange, first-visit temp-user creation,
 * and manual signup when temp users are refused — and historically every one of
 * them posted `puter.token` to the opener. The SDK's global message listener
 * feeds that straight into `setAuthToken()`, so posting it signs the site in.
 *
 * That is only what the user asked for when the popup's whole purpose was
 * signing in. `request-permission` popups must not do it: the user is deciding
 * about a single permission, not handing over their account. Posting the
 * failure message is just as unsafe, since its `token: null` would clobber a
 * token the site already holds.
 */

/** Popup actions that exist to answer a question, not to authenticate. */
const NON_AUTH_POPUP_ACTIONS = new Set(['request-permission']);

/**
 * Whether a popup running `action` may post `puter.token` to its opener.
 *
 * The token exchange itself still runs for the excluded actions — it bootstraps
 * the app row a permission grant needs and caches `host_app_uid` — only the
 * hand-off to the opener is suppressed.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if the token may be delivered to the opener.
 */
export const deliversTokenToOpener = (action) =>
    !NON_AUTH_POPUP_ACTIONS.has(action);

/**
 * Popup actions where the opener's origin *is* the requester's identity, rather
 * than just the address an answer is sent back to.
 */
const OPENER_IS_THE_REQUESTER_ACTIONS = new Set(['request-permission']);

/**
 * Whether a popup running `action` may take its opener's origin from the
 * `opener_origin` URL parameter.
 *
 * That parameter exists so a sign-in popup can carry the opener's origin across
 * an OIDC redirect, which drops the rest of the query. It is chosen by whoever
 * built the link, though, and for a permission prompt the opener's origin is the
 * requester's identity twice over: it is the name the dialog attributes the
 * request to, and it is what the server resolves into the app the grant is
 * written against. Honouring a link-supplied one would let any site prompt in
 * another app's name and commit the user's grant to it — the same hole that
 * `app_uid` was removed from this URL to close.
 *
 * So a permission popup takes only a browser-attested origin: `document.referrer`
 * or the opener's own reply to the `requestOrigin` handshake. Nothing is lost —
 * the SDK never sends this parameter, and the OIDC redirect it exists for drops
 * `action` too, so no permission flow can reach here through one.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if `opener_origin` may be believed.
 */
export const trustsOpenerOriginParam = (action) =>
    !OPENER_IS_THE_REQUESTER_ACTIONS.has(action);

/**
 * Whether a popup running `action` may offer federated (OIDC) sign-in.
 *
 * An OIDC hop navigates the popup away and the provider sends it back to a
 * redirect URI the server builds, which is hard-coded to `/action/sign-in`
 * (OIDCController's popup branch). The popup therefore comes back believing it
 * is a plain sign-in popup: it posts `puter.token` to the opener — which the
 * SDK's global listener feeds straight into `setAuthToken()` — and never runs
 * the action it was opened for. For a permission prompt that is the exact
 * outcome `deliversTokenToOpener` exists to prevent: the site is signed in
 * without asking, and the user is never shown the permission they were meant to
 * decide on (the request resolves as a denial).
 *
 * Nothing in the returned URL says what the popup was originally for, so the
 * popup cannot re-establish it. Restoring the action through the redirect is
 * also not enough on its own: the returning navigation's referrer is the
 * provider, not the opener, so `trustsOpenerOriginParam`'s browser-attested
 * origin would have to come from the `requestOrigin` handshake instead. Until
 * that exists, a popup whose purpose cannot survive the round trip does not
 * offer the round trip. Email sign-in stays in the window and works normally.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if OIDC buttons may be shown in this popup.
 */
export const offersFederatedSignInInPopup = (action) =>
    !NON_AUTH_POPUP_ACTIONS.has(action);
