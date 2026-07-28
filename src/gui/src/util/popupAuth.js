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
 * The only popup actions an OIDC return leg produces, and therefore the only
 * ones that have any reason to carry `opener_origin` in the URL.
 *
 * `OIDCController` builds exactly two kinds of popup return URL: the success
 * leg, hard-coded to `/action/sign-in`, and the error leg, whose `action` is
 * the flow it is retrying (`OIDC_ERROR_REDIRECT_MAP` maps login/signup onto
 * each other; `revalidate` maps to itself).
 */
const OIDC_RETURN_ACTIONS = new Set([
    'sign-in',
    'login',
    'signup',
    'revalidate',
]);

/**
 * Whether a popup running `action` may take its opener's origin from the
 * `opener_origin` URL parameter.
 *
 * That parameter exists for one reason: an OIDC redirect drops the rest of the
 * query and returns the popup with the *provider* as its referrer, so the
 * opener's origin has to be carried across somehow. Outside that round trip
 * there is nothing for it to do, and believing it is actively unsafe — the
 * opener's origin is the requester's identity twice over. It is the name a
 * dialog attributes the request to, and it is what the server resolves into
 * the app a token is minted for and a grant written against. A link-supplied
 * one lets any site have a token minted in another app's name — the same hole
 * that `app_uid` was removed from this URL to close.
 *
 * This was previously a denylist of one action (`request-permission`), which
 * fell open on exactly the case it most needed to catch: a popup URL with no
 * `action` at all was trusted, and an action-less popup is also the one shape
 * that renders no consent UI. The reasoning behind the denylist rested on a
 * mistaken premise — that the OIDC redirect "drops `action`", so no other flow
 * could return through one. It does not; the return path is `/action/sign-in`.
 *
 * So this is an allowlist. Anything not on it — an action-less popup,
 * `request-permission`, a file picker — takes only a browser-attested origin:
 * `document.referrer`, or the opener's own reply to the `requestOrigin`
 * handshake. Nothing is lost: the SDK never sends this parameter.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if `opener_origin` may be believed.
 */
export const trustsOpenerOriginParam = (action) =>
    OIDC_RETURN_ACTIONS.has(action);

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
 * provider, not the opener, so the prompt's browser-attested origin would have
 * to come from the `requestOrigin` handshake instead — `request-permission` is
 * not on `OIDC_RETURN_ACTIONS`, so the URL parameter cannot stand in for it.
 * Until that exists, a popup whose purpose cannot survive the round trip does
 * not offer the round trip. Email sign-in stays in the window and works
 * normally.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if OIDC buttons may be shown in this popup.
 */
export const offersFederatedSignInInPopup = (action) =>
    !NON_AUTH_POPUP_ACTIONS.has(action);
