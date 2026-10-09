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
const NON_AUTH_POPUP_ACTIONS = new Set(['request-permission', 'send-feedback']);

/**
 * Popup actions that exist to sign the user in to the opener, besides a plain
 * sign-in popup (no action). `login` and `signup` are where a failed OIDC hop
 * lands.
 */
const SIGN_IN_POPUP_ACTIONS = new Set(['sign-in', 'login', 'signup']);

const isSignInPopup = (action) =>
    !action || SIGN_IN_POPUP_ACTIONS.has(action);

/**
 * Whether a popup running `action` may post `puter.token` to its opener.
 *
 * Only sign-in popups and the pickers do. For `request-permission` the token
 * exchange itself still runs — it bootstraps the app row a permission grant
 * needs and caches `host_app_uid` — only the hand-off to the opener is
 * suppressed. Any other action hands over nothing.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if the token may be delivered to the opener.
 */
export const deliversTokenToOpener = (action) =>
    isSignInPopup(action) || defersTokenToOpener(action);

/** Popup actions whose token travels with the answer the user gave. */
const DEFERRED_TOKEN_POPUP_ACTIONS = new Set([
    'show-open-file-picker',
    'show-directory-picker',
    'show-save-file-picker',
]);

/**
 * Whether a popup running `action` holds its token back until it has an answer.
 *
 * @param {string|null|undefined} action
 * @returns {boolean} `true` if the hand-off waits for the picker's answer.
 */
export const defersTokenToOpener = (action) =>
    DEFERRED_TOKEN_POPUP_ACTIONS.has(action);

/**
 * The one gate every boot-time hand-off reads, exchange to signup. A popup
 * this is true for must also have the user's consent before it hands over.
 *
 * @param {string|null|undefined} action
 * @returns {boolean} `true` if booting is enough to deliver the token.
 */
export const deliversTokenAtBoot = (action) =>
    deliversTokenToOpener(action) && !defersTokenToOpener(action);

/**
 * Whether the opener's existing relationship with the user stands in for
 * consent. Only when no account picker was shown: a dismissed picker is a no.
 *
 * @param {{ hasRelationship: boolean, showedAccountPicker: boolean }} state
 * @returns {boolean}
 */
export const relationshipIsConsent = ({ hasRelationship, showedAccountPicker }) =>
    hasRelationship && !showedAccountPicker;

/**
 * Whether a popup running `action` runs the user-app token exchange.
 *
 * The exchange (`/auth/get-user-app-token`) is a write, not a read: it
 * bootstraps an app row for the opener origin, grants
 * `flag:app-is-authenticated` (what makes the site count as connected to the
 * account), and creates the app's per-user AppData directory. Sign-in and
 * file-picker popups need that, and `request-permission` needs the
 * bootstrapped app row a grant is written against. Nothing else runs it: a
 * send-feedback popup only ever *reads* app identity from its attested origin
 * server-side, and any other action has no use for a token.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if the exchange should run for this popup.
 */
export const runsUserAppTokenExchange = (action) =>
    deliversTokenToOpener(action) || action === 'request-permission';

/*
 * On the `opener_origin` URL parameter, which this module used to gate.
 *
 * The opener's origin is the requester's identity twice over: it is the name a
 * dialog attributes the request to, and it is what the server resolves into
 * the app a token is minted for and a grant written against. It only ever
 * appeared in the URL to survive an OIDC redirect, which drops the rest of the
 * query and returns the popup with the *provider* as its referrer.
 *
 * The gate here was a denylist of one action (`request-permission`), so it fell
 * open on exactly the case it most needed to catch: a popup URL with no
 * `action` at all was trusted, and an action-less popup is also the one shape
 * that renders no consent UI. Any site could then have a token minted in
 * another app's name with a single navigation. The reasoning behind the
 * denylist rested on a mistaken premise — that the OIDC redirect "drops
 * `action`", so no other flow could return through one. It does not; the
 * return path is hard-coded to `/action/sign-in`.
 *
 * No action believes the raw parameter now, so there is nothing left to gate.
 * The OIDC round trip carries the value in the signed `state` it always did,
 * and the return leg re-signs it as `opener_state` for the popup to redeem —
 * see util/popupOidcReturn.js. That leaves only sources the browser or the
 * server vouches for: `document.referrer`, the `requestOrigin` handshake, and
 * that proof.
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
 * also not enough on its own: the returning navigation's referrer is the
 * provider, not the opener, so the prompt would have to re-attest its opener
 * from the `requestOrigin` handshake or the `opener_state` proof. Until that
 * exists, a popup whose purpose cannot survive the round trip does not offer
 * the round trip. Email sign-in stays in the window and works normally.
 *
 * @param {string|null|undefined} action - The popup's `action`, as parsed from
 *   the URL (`/action/<name>` or `?action=<name>`); undefined for a plain
 *   sign-in popup.
 * @returns {boolean} `true` if OIDC buttons may be shown in this popup.
 */
export const offersFederatedSignInInPopup = (action) =>
    !NON_AUTH_POPUP_ACTIONS.has(action);
