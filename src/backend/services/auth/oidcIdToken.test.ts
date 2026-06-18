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

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    jwkToPem,
    verifyOidcIdToken,
    type JWK,
    type JwksCacheEntry,
} from './oidcIdToken';

// Real RSA key + matching JWK, generated once. We sign tokens with the private
// key and serve the public JWK over a fake fetch — exercising the actual
// crypto/verify path, mocking only the HTTP boundary (JWKS endpoint).

const JWKS_URI = 'https://provider.example/.well-known/jwks.json';
const ISSUER = 'https://provider.example';
const AUDIENCE = 'client-abc';
const KID = 'key-1';

let privateKey: crypto.KeyObject;
let jwk: JWK;

beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    jwk = {
        ...(pair.publicKey.export({ format: 'jwk' }) as JWK),
        kid: KID,
    };
});

const signToken = (
    overrides: {
        kid?: string;
        audience?: string;
        issuer?: string;
        key?: crypto.KeyObject;
        payload?: Record<string, unknown>;
    } = {},
): string =>
    jwt.sign({ email: 'a@b.com', email_verified: true, ...overrides.payload }, overrides.key ?? privateKey, {
        algorithm: 'RS256',
        keyid: overrides.kid ?? KID,
        subject: 'user-123',
        audience: overrides.audience ?? AUDIENCE,
        issuer: overrides.issuer ?? ISSUER,
    });

// Fake fetch that serves a JWKS body and counts how many times it was hit.
const makeFetch = (keys: JWK[], ok = true) => {
    let calls = 0;
    const fetchImpl = (async () => {
        calls++;
        return { ok, json: async () => ({ keys }) } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
};

const deps = (
    fetchImpl: typeof fetch,
    cache: Map<string, JwksCacheEntry> = new Map(),
    now?: () => number,
) => ({ cache, fetchImpl, now });

const opts = { jwksUri: JWKS_URI, issuer: ISSUER, audience: AUDIENCE };

describe('jwkToPem', () => {
    it('converts a valid JWK to a SPKI PEM', () => {
        const pem = jwkToPem(jwk);
        expect(pem).toMatch(/-----BEGIN PUBLIC KEY-----/);
    });

    it('returns null for an unusable JWK', () => {
        expect(jwkToPem({ kid: 'x', kty: 'nonsense' })).toBeNull();
    });
});

describe('verifyOidcIdToken', () => {
    it('returns claims for a correctly signed token', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken(),
            opts,
            deps(fetchImpl),
        );
        expect(claims).toEqual({
            sub: 'user-123',
            email: 'a@b.com',
            email_verified: true,
        });
    });

    it('rejects a token signed by a different key', async () => {
        const other = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
        }).privateKey;
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({ key: other }),
            opts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('rejects a token with the wrong audience', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({ audience: 'someone-else' }),
            opts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('rejects a token with the wrong issuer', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({ issuer: 'https://evil.example' }),
            opts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('returns null when no jwks_uri is configured', async () => {
        const { fetchImpl, calls } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken(),
            { ...opts, jwksUri: undefined },
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
        expect(calls()).toBe(0);
    });

    it('returns null when the JWKS has no key matching the token kid', async () => {
        const { fetchImpl } = makeFetch([{ ...jwk, kid: 'different-kid' }]);
        const claims = await verifyOidcIdToken(
            signToken(),
            opts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('returns null when the JWKS fetch fails', async () => {
        const { fetchImpl } = makeFetch([], false);
        const claims = await verifyOidcIdToken(
            signToken(),
            opts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('caches the JWKS across calls (only fetches once)', async () => {
        const { fetchImpl, calls } = makeFetch([jwk]);
        const cache = new Map<string, JwksCacheEntry>();
        await verifyOidcIdToken(signToken(), opts, deps(fetchImpl, cache));
        await verifyOidcIdToken(signToken(), opts, deps(fetchImpl, cache));
        expect(calls()).toBe(1);
    });

    it('refetches once when a cached entry lacks the requested kid (key rotation)', async () => {
        const cache = new Map<string, JwksCacheEntry>();
        // Seed the cache with a stale keyset that doesn't include KID.
        cache.set(JWKS_URI, {
            keys: [{ ...jwk, kid: 'old-kid' }],
            fetchedAt: 1_000,
        });
        const { fetchImpl, calls } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken(),
            opts,
            deps(fetchImpl, cache, () => 2_000),
        );
        expect(claims).not.toBeNull();
        expect(calls()).toBe(1);
    });

    it('refetches when the cached entry is older than the TTL', async () => {
        const cache = new Map<string, JwksCacheEntry>();
        cache.set(JWKS_URI, { keys: [jwk], fetchedAt: 0 });
        const { fetchImpl, calls } = makeFetch([jwk]);
        // now is 2h past fetchedAt -> stale -> refetch.
        await verifyOidcIdToken(
            signToken(),
            opts,
            deps(fetchImpl, cache, () => 2 * 60 * 60 * 1000),
        );
        expect(calls()).toBe(1);
    });
});

// Multi-tenant Microsoft discovery returns the issuer as a template with a
// literal '{tenantid}' placeholder; the verifier substitutes the token's own
// `tid` claim so that `iss` and `tid` must agree.
describe('verifyOidcIdToken with a {tenantid} issuer template', () => {
    const TEMPLATE_ISSUER = 'https://login.microsoftonline.com/{tenantid}/v2.0';
    const TID = '3a8757eb-bf01-4b5d-83b2-90e0eaf21d10';
    const tenantIssuer = `https://login.microsoftonline.com/${TID}/v2.0`;
    const templateOpts = {
        jwksUri: JWKS_URI,
        issuer: TEMPLATE_ISSUER,
        audience: AUDIENCE,
    };

    it('accepts a token whose iss matches its own tid, and passes tid/xms_edov through', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({
                issuer: tenantIssuer,
                payload: { tid: TID, xms_edov: true },
            }),
            templateOpts,
            deps(fetchImpl),
        );
        expect(claims).toEqual({
            sub: 'user-123',
            email: 'a@b.com',
            email_verified: true,
            tid: TID,
            xms_edov: true,
        });
    });

    it('rejects a token whose iss names a different tenant than its tid', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({
                issuer:
                    'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
                payload: { tid: TID },
            }),
            templateOpts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('rejects a token whose tid is not a UUID (no substitution into the issuer)', async () => {
        const { fetchImpl, calls } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({
                issuer: 'https://login.microsoftonline.com/evil/v2.0',
                payload: { tid: 'evil' },
            }),
            templateOpts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
        expect(calls()).toBe(0);
    });

    it('rejects a token with no tid claim at all', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({ issuer: tenantIssuer }),
            templateOpts,
            deps(fetchImpl),
        );
        expect(claims).toBeNull();
    });

    it('normalizes a string-encoded xms_edov to boolean', async () => {
        const { fetchImpl } = makeFetch([jwk]);
        const claims = await verifyOidcIdToken(
            signToken({
                issuer: tenantIssuer,
                payload: { tid: TID, xms_edov: 'true' },
            }),
            templateOpts,
            deps(fetchImpl),
        );
        expect(claims?.xms_edov).toBe(true);
    });
});
