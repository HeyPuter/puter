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
 * Validation for `puter.ui.setURLParams()` — the query string an app is
 * allowed to put on its own `/app/<name>` URL. This runs on the trust
 * boundary: apps can postMessage without going through puter.js, so the
 * SDK's own checks count for nothing and this is the authority.
 */

/**
 * Query-string keys an app may NOT set. Every name here is interpreted by
 * Puter itself on some landing (session bootstrap, boot-mode selection,
 * URL-launch flows, popup/picker flows, or the server that renders the
 * page) — letting an app write them would turn its shareable URL into a
 * session-fixation, flow-hijacking, or boot-breaking link the moment
 * someone reopens it: `auth_token` logs the visitor into an arbitrary
 * session, `api_origin` points token traffic at an arbitrary server,
 * `embedded_in_popup` diverts boot into the popup-auth path, and
 * `error_from_within_iframe` makes the backend serve an error page
 * instead of Puter.
 *
 * AUDIT RULE when adding a query param anywhere in Puter: this must cover
 * every read of the incoming query string, NOT just `url_query_params` —
 * boot-mode code parses `location.search` directly before that global
 * exists (initgui.js), and PuterHomepageService reads `req.query`
 * server-side. `puter.`-prefixed names are reserved wholesale below.
 *
 * `posargs` is deliberately NOT reserved: it only feeds command-line args
 * back to the same app, which is the point of a deep link.
 * @type {Set<string>}
 */
export const APP_URL_RESERVED_PARAMS = new Set([
    'action', 'allowed_file_types', 'api_origin', 'app', 'app_uid',
    'attempt_temp_user_creation', 'auth_error', 'auth_token', 'c',
    'cross_origin_isolated', 'download', 'embedded_in_popup', 'error',
    'error_from_within_iframe', 'maximized', 'message', 'msg_id',
    'oidc_login', 'oidc_switched', 'opener_origin', 'options', 'origin',
    'path', 'permission', 'readURL', 'redirectURL', 'ref', 'request_auth',
    'request_code', 'signin_session', 'token', 'user',
]);

export const APP_URL_PARAMS_MAX_COUNT = 32;
export const APP_URL_PARAMS_MAX_LENGTH = 2048;

/**
 * Serialize an app's requested URL params into a query string, or report
 * why they can't be. `URLSearchParams` does the percent-encoding, which is
 * what keeps a value from smuggling in a path, a hash, or extra params.
 * @param {unknown} params
 * @returns {{ query: string } | { code: string, message: string }}
 */
export const serializeAppURLParams = (params) => {
    if ( params === null || typeof params !== 'object' || Array.isArray(params) ) {
        return { code: 'params_invalid', message: 'params must be a plain object of key/value pairs.' };
    }
    const entries = Object.entries(params);
    if ( entries.length > APP_URL_PARAMS_MAX_COUNT ) {
        return {
            code: 'params_too_many',
            message: `too many params (${entries.length}); the maximum is ${APP_URL_PARAMS_MAX_COUNT}.`,
        };
    }
    const clean = new URLSearchParams();
    for ( const [key, value] of entries ) {
        if ( key === '' ) {
            return { code: 'params_invalid', message: 'param keys must be non-empty strings.' };
        }
        if ( key.startsWith('puter.') ) {
            return {
                code: 'param_reserved',
                message: `"${key}" is reserved: params prefixed "puter." belong to the launch protocol.`,
            };
        }
        if ( APP_URL_RESERVED_PARAMS.has(key) ) {
            return {
                code: 'param_reserved',
                message: `"${key}" is reserved: Puter itself interprets it on page load.`
                    + ' Prefix your own params to avoid collisions.',
            };
        }
        if ( typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' ) {
            return { code: 'value_invalid', message: `value of "${key}" must be a string, number, or boolean.` };
        }
        clean.append(key, String(value));
    }
    const query = clean.toString();
    if ( query.length > APP_URL_PARAMS_MAX_LENGTH ) {
        return {
            code: 'params_too_long',
            message: `serialized params are ${query.length} characters;`
                + ` the maximum is ${APP_URL_PARAMS_MAX_LENGTH}.`,
        };
    }
    return { query };
};
