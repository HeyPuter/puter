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

import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { TokenService, V1TokensDisabledError } from './TokenService.js';

const V2_SECRET = 'test-v2-secret';
const V1_SECRET = 'test-v1-secret';

function createTokenService(
    overrides: {
        jwt_secret_v2?: string;
    } = {},
): TokenService {
    const config = {
        jwt_secret_v2: V2_SECRET,
        ...overrides,
    } as ConstructorParameters<typeof TokenService>[0];
    const [clients, stores, services] = [{}, {}, {}] as [
        ConstructorParameters<typeof TokenService>[1],
        ConstructorParameters<typeof TokenService>[2],
        ConstructorParameters<typeof TokenService>[3],
    ];
    const svc = new TokenService(config, clients, stores, services);
    svc.onServerStart();
    return svc;
}

/**
 * Hand-mint a token in the retired v1 shape: no `kid` header, signed with the
 * secret that used to verify it.
 */
function mintV1Token(payload: Record<string, unknown>): string {
    return jwt.sign(payload, V1_SECRET);
}

describe('TokenService.onServerStart', () => {
    it('refuses to start without jwt_secret_v2', () => {
        const config = {} as ConstructorParameters<typeof TokenService>[0];
        const [clients, stores, services] = [{}, {}, {}] as [
            ConstructorParameters<typeof TokenService>[1],
            ConstructorParameters<typeof TokenService>[2],
            ConstructorParameters<typeof TokenService>[3],
        ];
        const svc = new TokenService(config, clients, stores, services);
        expect(() => svc.onServerStart()).toThrow(/jwt_secret_v2/);
    });

    it('refuses to start outside dev with the placeholder secrets from config.default.json', () => {
        const config = {
            env: 'prod',
            jwt_secret_v2: 'dev-jwt-secret-v2-change-me',
        } as ConstructorParameters<typeof TokenService>[0];
        const [clients, stores, services] = [{}, {}, {}] as [
            ConstructorParameters<typeof TokenService>[1],
            ConstructorParameters<typeof TokenService>[2],
            ConstructorParameters<typeof TokenService>[3],
        ];
        const svc = new TokenService(config, clients, stores, services);
        expect(() => svc.onServerStart()).toThrow(/placeholder/);
    });

    it('refuses to start outside dev with the placeholder url_signature_secret', () => {
        const config = {
            env: 'prod',
            jwt_secret_v2: 'a-real-v2-secret',
            url_signature_secret: 'dev-url-signature-secret-change-me',
        } as ConstructorParameters<typeof TokenService>[0];
        const [clients, stores, services] = [{}, {}, {}] as [
            ConstructorParameters<typeof TokenService>[1],
            ConstructorParameters<typeof TokenService>[2],
            ConstructorParameters<typeof TokenService>[3],
        ];
        const svc = new TokenService(config, clients, stores, services);
        expect(() => svc.onServerStart()).toThrow(
            /url_signature_secret.*placeholder/,
        );
    });

    it('allows a real non-dev secret that merely contains "change-me"', () => {
        // The guard matches the exact shipped placeholders, not the
        // "change-me" substring, so an operator's high-entropy secret that
        // happens to include those characters must not be refused.
        const config = {
            env: 'prod',
            jwt_secret_v2: 'kf83-change-me-not-the-placeholder-9af2',
            url_signature_secret: 'another-real-secret',
        } as ConstructorParameters<typeof TokenService>[0];
        const [clients, stores, services] = [{}, {}, {}] as [
            ConstructorParameters<typeof TokenService>[1],
            ConstructorParameters<typeof TokenService>[2],
            ConstructorParameters<typeof TokenService>[3],
        ];
        const svc = new TokenService(config, clients, stores, services);
        expect(() => svc.onServerStart()).not.toThrow();
    });

    it('allows the placeholder secrets in dev', () => {
        const config = {
            env: 'dev',
            jwt_secret_v2: 'dev-jwt-secret-v2-change-me',
            url_signature_secret: 'dev-url-signature-secret-change-me',
        } as ConstructorParameters<typeof TokenService>[0];
        const [clients, stores, services] = [{}, {}, {}] as [
            ConstructorParameters<typeof TokenService>[1],
            ConstructorParameters<typeof TokenService>[2],
            ConstructorParameters<typeof TokenService>[3],
        ];
        const svc = new TokenService(config, clients, stores, services);
        expect(() => svc.onServerStart()).not.toThrow();
    });
});

