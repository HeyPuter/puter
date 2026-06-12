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

export interface JWK {
    kid?: string;
    kty?: string;
    use?: string;
    [k: string]: unknown;
}

export interface JwksCacheEntry {
    keys: JWK[];
    fetchedAt: number;
}

/** Claims we read off a verified id_token. */
export interface IdTokenClaims {
    sub: string;
    email?: string;
    email_verified?: boolean;
    /** Microsoft: tenant id of the account's home tenant. */
    tid?: string;
    /**
     * Microsoft: "email domain owner verified" — true when the email's
     * domain is a verified domain of the issuing tenant. Opt-in claim,
     * configured on the Azure app registration.
     */
    xms_edov?: boolean;
}

export interface VerifyIdTokenOptions {
    /** From OIDC discovery. Verification is impossible without it. */
    jwksUri?: string;
    /** Expected `iss` claim (from discovery). */
    issuer?: string;
    /** Expected `aud` claim — the provider client id. */
    audience: string;
}

export interface VerifyIdTokenDeps {
    /** Caller-owned JWKS cache (keyed by jwks_uri), so keys survive calls. */
    cache: Map<string, JwksCacheEntry>;
    /** Injectable for tests; defaults to global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Injectable clock for tests; defaults to `Date.now`. */
    now?: () => number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Convert a JWK public key to a SPKI PEM, or null if it can't be imported. */
export const jwkToPem = (jwk: JWK): string | null => {
    try {
        const keyObject = crypto.createPublicKey({
            key: jwk as crypto.JsonWebKey,
            format: 'jwk',
        });
        return keyObject.export({ type: 'spki', format: 'pem' }).toString();
    } catch (e) {
        console.warn('[oidc] failed to import JWKS key', e);
        return null;
    }
};

const fetchJwks = async (
    jwksUri: string,
    fetchImpl: typeof fetch,
    now: () => number,
): Promise<JwksCacheEntry | null> => {
    try {
        const res = await fetchImpl(jwksUri);
        if (!res.ok) return null;
        const data = (await res.json()) as { keys?: JWK[] };
        if (!Array.isArray(data.keys)) return null;
        return { keys: data.keys, fetchedAt: now() };
    } catch (e) {
        console.warn('[oidc] JWKS fetch failed', e);
        return null;
    }
};

/**
 * Resolve a JWKS key by `kid` to a PEM public key. Responses are cached for an
 * hour; a cache miss on an unknown kid forces one refresh to handle provider
 * key rotation.
 */
export const getSigningKey = async (
    jwksUri: string,
    kid: string,
    deps: VerifyIdTokenDeps,
): Promise<string | null> => {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = deps.now ?? Date.now;

    let entry = deps.cache.get(jwksUri);
    const findKey = () => entry?.keys.find((k) => k.kid === kid) ?? null;

    let jwk = entry && now() - entry.fetchedAt < ONE_HOUR_MS ? findKey() : null;

    if (!jwk) {
        const fetched = await fetchJwks(jwksUri, fetchImpl, now);
        if (!fetched) return null;
        entry = fetched;
        deps.cache.set(jwksUri, entry);
        jwk = findKey();
    }

    if (!jwk) return null;
    return jwkToPem(jwk);
};

/**
 * Verify an id_token's signature against the provider's JWKS and return its
 * claims. Returns null if there's no jwks_uri, the signing key can't be found,
 * or signature/claim verification fails.
 *
 * Used for providers without a userinfo endpoint (e.g. Apple). The token
 * already arrives directly from the provider's token endpoint over TLS, so
 * this is defense-in-depth — but verifying the signature is the correct
 * behaviour rather than trusting an unverified base64 payload.
 */
export const verifyOidcIdToken = async (
    idToken: string,
    opts: VerifyIdTokenOptions,
    deps: VerifyIdTokenDeps,
): Promise<IdTokenClaims | null> => {
    if (!opts.jwksUri) {
        console.warn(
            '[oidc] id_token cannot be verified: provider has no jwks_uri',
        );
        return null;
    }

    const decoded = jwt.decode(idToken, { complete: true });
    const kid =
        decoded && typeof decoded === 'object'
            ? (decoded.header?.kid ?? null)
            : null;
    if (!kid) return null;

    // Multi-tenant Microsoft discovery returns the issuer as a template
    // ('https://login.microsoftonline.com/{tenantid}/v2.0'). Substitute the
    // token's own `tid` before verification — `jwt.verify` then enforces
    // that `iss` agrees with `tid`, and the signature check pins both to
    // the IdP.
    let issuer = opts.issuer;
    if (issuer?.includes('{tenantid}')) {
        const unverified =
            decoded && typeof decoded.payload === 'object'
                ? (decoded.payload as Record<string, unknown>)
                : null;
        const tid = unverified?.tid;
        if (
            typeof tid !== 'string' ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tid)
        ) {
            return null;
        }
        issuer = issuer.replace('{tenantid}', tid);
    }

    const pem = await getSigningKey(opts.jwksUri, kid, deps);
    if (!pem) return null;

    try {
        const payload = jwt.verify(idToken, pem, {
            algorithms: ['RS256', 'ES256'],
            audience: opts.audience,
            issuer,
        }) as Record<string, unknown>;
        return {
            sub: payload.sub as string,
            email: payload.email as string | undefined,
            email_verified: payload.email_verified as boolean | undefined,
            tid: payload.tid as string | undefined,
            // Documented as boolean; normalize string encodings defensively
            // so a representation change can't silently flip accounts to
            // unverified.
            xms_edov:
                payload.xms_edov === undefined
                    ? undefined
                    : payload.xms_edov === true ||
                      payload.xms_edov === 'true' ||
                      payload.xms_edov === '1',
        };
    } catch (e) {
        console.warn('[oidc] id_token verification failed', e);
        return null;
    }
};
