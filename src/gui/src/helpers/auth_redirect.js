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
 * The `return_to` path to send along when starting an OIDC flow, or null if
 * the current page isn't one the backend will return to. The backend strictly
 * whitelists these (never a client-supplied URL): `/desktop`, `/dashboard`,
 * and direct app landings (`/app/<name>`), so OIDC login started from an app
 * landing comes back to the app.
 *
 * @returns {string|null} whitelistable pathname, or null
 */
export const get_oidc_return_to = () => {
    const pathname = window.location.pathname;
    if ( pathname === '/desktop' || pathname === '/dashboard' ) {
        return pathname;
    }
    // app landing: normalize away a trailing slash to match the backend whitelist
    if ( /^\/app\/[^/]+\/?$/.test(pathname) ) {
        return pathname.replace(/\/$/, '');
    }
    return null;
};