describe('TokenService.sign', () => {
    it('emits v2 tokens with `kid: "v2"` header', () => {
        const svc = createTokenService();
        const token = svc.sign('auth', {
            type: 'session',
            user_uid: 'user-uuid-1',
            session_uid: 'session-uuid-1',
            auth_id: 'auth-id-1',
        });
        const decoded = jwt.decode(token, { complete: true });
        expect(decoded).toMatchObject({ header: { kid: 'v2' } });
    });

    it('signs with v2 secret (not legacy)', () => {
        const svc = createTokenService();
        const token = svc.sign('auth', {
            type: 'session',
            user_uid: 'user-uuid-1',
        });
        // Verifying with v2 secret succeeds…
        expect(() => jwt.verify(token, V2_SECRET)).not.toThrow();
        // …and with v1 secret fails.
        expect(() => jwt.verify(token, V1_SECRET)).toThrow();
    });

    it('emits `iat` automatically', () => {
        const svc = createTokenService();
        const before = Math.floor(Date.now() / 1000);
        const token = svc.sign('auth', { type: 'session' });
        const payload = jwt.verify(token, V2_SECRET) as Record<string, unknown>;
        expect(typeof payload.iat).toBe('number');
        expect(payload.iat as number).toBeGreaterThanOrEqual(before);
    });

    it('honors caller `expiresIn` for the `exp` claim', () => {
        const svc = createTokenService();
        const token = svc.sign(
            'auth',
            { type: 'access-token' },
            { expiresIn: '1h' },
        );
        const payload = jwt.verify(token, V2_SECRET) as Record<string, unknown>;
        expect(typeof payload.exp).toBe('number');
        expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
    });

    it('omits `exp` when caller passes no `expiresIn` (web/app/asset)', () => {
        const svc = createTokenService();
        const token = svc.sign('auth', { type: 'session' });
        const payload = jwt.verify(token, V2_SECRET) as Record<string, unknown>;
        expect(payload.exp).toBeUndefined();
    });

    it('signs from config even before onServerStart runs (boot-window race)', () => {
        // The http socket starts accepting connections before onServerStart
        // finishes, so a login can arrive while the service is still booting.
        // Secrets are read straight from config (not copied in onServerStart),
        // so signing must work without onServerStart having run — otherwise
        // jwt.sign would get an empty secret and throw `secretOrPrivateKey
        // must have a value`, surfacing as a 500.
        const config = {
            jwt_secret_v2: V2_SECRET,
        } as ConstructorParameters<typeof TokenService>[0];
        const [clients, stores, services] = [{}, {}, {}] as [
            ConstructorParameters<typeof TokenService>[1],
            ConstructorParameters<typeof TokenService>[2],
            ConstructorParameters<typeof TokenService>[3],
        ];
        const svc = new TokenService(config, clients, stores, services);
        // Note: onServerStart() intentionally NOT called.
        const token = svc.sign('auth', { type: 'session' });
        expect(() => jwt.verify(token, V2_SECRET)).not.toThrow();
    });

    it('caller cannot override the `kid` routing discriminant', () => {
        const svc = createTokenService();
        const token = svc.sign(
            'auth',
            { type: 'session' },
            { keyid: 'v3' } as never,
        );
        const decoded = jwt.decode(token, { complete: true });
        expect(decoded).toMatchObject({ header: { kid: 'v2' } });
    });
});

describe('TokenService.verify — v2', () => {
    it('round-trips session_uid and auth_id claims through compression', () => {
        const svc = createTokenService();
        const sessionUuid = '11111111-1111-1111-1111-111111111111';
        const authId = '22222222-2222-2222-2222-222222222222';
        const userUid = '33333333-3333-3333-3333-333333333333';
        const token = svc.sign('auth', {
            type: 'session',
            user_uid: userUid,
            session_uid: sessionUuid,
            auth_id: authId,
        });
        const payload = svc.verify<Record<string, unknown>>('auth', token);
        expect(payload).toMatchObject({
            type: 'session',
            user_uid: userUid,
            session_uid: sessionUuid,
            auth_id: authId,
        });
        // v2 tokens never carry the legacy flag.
        expect(payload.legacy).toBeUndefined();
    });

    it('rejects expired v2 tokens', () => {
        const svc = createTokenService();
        // expiresIn must be a string or number-of-seconds; negative is fine.
        const token = svc.sign(
            'auth',
            { type: 'access-token' },
            { expiresIn: -60 },
        );
        expect(() => svc.verify('auth', token)).toThrow();
    });

    it('tolerates 30s of clock skew on `iat`', () => {
        const svc = createTokenService();
        // Manually issue with iat 25s in the future — within tolerance.
        const future = Math.floor(Date.now() / 1000) + 25;
        const token = jwt.sign({ type: 'session', iat: future }, V2_SECRET, {
            keyid: 'v2',
            noTimestamp: true,
        });
        expect(() => svc.verify('auth', token)).not.toThrow();
    });
});

