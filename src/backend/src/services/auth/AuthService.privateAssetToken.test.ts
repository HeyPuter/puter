import { describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './AuthService.js';

type AuthServiceForPrivateTokenTests = AuthService & {
    global_config: {
        jwt_secret: string;
        private_app_asset_token_ttl_seconds: number;
        private_app_asset_cookie_name: string;
        private_app_hosting_domain: string;
        private_app_hosting_domain_alt?: string;
    };
    modules: {
        jwt: {
            sign: typeof jwt.sign;
            verify: typeof jwt.verify;
        };
    };
    tokenService: {
        sign: typeof jwt.sign;
        verify: typeof jwt.verify;
    };
    uuid_fpe: {
        encrypt: (value: string) => string;
        decrypt: (value: string) => string;
    };
};

const createAuthService = (): AuthServiceForPrivateTokenTests => {
    const authService = Object.create(AuthService.prototype) as AuthServiceForPrivateTokenTests;
    authService.global_config = {
        jwt_secret: 'private-asset-test-secret',
        private_app_asset_token_ttl_seconds: 3600,
        private_app_asset_cookie_name: 'puter.private.asset.token',
        private_app_hosting_domain: 'app.puter.localhost',
        private_app_hosting_domain_alt: 'puter.dev',
    };
    authService.modules = {
        jwt: {
            sign: jwt.sign.bind(jwt),
            verify: jwt.verify.bind(jwt),
        },
    };
    authService.tokenService = {
        sign: (_scope, payload, options) =>
            jwt.sign(payload as Parameters<typeof jwt.sign>[0], authService.global_config.jwt_secret, options),
        verify: (_scope, token) =>
            jwt.verify(token, authService.global_config.jwt_secret),
    };
    authService.uuid_fpe = {
        encrypt: (value) => value,
        decrypt: (value) => value,
    };
    // @ts-expect-error test-only lightweight stub
    authService.get_session_ = vi.fn().mockResolvedValue(undefined);
    return authService;
};

const tamperTokenSignature = (token: string): string => {
    const parts = token.split('.');
    if ( parts.length !== 3 ) return `${token}x`;
    const signature = parts[2];
    if ( signature.length === 0 ) {
        parts[2] = 'x';
        return parts.join('.');
    }
    const lastChar = signature[signature.length - 1];
    const replacement = lastChar === 'a' ? 'b' : 'a';
    parts[2] = `${signature.slice(0, -1)}${replacement}`;
    return parts.join('.');
};

describe('AuthService private asset token helpers', () => {
    it('creates and verifies private asset tokens with expected claims', () => {
        const authService = createAuthService();
        const appUid = 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683';
        const userUid = '4b0cecf8-dd6a-4eb5-bcc4-c76cc7e8d7f0';
        const sessionUuid = 'f9000804-2fd3-4da5-819b-afc5296f90f7';
        const subdomain = 'beans';

        const token = authService.createPrivateAssetToken({
            appUid,
            userUid,
            sessionUuid,
            subdomain,
            ttlSeconds: 120,
        });

        const claims = authService.verifyPrivateAssetToken(token, {
            expectedAppUid: appUid,
            expectedUserUid: userUid,
            expectedSessionUuid: sessionUuid,
            expectedSubdomain: subdomain,
        });

        expect(claims.appUid).toBe(appUid);
        expect(claims.userUid).toBe(userUid);
        expect(claims.sessionUuid).toBe(sessionUuid);
        expect(claims.subdomain).toBe(subdomain);
        expect(typeof claims.exp).toBe('number');
    });

    it('rejects tokens when expected user or app does not match', () => {
        const authService = createAuthService();
        const token = authService.createPrivateAssetToken({
            appUid: 'app-9f1c10e3-9a7f-43fb-8671-af4918e65407',
            userUid: '9885b80e-1a14-4c8d-9e3f-4fa5915b1136',
            subdomain: 'beans',
        });

        expect(() => authService.verifyPrivateAssetToken(token, {
            expectedAppUid: 'app-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        })).toThrow();

        expect(() => authService.verifyPrivateAssetToken(token, {
            expectedUserUid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        })).toThrow();

        expect(() => authService.verifyPrivateAssetToken(token, {
            expectedSubdomain: 'other-app',
        })).toThrow();
    });

    it('rejects non private-asset tokens', () => {
        const authService = createAuthService();
        const token = jwt.sign({
            type: 'session',
            uuid: '245f33f0-c07e-40e2-be22-5215752e3462',
            user_uid: '6cce4692-3855-4ef8-af7d-5c2a02e6b6d8',
        }, authService.global_config.jwt_secret, { expiresIn: 60 });

        expect(() => authService.verifyPrivateAssetToken(token)).toThrow();
    });

    it('rejects private asset tokens with tampered signatures', () => {
        const authService = createAuthService();
        const token = authService.createPrivateAssetToken({
            appUid: 'app-9f1c10e3-9a7f-43fb-8671-af4918e65407',
            userUid: '9885b80e-1a14-4c8d-9e3f-4fa5915b1136',
        });
        const tampered = tamperTokenSignature(token);

        expect(() => authService.verifyPrivateAssetToken(tampered)).toThrow();
    });

    it('returns hardened cookie options with config-driven ttl and domain', () => {
        const authService = createAuthService();
        const options = authService.getPrivateAssetCookieOptions();

        expect(authService.getPrivateAssetCookieName()).toBe('puter.private.asset.token');
        expect(options.sameSite).toBe('none');
        expect(options.secure).toBe(true);
        expect(options.httpOnly).toBe(true);
        expect(options.path).toBe('/');
        expect(options.maxAge).toBe(3_600_000);
        expect(options.domain).toBe('.app.puter.localhost');
    });

    it('uses the matched request host private domain when provided', () => {
        const authService = createAuthService();
        authService.global_config.private_app_hosting_domain = 'app.puter.localhost';
        authService.global_config.private_app_hosting_domain_alt = 'puter.dev';

        const options = authService.getPrivateAssetCookieOptions({
            requestHostname: 'beans.puter.dev',
        });

        expect(options.domain).toBe('.puter.dev');
    });

    it('omits domain when request host does not match configured private domains', () => {
        const authService = createAuthService();
        authService.global_config.private_app_hosting_domain = 'puter.app';
        authService.global_config.private_app_hosting_domain_alt = 'puter.app';

        const options = authService.getPrivateAssetCookieOptions({
            requestHostname: 'beans.puter.dev',
        });

        expect(options.domain).toBeUndefined();
    });

    it('resolves bootstrap identity from app-under-user token without app lookup', async () => {
        const authService = createAuthService();
        const userUid = '4b0cecf8-dd6a-4eb5-bcc4-c76cc7e8d7f0';
        const sessionUuid = 'f9000804-2fd3-4da5-819b-afc5296f90f7';
        const token = jwt.sign({
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: userUid,
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: sessionUuid,
        }, authService.global_config.jwt_secret, { expiresIn: 60 });

        authService.get_session_ = vi.fn().mockResolvedValue({
            uuid: sessionUuid,
            user_uid: userUid,
        });

        const identity = await authService.resolvePrivateBootstrapIdentityFromToken(token);

        expect(identity).toEqual({
            userUid,
            sessionUuid,
        });
        expect(authService.get_session_).toHaveBeenCalledWith(sessionUuid);
    });

    it('rejects bootstrap identity when session owner does not match token user', async () => {
        const authService = createAuthService();
        const token = jwt.sign({
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: '4b0cecf8-dd6a-4eb5-bcc4-c76cc7e8d7f0',
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: 'f9000804-2fd3-4da5-819b-afc5296f90f7',
        }, authService.global_config.jwt_secret, { expiresIn: 60 });

        authService.get_session_ = vi.fn().mockResolvedValue({
            uuid: 'f9000804-2fd3-4da5-819b-afc5296f90f7',
            user_uid: '9885b80e-1a14-4c8d-9e3f-4fa5915b1136',
        });

        await expect(authService.resolvePrivateBootstrapIdentityFromToken(token))
            .rejects
            .toThrow();
    });

    it('rejects bootstrap identity token when signature is tampered', async () => {
        const authService = createAuthService();
        const userUid = '4b0cecf8-dd6a-4eb5-bcc4-c76cc7e8d7f0';
        const sessionUuid = 'f9000804-2fd3-4da5-819b-afc5296f90f7';
        const token = jwt.sign({
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: userUid,
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: sessionUuid,
        }, authService.global_config.jwt_secret, { expiresIn: 60 });
        const tampered = tamperTokenSignature(token);

        await expect(authService.resolvePrivateBootstrapIdentityFromToken(tampered))
            .rejects
            .toThrow();
    });
});
