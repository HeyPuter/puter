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

import parse_shared_path, {
    SHARED_PATH_PARAM,
    SHARE_RECIPIENT_PARAM,
    shared_link_recipient_uuid,
} from './parseSharedPath.js';

/**
 * Where to send the user after a successful login/signup started from the
 * current page. Keeps the user on the page they authenticated from — most
 * importantly direct app landings (`/app/<name>`), so they end up in the app
 * they came for instead of the dashboard.
 *
 * Standalone auth pages (`/action/login`, `/action/signup`, ...) have no page
 * to return to, so they go to the root dashboard. Auth-flow query params
 * (`action`, `auth_error`) are stripped so the reload doesn't re-open the
 * auth window it just completed.
 *
 * @returns {string} URL to redirect to after successful authentication
 */
export const get_auth_redirect_url = () => {
    const url = new URL(window.location.href);
    const path_parts = url.pathname.split('/').filter(part => part);
    if ( path_parts[0]?.toLowerCase() === 'action' ) {
        return '/';
    }
    if ( url.searchParams.has('auth_error') ) {
        // OIDC error companions (see buildErrorRedirectUrl on the backend);
        // `message` is only stripped alongside auth_error since on its own it
        // may be a legitimate app param
        url.searchParams.delete('message');
        url.searchParams.delete('request_code');
    }
    url.searchParams.delete('action');
    url.searchParams.delete('auth_error');
    return url.toString();
};

/**
 * The pathname part of an OIDC `return_to`, or null when the current page isn't
 * one the backend will return to. The root is in here only for the share links
 * below — on its own it is where the flow already lands.
 *
 * @returns {string|null}
 */
const oidc_return_path = () => {
    const pathname = window.location.pathname;
    if ( pathname === '/' || pathname === '/desktop' || pathname === '/dashboard' ) {
        return pathname;
    }
    // app landing: normalize away a trailing slash to match the backend whitelist
    if ( /^(\/desktop)?\/app\/[^/]+\/?$/.test(pathname) ) {
        return pathname.replace(/\/$/, '');
    }
    return null;
};

/**
 * The `return_to` to send along when starting an OIDC flow, or null if the
 * current page isn't one the backend will return to. The backend strictly
 * whitelists these (never a client-supplied URL): `/desktop`, `/dashboard`,
 * and direct app landings (`/app/<name>`, plus the desktop-booted
 * `/desktop/app/<name>`), so OIDC login started from an app landing comes back
 * to the app — and to the same interface it was opened in.
 *
 * A share link (`?shared=`, from an email) is carried along with the path: the
 * recipient usually has to sign in before they can see what was shared, and an
 * OIDC round trip leaves the origin, so the parameter has to travel through the
 * flow or they come back to a bare Home. Only well-formed values go — the
 * backend refuses the rest, and a hand-edited link is no one's destination.
 *
 * @returns {string|null} whitelistable path, with its share items, or null
 */
export const get_oidc_return_to = () => {
    const path = oidc_return_path();
    if ( path === null ) return null;

    const shared = new URLSearchParams(window.location.search ?? '')
        .getAll(SHARED_PATH_PARAM)
        .filter(value => parse_shared_path(value) !== null);
    if ( shared.length === 0 ) {
        // The root is only a destination when it names something.
        return path === '/' ? null : path;
    }

    const params = new URLSearchParams();
    for ( const value of shared ) params.append(SHARED_PATH_PARAM, value);
    const recipient_uuid = shared_link_recipient_uuid(
        new URLSearchParams(window.location.search ?? ''),
    );
    if ( recipient_uuid ) params.set(SHARE_RECIPIENT_PARAM, recipient_uuid);
    return `${path}?${params.toString()}`;
};


/**
 * The start route a provider button sends the browser to, carrying what the
 * flow needs to come back to this page (and, in a popup, to its opener).
 *
 * @param {{ provider: string, flow: 'login' | 'signup', referrer?: string | null, loginHint?: string | null }} opts
 */
export const oidcStartUrl = ({ provider, flow, referrer, loginHint }) => {
    let url = `${window.gui_origin}/auth/oidc/${provider}/start?flow=${flow}`;
    // return to the interface the flow started from (backend whitelists the path)
    const return_to = get_oidc_return_to();
    if ( return_to ) url += `&return_to=${encodeURIComponent(return_to)}`;
    if ( referrer ) url += `&referrer=${encodeURIComponent(referrer)}`;
    // A provider login can create the account, so a signup link's code rides along.
    if ( window.signup_bonus_code ) {
        url += `&bonusCode=${encodeURIComponent(window.signup_bonus_code)}`;
    }
    if ( loginHint ) url += `&login_hint=${encodeURIComponent(loginHint)}`;
    const msg_id = window.url_query_params?.get('msg_id');
    if ( window.embedded_in_popup && msg_id ) {
        url += `&embedded_in_popup=true&msg_id=${encodeURIComponent(msg_id)}`;
        if ( window.openerOrigin ) {
            url += `&opener_origin=${encodeURIComponent(window.openerOrigin)}`;
        }
    }
    return url;
};

/** Capture a provider challenge before boot code can retain its URL. */
export const takeOidcLoginChallenge = () => {
    const url = new URL(window.location.href);
    const paths = url.pathname.split('/').filter(Boolean);
    if (paths[0]?.toLowerCase() === 'desktop') paths.shift();
    const action = paths[0]?.toLowerCase() === 'action'
        ? paths[1] : url.searchParams.get('action');
    if (action?.toLowerCase() !== 'oidc-2fa') return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    url.hash = '';
    window.history.replaceState(null, document.title, url.pathname + url.search);
    let retryUrl = '/action/login';
    try {
        const retry = new URL(fragment.get('retryUrl'), url.origin);
        if (retry.origin === url.origin && (
            retry.pathname === '/action/login' || retry.searchParams.get('action') === 'login'
        )) retryUrl = retry.href;
    } catch { /* Missing or malformed retry context returns to ordinary login. */ }
    return { token: fragment.get('token'), retryUrl };
};

/** Capture a sign-in link's token before boot code can retain its URL. */
export const takeMagicLinkToken = () => {
    const url = new URL(window.location.href);
    const paths = url.pathname.split('/').filter(Boolean);
    if ( paths[0]?.toLowerCase() === 'desktop' ) paths.shift();
    if ( paths[0]?.toLowerCase() !== 'action' || paths[1]?.toLowerCase() !== 'magic-link' ) {
        return null;
    }
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    url.hash = '';
    window.history.replaceState(null, document.title, url.pathname + url.search);
    return token || null;
};