describe('TokenService.verify — retired v1 tokens', () => {
    // v1 is retired: no secret verifies it any more, and every shape it could
    // arrive in has to land on the same structured error so the auth probe can
    // answer `reauth_required` instead of a bare 401.
    it('rejects a v1-shaped token, carrying the unverified payload as a hint', () => {
        const svc = createTokenService();
        const token = mintV1Token({
            t: 'au',
            v: '0.0.0',
            uu: Buffer.from(
                '33333333333333333333333333333333',
                'hex',
            ).toString('base64'),
            au: Buffer.from(
                '44444444444444444444444444444444',
                'hex',
            ).toString('base64'),
        });
        let thrown: unknown;
        try {
            svc.verify('auth', token);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(V1TokensDisabledError);
        // Decompressed from the *unverified* payload — advisory only, but it is
        // what labels the reauth response.
        expect((thrown as V1TokensDisabledError).payload).toMatchObject({
            type: 'app-under-user',
            user_uid: '33333333-3333-3333-3333-333333333333',
        });
    });

    it('rejects when the header `kid` is missing', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V1_SECRET);
        expect(() => svc.verify('auth', token)).toThrow(V1TokensDisabledError);
    });

    it('rejects when the header `kid` is an unknown value', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V1_SECRET, { keyid: 'v99' });
        expect(() => svc.verify('auth', token)).toThrow(V1TokensDisabledError);
    });

    it('rejects a v1-shaped token signed with any other secret', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, 'not-the-legacy-secret');
        expect(() => svc.verify('auth', token)).toThrow(V1TokensDisabledError);
    });

    it('rejects a garbage string that is not a JWT at all', () => {
        const svc = createTokenService();
        expect(() => svc.verify('auth', 'not-a-jwt')).toThrow(
            V1TokensDisabledError,
        );
    });
});

describe('TokenService.verify — algorithm pinning', () => {
    // jsonwebtoken has always defaulted to HS256 for string secrets, so every
    // token Puter mints is HS256 — pinning `algorithms: ['HS256']` must not
    // invalidate a live token.
    it('existing tokens keep working: minted tokens are HS256 and verify', () => {
        const svc = createTokenService();
        const v2 = svc.sign('auth', {
            type: 'session',
            user_uid: 'uu',
            session_uid: 'su',
            auth_id: 'ai',
        });
        expect(jwt.decode(v2, { complete: true })).toMatchObject({
            header: { alg: 'HS256' },
        });
        expect(() => svc.verify('auth', v2)).not.toThrow();
    });

    it('rejects a v2-routed token signed with a non-HS256 algorithm, even with the right secret', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V2_SECRET, {
            algorithm: 'HS384',
            keyid: 'v2',
        });
        expect(() => svc.verify('auth', token)).toThrow(/algorithm/);
    });
});

describe('TokenService payload key handling', () => {
    // Decompression looks every field name up in a table keyed by claim
    // name. A crafted token can name a field after an `Object.prototype`
    // member, which must be read as data rather than as a field definition.
    const prototypeKeys = ['constructor', '__proto__', 'toString'];

    /**
     * Hand-mint a v2-shaped token. `jwt.sign` refuses these payloads (its own
     * claim validator has the same prototype-lookup flaw), which is exactly
     * why an attacker assembles the JWT by hand instead.
     */
    const mintRawV2Token = (payloadJson: string, sign = true): string => {
        const b64 = (s: string) => Buffer.from(s).toString('base64url');
        const head = b64(
            JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'v2' }),
        );
        const body = b64(payloadJson);
        const sig = sign
            ? createHmac('sha256', V2_SECRET)
                  .update(`${head}.${body}`)
                  .digest('base64url')
            : 'not-a-signature';
        return `${head}.${body}.${sig}`;
    };

    it.each(prototypeKeys)(
        'decodes an unsigned payload carrying a `%s` field',
        (key) => {
            const svc = createTokenService();
            const token = mintRawV2Token(`{"t":"s","${key}":"x"}`, false);
            const decoded = svc.decodeWithoutVerify<Record<string, unknown>>(
                'auth',
                token,
            );
            expect(decoded).toMatchObject({ type: 'session' });
            expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
        },
    );

    it.each(prototypeKeys)(
        'verifies a signed payload carrying a `%s` field',
        (key) => {
            const svc = createTokenService();
            const token = mintRawV2Token(`{"t":"s","${key}":"x"}`);
            const verified = svc.verify<Record<string, unknown>>('auth', token);
            expect(verified).toMatchObject({ type: 'session' });
            expect(Object.getPrototypeOf(verified)).toBe(Object.prototype);
        },
    );
});
