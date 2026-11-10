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
import { isTokenForAnotherUser } from './tokenUser.js';

const ALICE = '5d4adce0-a381-4982-9c02-6e2540026238';
const BOB = 'a1b2c3d4-0000-4000-8000-00000000beef';

const jwtWith = (claims) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
// The claim as the server writes it: the uuid's bytes in base64.
const tokenFor = (uuid) =>
    jwtWith({ uu: Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64') });

describe('isTokenForAnotherUser', () => {
    it('is true for a token issued to a different user', () => {
        expect(isTokenForAnotherUser(tokenFor(BOB), { uuid: ALICE })).toBe(true);
    });

    it('is false for a token issued to the same user', () => {
        expect(isTokenForAnotherUser(tokenFor(ALICE), { uuid: ALICE })).toBe(false);
    });

    it('compares uuids regardless of letter case', () => {
        expect(isTokenForAnotherUser(tokenFor(ALICE), { uuid: ALICE.toUpperCase() })).toBe(false);
    });

    it('reads a claim that holds the dashed uuid itself', () => {
        expect(isTokenForAnotherUser(jwtWith({ uu: BOB }), { uuid: ALICE })).toBe(true);
        expect(isTokenForAnotherUser(jwtWith({ uu: ALICE }), { uuid: ALICE })).toBe(false);
    });

    it('is false when no user is signed in here', () => {
        expect(isTokenForAnotherUser(tokenFor(BOB), null)).toBe(false);
        expect(isTokenForAnotherUser(tokenFor(BOB), undefined)).toBe(false);
        expect(isTokenForAnotherUser(tokenFor(BOB), {})).toBe(false);
    });

    it('is false when the token does not name a user', () => {
        for ( const token of [
            jwtWith({}),
            jwtWith({ uu: '' }),
            jwtWith({ uu: 42 }),
            jwtWith({ uu: 'AAAA' }),
            jwtWith({ uu: '!!not base64!!' }),
            'not-a-jwt',
            '',
        ] ) {
            expect(isTokenForAnotherUser(token, { uuid: ALICE })).toBe(false);
        }
    });
});
