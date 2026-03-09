import { describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './AuthService.js';

type AuthServiceForPrivateTokenTests = AuthService & {
    global_config: {
        jwt_secret: string;
        private_app_asset_token_ttl_seconds: number;
        private_app_asset_cookie_name: string;
        app_origin_canonical_cache_ttl_seconds?: number;
        static_hosting_domain: string;
        static_hosting_domain_alt?: string;
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
    services: {
        get: (name: string) => unknown;
    };
    appOriginCanonicalizationLocalCacheNamespace?: string;
    appOriginCacheVersionMemo: { value: string | null; expiresAt: number };
};

const createAuthService = (): AuthServiceForPrivateTokenTests => {
    const authService = Object.create(AuthService.prototype) as AuthServiceForPrivateTokenTests;
    authService.global_config = {
        jwt_secret: 'private-asset-test-secret',
        private_app_asset_token_ttl_seconds: 3600,
        private_app_asset_cookie_name: 'puter.private.asset.token',
        app_origin_canonical_cache_ttl_seconds: 300,
        static_hosting_domain: 'puter.site',
        static_hosting_domain_alt: 'puter.host',
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
    authService.services = {
        get: (_name) => ({
            emit: async () => {
            },
        }),
    };
    authService.appOriginCanonicalizationLocalCacheNamespace = `test:${Math.random().toString(36).slice(2)}`;
    authService.appOriginCacheVersionMemo = { value: null, expiresAt: 0 };
    authService.getAppOriginCacheVersion = vi.fn().mockResolvedValue('0');
    authService.readCanonicalAppUidFromRedisCache = vi.fn().mockResolvedValue(undefined);
    authService.writeCanonicalAppUidToRedisCache = vi.fn().mockResolvedValue(undefined);
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
        const privateHost = 'beans.puter.dev';

        const token = authService.createPrivateAssetToken({
            appUid,
            userUid,
            sessionUuid,
            subdomain,
            privateHost,
            ttlSeconds: 120,
        });

        const claims = authService.verifyPrivateAssetToken(token, {
            expectedAppUid: appUid,
            expectedUserUid: userUid,
            expectedSessionUuid: sessionUuid,
            expectedSubdomain: subdomain,
            expectedPrivateHost: privateHost,
        });

        expect(claims.appUid).toBe(appUid);
        expect(claims.userUid).toBe(userUid);
        expect(claims.sessionUuid).toBe(sessionUuid);
        expect(claims.subdomain).toBe(subdomain);
        expect(claims.privateHost).toBe(privateHost);
        expect(typeof claims.exp).toBe('number');
    });

    it('rejects tokens when expected user or app does not match', () => {
        const authService = createAuthService();
        const token = authService.createPrivateAssetToken({
            appUid: 'app-9f1c10e3-9a7f-43fb-8671-af4918e65407',
            userUid: '9885b80e-1a14-4c8d-9e3f-4fa5915b1136',
            subdomain: 'beans',
            privateHost: 'beans.puter.dev',
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

        expect(() => authService.verifyPrivateAssetToken(token, {
            expectedPrivateHost: 'other.puter.dev',
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

    it('rejects bootstrap identity when expected app uid does not match token app uid', async () => {
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

        await expect(authService.resolvePrivateBootstrapIdentityFromToken(token, {
            expectedAppUid: 'app-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        }))
            .rejects
            .toThrow();
    });

    it('accepts bootstrap identity when expected app uid candidates include token app uid', async () => {
        const authService = createAuthService();
        const userUid = '4b0cecf8-dd6a-4eb5-bcc4-c76cc7e8d7f0';
        const sessionUuid = 'f9000804-2fd3-4da5-819b-afc5296f90f7';
        const appUid = 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683';
        const token = jwt.sign({
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: userUid,
            app_uid: appUid,
            session: sessionUuid,
        }, authService.global_config.jwt_secret, { expiresIn: 60 });

        authService.get_session_ = vi.fn().mockResolvedValue({
            uuid: sessionUuid,
            user_uid: userUid,
        });

        const identity = await authService.resolvePrivateBootstrapIdentityFromToken(token, {
            expectedAppUids: ['app-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', appUid],
        });

        expect(identity).toEqual({
            userUid,
            sessionUuid,
        });
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

    it('prefers oldest owner-matched app for hosted subdomain origins', async () => {
        const authService = createAuthService();
        const readSites = vi.fn().mockResolvedValue([{ user_id: 42 }]);
        const readApps = vi.fn().mockResolvedValue([{ uid: 'app-oldest-owner-match' }]);

        authService.services = {
            get: (name: string) => {
                if ( name === 'database' ) {
                    return {
                        get: (_mode: unknown, dbName: string) => (
                            dbName === 'sites'
                                ? { read: readSites }
                                : { read: readApps }
                        ),
                    };
                }
                return {
                    emit: async () => {
                    },
                };
            },
        };
        authService.getAppOriginCacheVersion = vi.fn().mockResolvedValue('0');
        authService.readCanonicalAppUidFromRedisCache = vi.fn().mockResolvedValue(undefined);
        authService.writeCanonicalAppUidToRedisCache = vi.fn().mockResolvedValue(undefined);

        const appUid = await authService.app_uid_from_origin('https://beans.puter.dev');

        expect(appUid).toBe('app-oldest-owner-match');
        expect(readSites).toHaveBeenCalledWith(
            'SELECT user_id FROM subdomains WHERE subdomain = ? LIMIT 1',
            ['beans'],
        );
        expect(readApps).toHaveBeenCalled();
    });

    it('falls back to deterministic origin uid when hosted subdomain owner cannot be resolved', async () => {
        const authService = createAuthService();
        const readSites = vi.fn().mockResolvedValue([]);
        const readApps = vi.fn().mockResolvedValue([]);

        authService.services = {
            get: (name: string) => {
                if ( name === 'database' ) {
                    return {
                        get: (_mode: unknown, dbName: string) => (
                            dbName === 'sites'
                                ? { read: readSites }
                                : { read: readApps }
                        ),
                    };
                }
                return {
                    emit: async () => {
                    },
                };
            },
        };
        authService.getAppOriginCacheVersion = vi.fn().mockResolvedValue('0');
        authService.readCanonicalAppUidFromRedisCache = vi.fn().mockResolvedValue(undefined);
        authService.writeCanonicalAppUidToRedisCache = vi.fn().mockResolvedValue(undefined);

        const uidFromPrivateAlias = await authService.app_uid_from_origin('https://beans.puter.dev');
        const uidFromStaticAlias = await authService.app_uid_from_origin('https://beans.puter.site');

        expect(uidFromPrivateAlias).toBe(uidFromStaticAlias);
        expect(uidFromPrivateAlias.startsWith('app-')).toBe(true);
    });

    it('prefers oldest app for non-hosted origins', async () => {
        const authService = createAuthService();
        const readApps = vi.fn().mockResolvedValue([{ uid: 'app-oldest-external' }]);

        authService.services = {
            get: (name: string) => {
                if ( name === 'database' ) {
                    return {
                        get: (_mode: unknown, dbName: string) => (
                            dbName === 'apps'
                                ? { read: readApps }
                                : { read: vi.fn().mockResolvedValue([]) }
                        ),
                    };
                }
                return {
                    emit: async () => {
                    },
                };
            },
        };
        authService.getAppOriginCacheVersion = vi.fn().mockResolvedValue('0');
        authService.readCanonicalAppUidFromRedisCache = vi.fn().mockResolvedValue(undefined);
        authService.writeCanonicalAppUidToRedisCache = vi.fn().mockResolvedValue(undefined);

        const appUid = await authService.app_uid_from_origin('https://example.com');
        expect(appUid).toBe('app-oldest-external');
        expect(readApps).toHaveBeenCalled();
    });

    it('derives same app uid for hosted app domain aliases', async () => {
        const authService = createAuthService();
        authService.global_config.static_hosting_domain = 'puter.site';
        authService.global_config.static_hosting_domain_alt = 'puter.host';
        authService.global_config.private_app_hosting_domain = 'puter.app';
        authService.global_config.private_app_hosting_domain_alt = 'puter.dev';

        const uidSite = await authService.app_uid_from_origin('https://beans.puter.site');
        const uidStaticAlt = await authService.app_uid_from_origin('https://beans.puter.host');
        const uidPrivatePrimary = await authService.app_uid_from_origin('https://beans.puter.app');
        const uidPrivateAlt = await authService.app_uid_from_origin('https://beans.puter.dev');

        expect(uidSite).toBe(uidStaticAlt);
        expect(uidSite).toBe(uidPrivatePrimary);
        expect(uidSite).toBe(uidPrivateAlt);
    });

    it('keeps distinct app uid per subdomain under hosted alias canonicalization', async () => {
        const authService = createAuthService();
        authService.global_config.static_hosting_domain = 'puter.site';
        authService.global_config.static_hosting_domain_alt = 'puter.host';
        authService.global_config.private_app_hosting_domain = 'puter.app';
        authService.global_config.private_app_hosting_domain_alt = 'puter.dev';

        const uidBeans = await authService.app_uid_from_origin('https://beans.puter.dev');
        const uidCats = await authService.app_uid_from_origin('https://cats.puter.site');

        expect(uidBeans).not.toBe(uidCats);
    });
});
