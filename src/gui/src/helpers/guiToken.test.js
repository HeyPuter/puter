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

import { describe, expect, it } from 'vitest';
import { sameTokenClaims, tokenClaimsKey } from './guiToken.js';

const jwtWith = (claims) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const CLAIMS = { t: 'gui', v: '2', u: 'c2Vzc2lvbg==', su: 'c2Vzc2lvbg==', uu: 'dXNlcg==', ai: 'dXNlcg==' };
const TOKEN = jwtWith({ ...CLAIMS, iat: 1 });

describe('tokenClaimsKey', () => {
    it('sorts the claims and leaves out iat', () => {
        expect(tokenClaimsKey(jwtWith({ b: 1, a: 'x', iat: 5 }))).toBe('[["a","x"],["b",1]]');
    });

    it('is null for anything that is not a readable JWT', () => {
        expect(tokenClaimsKey('not-a-token')).toBe(null);
        expect(tokenClaimsKey(null)).toBe(null);
        expect(tokenClaimsKey(`h.${Buffer.from('[1]').toString('base64url')}.s`)).toBe(null);
    });
});

describe('sameTokenClaims', () => {
    it('is true for two tokens signed at different times for the same session', () => {
        expect(sameTokenClaims(TOKEN, jwtWith({ ...CLAIMS, iat: 2 }))).toBe(true);
    });

    it('is false when any other claim differs, is added or is missing', () => {
        expect(sameTokenClaims(TOKEN, jwtWith({ ...CLAIMS, su: 'b3RoZXI=', iat: 2 }))).toBe(false);
        expect(sameTokenClaims(TOKEN, jwtWith({ ...CLAIMS, uu: 'b3RoZXI=', iat: 2 }))).toBe(false);
        expect(sameTokenClaims(TOKEN, jwtWith({ ...CLAIMS, t: 's', iat: 2 }))).toBe(false);
        expect(sameTokenClaims(TOKEN, jwtWith({ ...CLAIMS, x: true, iat: 2 }))).toBe(false);
        const { ai, ...withoutAuthId } = CLAIMS;
        expect(sameTokenClaims(TOKEN, jwtWith({ ...withoutAuthId, iat: 2 }))).toBe(false);
    });

    it('is false when either token is unreadable', () => {
        expect(sameTokenClaims('garbage', 'garbage')).toBe(false);
        expect(sameTokenClaims(TOKEN, null)).toBe(false);
        expect(sameTokenClaims(null, null)).toBe(false);
    });
});
