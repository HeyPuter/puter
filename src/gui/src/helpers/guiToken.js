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
