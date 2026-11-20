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

import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    guiTokenBootStep,
    pageRenderedForThisLoad,
    sameTokenClaims,
    tokenClaimsDigest,
    tokenClaimsKey,
} from './guiToken.js';

const jwtWith = (claims) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const CLAIMS = { t: 'gui', v: '2', u: 'c2Vzc2lvbg==', su: 'c2Vzc2lvbg==', uu: 'dXNlcg==', ai: 'dXNlcg==' };
const TOKEN = jwtWith({ ...CLAIMS, iat: 1 });
const subtle = webcrypto.subtle;

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

describe('tokenClaimsDigest', () => {
    it('is the first 32 hex chars of SHA-256 over the claims key', async () => {
        const expected = createHash('sha256').update(tokenClaimsKey(TOKEN)).digest('hex').slice(0, 32);
        expect(await tokenClaimsDigest(TOKEN, subtle)).toBe(expected);
        expect(await tokenClaimsDigest(jwtWith({ ...CLAIMS, iat: 9 }), subtle)).toBe(expected);
    });

    it('is null without SubtleCrypto or a readable token', async () => {
        expect(await tokenClaimsDigest(TOKEN, null)).toBe(null);
        expect(await tokenClaimsDigest('garbage', subtle)).toBe(null);
    });
});

describe('pageRenderedForThisLoad', () => {
    const perfWith = (entry) => ({ getEntriesByType: (type) => (type === 'navigation' && entry ? [entry] : []) });

    it('is true for a navigation or reload the server answered', () => {
        expect(pageRenderedForThisLoad(perfWith({ type: 'navigate', transferSize: 900 }))).toBe(true);
        expect(pageRenderedForThisLoad(perfWith({ type: 'reload', transferSize: 300 }))).toBe(true);
    });

    it('is false for a history navigation, a cached copy, or no timing at all', () => {
        expect(pageRenderedForThisLoad(perfWith({ type: 'back_forward', transferSize: 900 }))).toBe(false);
        expect(pageRenderedForThisLoad(perfWith({ type: 'navigate', transferSize: 0 }))).toBe(false);
        expect(pageRenderedForThisLoad(perfWith({ type: 'navigate' }))).toBe(false);
        expect(pageRenderedForThisLoad(perfWith(null))).toBe(false);
        expect(pageRenderedForThisLoad({})).toBe(false);
        expect(pageRenderedForThisLoad(undefined)).toBe(false);
    });
});

describe('guiTokenBootStep', () => {
    const step = async (overrides) => guiTokenBootStep({
        params: { guiTokenDigest: await tokenClaimsDigest(TOKEN, subtle) },
        storedToken: jwtWith({ ...CLAIMS, iat: 3 }),
        sameOrigin: true,
        renderedForThisLoad: true,
        subtle,
        ...overrides,
    });

    it('keeps the stored token when the shell names its session', async () => {
        expect(await step({})).toBe('same-session');
    });

    it('skips the request when the shell says there is no session cookie', async () => {
        expect(await step({ params: { guiTokenDigest: null } })).toBe('no-session');
        expect(await step({ params: { guiTokenDigest: null }, storedToken: null })).toBe('no-session');
    });

    it('asks when the shell names another session or nothing is stored', async () => {
        expect(await step({ storedToken: jwtWith({ ...CLAIMS, su: 'b3RoZXI=' }) })).toBe('fetch');
        expect(await step({ storedToken: null })).toBe('fetch');
        expect(await step({ params: { guiTokenDigest: 42 } })).toBe('fetch');
    });

    it('asks whenever the shell\'s word can\'t be taken', async () => {
        // An older server, or one that couldn't tell.
        expect(await step({ params: {} })).toBe('fetch');
        expect(await step({ params: undefined })).toBe('fetch');
        expect(await step({ sameOrigin: false })).toBe('fetch');
        expect(await step({ renderedForThisLoad: false })).toBe('fetch');
        expect(await step({ renderedForThisLoad: false, params: { guiTokenDigest: null } })).toBe('fetch');
        expect(await step({ subtle: null })).toBe('fetch');
    });
});
