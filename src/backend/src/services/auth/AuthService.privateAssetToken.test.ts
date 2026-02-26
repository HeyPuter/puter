import { describe, expect, it } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './AuthService.js';

type AuthServiceForPrivateTokenTests = AuthService & {
    global_config: {
        jwt_secret: string;
        private_app_asset_token_ttl_seconds: number;
        private_app_asset_cookie_name: string;
        private_app_hosting_domain: string;
    };
    modules: {
        jwt: {
            sign: typeof jwt.sign;
            verify: typeof jwt.verify;
        };
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
        private_app_hosting_domain: 'puter.app',
    };
    authService.modules = {
        jwt: {
            sign: jwt.sign.bind(jwt),
            verify: jwt.verify.bind(jwt),
        },
    };
    authService.uuid_fpe = {
        encrypt: (value) => value,
        decrypt: (value) => value,
    };
    return authService;
};

describe('AuthService private asset token helpers', () => {
    it('creates and verifies private asset tokens with expected claims', () => {
        const authService = createAuthService();
        const appUid = 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683';
        const userUid = '4b0cecf8-dd6a-4eb5-bcc4-c76cc7e8d7f0';
        const sessionUuid = 'f9000804-2fd3-4da5-819b-afc5296f90f7';

        const token = authService.createPrivateAssetToken({
            appUid,
            userUid,
            sessionUuid,
            ttlSeconds: 120,
        });

        const claims = authService.verifyPrivateAssetToken(token, {
            expectedAppUid: appUid,
            expectedUserUid: userUid,
            expectedSessionUuid: sessionUuid,
        });

        expect(claims.appUid).toBe(appUid);
        expect(claims.userUid).toBe(userUid);
        expect(claims.sessionUuid).toBe(sessionUuid);
        expect(typeof claims.exp).toBe('number');
    });

    it('rejects tokens when expected user or app does not match', () => {
        const authService = createAuthService();
        const token = authService.createPrivateAssetToken({
            appUid: 'app-9f1c10e3-9a7f-43fb-8671-af4918e65407',
            userUid: '9885b80e-1a14-4c8d-9e3f-4fa5915b1136',
        });

        expect(() => authService.verifyPrivateAssetToken(token, {
            expectedAppUid: 'app-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        })).toThrow();

        expect(() => authService.verifyPrivateAssetToken(token, {
            expectedUserUid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
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

    it('returns hardened cookie options with config-driven ttl and domain', () => {
        const authService = createAuthService();
        const options = authService.getPrivateAssetCookieOptions();

        expect(authService.getPrivateAssetCookieName()).toBe('puter.private.asset.token');
        expect(options.sameSite).toBe('none');
        expect(options.secure).toBe(true);
        expect(options.httpOnly).toBe(true);
        expect(options.path).toBe('/');
        expect(options.maxAge).toBe(3_600_000);
        expect(options.domain).toBe('.puter.app');
    });
});
