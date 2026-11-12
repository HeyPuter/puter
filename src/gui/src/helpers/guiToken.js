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

import { jwtPayload } from './jwtPayload.js';

/**
 * A token's claims as key-sorted `[key, value]` pairs in JSON, without `iat`.
 * Read without checking the signature, so it only says what the token claims.
 *
 * @param {unknown} token
 * @returns {string | null} null when the token isn't a readable JWT
 */
export const tokenClaimsKey = (token) => {
    const claims = typeof token === 'string' ? jwtPayload(token) : null;
    if ( ! claims || Array.isArray(claims) ) return null;
    return JSON.stringify(Object.keys(claims)
        .filter(key => key !== 'iat')
        .sort()
        .map(key => [key, claims[key]]));
};

/**
 * Whether two tokens claim exactly the same things apart from when they were
 * signed. Two GUI tokens that do are for the same session, user and type.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export const sameTokenClaims = (a, b) => {
    const key = tokenClaimsKey(a);
    return key !== null && key === tokenClaimsKey(b);
};

/**
 * The digest the shell sends as `guiTokenDigest`: SHA-256 of
 * {@link tokenClaimsKey}, first 32 hex chars. Must match
 * `TokenService.claimsDigest` on the server.
 *
 * @param {unknown} token
 * @param {SubtleCrypto | null} [subtle] - null on an insecure origin
 * @returns {Promise<string | null>} null when the token isn't readable or
 *   there is no SubtleCrypto
 */
export const tokenClaimsDigest = async (token, subtle = globalThis.crypto?.subtle) => {
    const key = tokenClaimsKey(token);
    if ( key === null || ! subtle ) return null;
    const hash = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(key)));
    return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
};

/**
 * Whether the server rendered this page for this load. A history navigation or
 * a restored tab can be a cached copy, rendered for a cookie that has changed.
 *
 * @param {Performance} [perf]
 * @returns {boolean}
 */
export const pageRenderedForThisLoad = (perf = globalThis.performance) => {
    const nav = perf?.getEntriesByType?.('navigation')?.[0];
    if ( ! nav ) return false;
    return (nav.type === 'navigate' || nav.type === 'reload') && nav.transferSize > 0;
};

/**
 * What boot does about `/get-gui-token`, which hands over a token for the
 * session cookie:
 * - `fetch`: ask for it.
 * - `same-session`: the stored token is already the one it would hand over.
 * - `no-session`: there is no session cookie, so it would refuse.
 *
 * Anything short of a `guiTokenDigest` from this very page load is `fetch`.
 *
 * @param {Object} opts
 * @param {Record<string, unknown> | undefined} opts.params - gui_params
 * @param {string | null} opts.storedToken
 * @param {boolean} opts.sameOrigin - whether the page and `/get-gui-token` share an origin
 * @param {boolean} opts.renderedForThisLoad - {@link pageRenderedForThisLoad}
 * @param {SubtleCrypto | null} [opts.subtle]
 * @returns {Promise<'fetch' | 'same-session' | 'no-session'>}
 */
export const guiTokenBootStep = async ({ params, storedToken, sameOrigin, renderedForThisLoad, subtle }) => {
    if ( ! params || ! Object.hasOwn(params, 'guiTokenDigest') ) return 'fetch';
    if ( ! sameOrigin || ! renderedForThisLoad ) return 'fetch';
    const hint = params.guiTokenDigest;
    if ( hint === null ) return 'no-session';
    if ( typeof hint !== 'string' || ! storedToken ) return 'fetch';
    return await tokenClaimsDigest(storedToken, subtle) === hint ? 'same-session' : 'fetch';
};
