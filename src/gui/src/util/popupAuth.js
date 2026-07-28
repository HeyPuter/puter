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

/*
 * On the `opener_origin` URL parameter, which used to be read here.
 *
 * The opener's origin is the requester's identity twice over: it is the name a
 * dialog attributes the request to, and it is what the server resolves into
 * the app a token is minted for and a grant written against. A URL parameter
 * is written by whoever built the link, so believing one let any site have a
 * token minted in another app's name — the same hole that `app_uid` was
 * removed from this URL to close.
 *
 * This module used to allow it for every action except `request-permission`.
 * That exclusion was a denylist, so it fell open for the case it most needed
 * to catch: a popup URL with no `action` at all was trusted, and an
 * action-less popup is also the one case that renders no consent UI. The
 * reasoning behind the denylist rested on a mistaken premise — that the OIDC
 * redirect "drops `action`", so a permission flow could never come back
 * through one. It does not; `OIDCController` hard-codes a return path of
 * `/action/sign-in`.
 *
 * The parameter is now believed for no action at all. The OIDC round trip it
 * existed for carries the opener's origin out of band instead — see
 * util/popupOidcHandoff.js — leaving only browser-attested sources:
 * `document.referrer`, the `requestOrigin` handshake, and that handoff.
 */

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
 * not enough on its own either — the permission prompt would still have to
 * re-attest its opener, since the returning navigation's referrer is the
 * provider. (util/popupOidcHandoff.js now carries an attested opener across
 * the hop, so this is closer to solvable than it was; the action itself still
 * has to survive.) Until then, a popup whose purpose cannot survive the round
 * trip does not offer the round trip. Email sign-in stays in the window and
 * works normally.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if OIDC buttons may be shown in this popup.
 */
export const offersFederatedSignInInPopup = (action) =>
    !NON_AUTH_POPUP_ACTIONS.has(action);
