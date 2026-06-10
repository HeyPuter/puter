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

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { TokenService } from './TokenService.js';

const V2_SECRET = 'test-v2-secret';
const V1_SECRET = 'test-v1-secret';

function createTokenService(
    overrides: {
        jwt_secret?: string;
        jwt_secret_v2?: string;
        allow_v1_tokens?: boolean;
    } = {},
): TokenService {
    const config = {
        jwt_secret: V1_SECRET,
        jwt_secret_v2: V2_SECRET,
        allow_v1_tokens: true,
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

/** Hand-mint a v1-shaped token (no `kid` header) signed with the legacy secret. */
function mintV1Token(payload: Record<string, unknown>): string {
    return jwt.sign(payload, V1_SECRET);
}

describe('TokenService.onServerStart', () => {
    it('refuses to start without jwt_secret_v2', () => {
        const config = {
            jwt_secret: V1_SECRET,
        } as ConstructorParameters<typeof TokenService>[0];
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
            jwt_secret: V1_SECRET,
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
            jwt_secret: 'a-real-v1-secret',
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
            jwt_secret: 'a-real-v1-secret',
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
            jwt_secret: 'dev-jwt-secret-change-me',
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

describe('TokenService.verify — v1 fallback', () => {
    it('verifies a v1-shaped token and tags result with legacy: true', () => {
        const svc = createTokenService();
        // v1 stored `session` (short `s`) on app-under-user. Compress manually.
        const sessionUuidShort = Buffer.from(
            '11111111111111111111111111111111',
            'hex',
        ).toString('base64');
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
            s: sessionUuidShort,
        });
        const payload = svc.verify<Record<string, unknown>>('auth', token);
        expect(payload).toMatchObject({
            type: 'app-under-user',
            legacy: true,
        });
        expect(payload.session).toBe(
            '11111111-1111-1111-1111-111111111111',
        );
    });

    it('rejects v1 tokens when allow_v1_tokens=false', () => {
        const svc = createTokenService({ allow_v1_tokens: false });
        const token = mintV1Token({ t: 's', uu: 'whatever' });
        expect(() => svc.verify('auth', token)).toThrow(/v1 tokens/);
    });

    it('rejects a v1 token signed with the wrong secret', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, 'not-the-legacy-secret');
        expect(() => svc.verify('auth', token)).toThrow();
    });

    it('falls back to v1 verify when header `kid` is missing', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V1_SECRET);
        const payload = svc.verify<Record<string, unknown>>('auth', token);
        expect(payload).toMatchObject({ type: 'session', legacy: true });
    });

    it('falls back to v1 verify when header `kid` is an unknown value', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V1_SECRET, { keyid: 'v99' });
        const payload = svc.verify<Record<string, unknown>>('auth', token);
        expect(payload).toMatchObject({ type: 'session', legacy: true });
    });
});

describe('TokenService.verify — algorithm pinning', () => {
    // jsonwebtoken has always defaulted to HS256 for string secrets, so
    // every token ever minted by Puter (v1 and v2) is HS256 — pinning
    // `algorithms: ['HS256']` must not invalidate any existing token.
    it('existing tokens keep working: minted v2 and default-signed v1 tokens are HS256 and verify', () => {
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

        const v1 = mintV1Token({ t: 's', uu: 'user-uuid' });
        expect(jwt.decode(v1, { complete: true })).toMatchObject({
            header: { alg: 'HS256' },
        });
        expect(svc.verify<Record<string, unknown>>('auth', v1)).toMatchObject({
            legacy: true,
        });
    });

    it('rejects a v2-routed token signed with a non-HS256 algorithm, even with the right secret', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V2_SECRET, {
            algorithm: 'HS384',
            keyid: 'v2',
        });
        expect(() => svc.verify('auth', token)).toThrow(/algorithm/);
    });

    it('rejects a v1-routed token signed with a non-HS256 algorithm, even with the right secret', () => {
        const svc = createTokenService();
        const token = jwt.sign({ t: 's' }, V1_SECRET, { algorithm: 'HS512' });
        expect(() => svc.verify('auth', token)).toThrow(/algorithm/);
    });
});
