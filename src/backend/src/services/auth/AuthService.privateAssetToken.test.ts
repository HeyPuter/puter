import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { tmp_provide_services } from '../../helpers.js';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './AuthService.js';

type AuthServiceForPrivateTokenTests = AuthService & {
    global_config: {
        jwt_secret: string;
        private_app_asset_token_ttl_seconds: number;
        private_app_asset_cookie_name: string;
        app_origin_canonical_cache_ttl_seconds?: number;
        public_hosted_actor_token_ttl_seconds?: number;
        public_hosted_actor_cookie_name?: string;
        static_hosting_domain: string;
        static_hosting_domain_alt?: string;
        private_app_hosting_domain: string;
        private_app_hosting_domain_alt?: string;
    };
    tokenService: {
        sign: (scope: string, payload: unknown, options?: jwt.SignOptions) => string;
        verify: (scope: string, token: string) => jwt.JwtPayload & Record<string, unknown>;
    };
    uuid_fpe: {
        encrypt: (value: string) => string;
        decrypt: (value: string) => string;
    };
    services: {
        get: (name: string) => unknown;
    };
    sessionService: {
        getSession: (uuid: string) => Promise<{ uuid: string; user_uid?: string } | undefined>;
        create_session: (user: { id: number; uuid: string }, meta?: Record<string, unknown>) => Promise<{ uuid: string }>;
    };
    appOriginCanonicalizationLocalCacheNamespace?: string;
};

const testKernel = await createTestKernel({
    initLevelString: 'init',
    testCore: true,
    serviceConfigOverrideMap: {
        database: {
            path: ':memory:',
        },
    },
});
await tmp_provide_services(testKernel.services);

const authService = testKernel.services.get('auth') as AuthServiceForPrivateTokenTests;
const db = testKernel.services.get('database').get('write', 'auth-private-asset-test');

const applyDefaultAuthConfig = () => {
    authService.global_config.jwt_secret = 'private-asset-test-secret';
    authService.global_config.private_app_asset_token_ttl_seconds = 3600;
    authService.global_config.private_app_asset_cookie_name = 'puter.private.asset.token';
    authService.global_config.app_origin_canonical_cache_ttl_seconds = 300;
    authService.global_config.public_hosted_actor_token_ttl_seconds = 900;
    authService.global_config.public_hosted_actor_cookie_name = 'puter.public.hosted.actor.token';
    authService.global_config.static_hosting_domain = 'puter.site';
    authService.global_config.static_hosting_domain_alt = 'puter.host';
    authService.global_config.private_app_hosting_domain = 'app.puter.localhost';
    authService.global_config.private_app_hosting_domain_alt = 'puter.dev';
    (authService.tokenService as { secret: string }).secret = authService.global_config.jwt_secret;
    authService.appOriginCanonicalizationLocalCacheNamespace =
        authService.createAppOriginLocalCacheNamespace();
};

const createAuthService = (): AuthServiceForPrivateTokenTests => {
    applyDefaultAuthConfig();
    return authService;
};

const insertUser = async () => {
    const userUuid = randomUUID();
    const username = `u_${Math.random().toString(36).slice(2, 10)}`;
    await db.write(
        'INSERT INTO `user` (`uuid`, `username`) VALUES (?, ?)',
        [userUuid, username],
    );
    const [user] = await db.read(
        'SELECT * FROM `user` WHERE `uuid` = ? LIMIT 1',
        [userUuid],
    );
    return user as { id: number; uuid: string; username: string };
};

const insertApp = async ({
    uid,
    name,
    title,
    indexUrl,
    ownerUserId = null,
}: {
    uid: string;
    name: string;
    title: string;
    indexUrl: string;
    ownerUserId?: number | null;
}) => {
    await db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `description`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?, ?)',
        [uid, name, title, `desc-${name}`, indexUrl, ownerUserId],
    );
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

    it('creates and verifies public hosted actor tokens with expected claims', () => {
        const authService = createAuthService();
        const appUid = 'app-d18f4a26-1e9a-4e9d-89dd-d3476f9efab4';
        const userUid = '1a8600ea-25a7-4ac6-95be-3a9f84e95f17';
        const sessionUuid = 'f6bb30b0-f9d8-4bd6-94ea-0bfcf48e1ba8';
        const subdomain = 'beans';
        const host = 'beans.puter.dev';

        const token = authService.createPublicHostedActorToken({
            appUid,
            userUid,
            sessionUuid,
            subdomain,
            host,
            ttlSeconds: 180,
        });

        const claims = authService.verifyPublicHostedActorToken(token, {
            expectedAppUid: appUid,
            expectedUserUid: userUid,
            expectedSessionUuid: sessionUuid,
            expectedSubdomain: subdomain,
            expectedHost: host,
        });

        expect(claims.appUid).toBe(appUid);
        expect(claims.userUid).toBe(userUid);
        expect(claims.sessionUuid).toBe(sessionUuid);
        expect(claims.subdomain).toBe(subdomain);
        expect(claims.host).toBe(host);
        expect(typeof claims.exp).toBe('number');
    });

    it('returns public hosted actor cookie options with matched hosted domain', () => {
        const authService = createAuthService();
        authService.global_config.static_hosting_domain = 'site.puter.localhost';
        authService.global_config.static_hosting_domain_alt = 'site.puter.dev';
        authService.global_config.private_app_hosting_domain = 'app.puter.localhost';
        authService.global_config.private_app_hosting_domain_alt = 'puter.dev';
        authService.global_config.public_hosted_actor_token_ttl_seconds = 1200;
        authService.global_config.public_hosted_actor_cookie_name = 'puter.public.hosted.actor';

        const options = authService.getPublicHostedActorCookieOptions({
            requestHostname: 'beans.puter.dev',
        });

        expect(authService.getPublicHostedActorCookieName()).toBe('puter.public.hosted.actor');
        expect(options.sameSite).toBe('none');
        expect(options.secure).toBe(true);
        expect(options.httpOnly).toBe(true);
        expect(options.path).toBe('/');
        expect(options.maxAge).toBe(1_200_000);
        expect(options.domain).toBe('.puter.dev');
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
        const user = await insertUser();
        const session = await authService.sessionService.create_session(user, {});
        const token = authService.tokenService.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: user.uuid,
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: authService.uuid_fpe.encrypt(session.uuid),
        }, { expiresIn: 60 });

        const identity = await authService.resolvePrivateBootstrapIdentityFromToken(token);

        expect(identity).toEqual({
            userUid: user.uuid,
            sessionUuid: session.uuid,
        });
    });

    it('rejects bootstrap identity when session owner does not match token user', async () => {
        const authService = createAuthService();
        const claimedUser = await insertUser();
        const actualSessionOwner = await insertUser();
        const actualSession = await authService.sessionService.create_session(actualSessionOwner, {});
        const token = authService.tokenService.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: claimedUser.uuid,
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: authService.uuid_fpe.encrypt(actualSession.uuid),
        }, { expiresIn: 60 });

        await expect(authService.resolvePrivateBootstrapIdentityFromToken(token))
            .rejects
            .toThrow();
    });

    it('rejects bootstrap identity when expected app uid does not match token app uid', async () => {
        const authService = createAuthService();
        const user = await insertUser();
        const session = await authService.sessionService.create_session(user, {});
        const token = authService.tokenService.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: user.uuid,
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: authService.uuid_fpe.encrypt(session.uuid),
        }, { expiresIn: 60 });

        await expect(authService.resolvePrivateBootstrapIdentityFromToken(token, {
            expectedAppUid: 'app-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        }))
            .rejects
            .toThrow();
    });

    it('accepts bootstrap identity when expected app uid candidates include token app uid', async () => {
        const authService = createAuthService();
        const user = await insertUser();
        const session = await authService.sessionService.create_session(user, {});
        const appUid = 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683';
        const token = authService.tokenService.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: user.uuid,
            app_uid: appUid,
            session: authService.uuid_fpe.encrypt(session.uuid),
        }, { expiresIn: 60 });

        const identity = await authService.resolvePrivateBootstrapIdentityFromToken(token, {
            expectedAppUids: ['app-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', appUid],
        });

        expect(identity).toEqual({
            userUid: user.uuid,
            sessionUuid: session.uuid,
        });
    });

    it('rejects bootstrap identity token when signature is tampered', async () => {
        const authService = createAuthService();
        const user = await insertUser();
        const session = await authService.sessionService.create_session(user, {});
        const token = authService.tokenService.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: user.uuid,
            app_uid: 'app-7e2d3016-8d36-456a-9dc7-b75b0f4f7683',
            session: authService.uuid_fpe.encrypt(session.uuid),
        }, { expiresIn: 60 });
        const tampered = tamperTokenSignature(token);

        await expect(authService.resolvePrivateBootstrapIdentityFromToken(tampered))
            .rejects
            .toThrow();
    });

    it('prefers oldest owner-matched app for hosted subdomain origins', async () => {
        const authService = createAuthService();
        const owner = await insertUser();
        const otherOwner = await insertUser();
        const subdomain = `beans${Math.random().toString(36).slice(2, 9)}`;

        await db.write(
            'INSERT INTO `subdomains` (`uuid`, `subdomain`, `user_id`) VALUES (?, ?, ?)',
            [randomUUID(), subdomain, owner.id],
        );

        await insertApp({
            uid: 'app-oldest-owner-match',
            name: `oldest-owner-${subdomain}`,
            title: `oldest-owner-${subdomain}`,
            indexUrl: `https://${subdomain}.puter.dev/`,
            ownerUserId: owner.id,
        });
        await insertApp({
            uid: 'app-newer-owner-match',
            name: `newer-owner-${subdomain}`,
            title: `newer-owner-${subdomain}`,
            indexUrl: `https://${subdomain}.puter.dev/index.html`,
            ownerUserId: owner.id,
        });
        await insertApp({
            uid: `app-other-owner-${randomUUID()}`,
            name: `other-owner-${subdomain}`,
            title: `other-owner-${subdomain}`,
            indexUrl: `https://${subdomain}.puter.dev/`,
            ownerUserId: otherOwner.id,
        });

        const appUid = await authService.app_uid_from_origin(`https://${subdomain}.puter.dev`);

        expect(appUid).toBe('app-oldest-owner-match');
    });

    it('falls back to deterministic origin uid when hosted subdomain owner cannot be resolved', async () => {
        const authService = createAuthService();
        const subdomain = `beans${Math.random().toString(36).slice(2, 9)}`;
        const uidFromPrivateAlias = await authService.app_uid_from_origin(`https://${subdomain}.puter.dev`);
        const uidFromStaticAlias = await authService.app_uid_from_origin(`https://${subdomain}.puter.site`);

        expect(uidFromPrivateAlias).toBe(uidFromStaticAlias);
        expect(uidFromPrivateAlias.startsWith('app-')).toBe(true);
    });

    it('prefers oldest app for non-hosted origins', async () => {
        const authService = createAuthService();
        const host = `${Math.random().toString(36).slice(2, 10)}.example.com`;
        const origin = `https://${host}`;

        await insertApp({
            uid: 'app-oldest-external',
            name: `oldest-external-${host}`,
            title: `oldest-external-${host}`,
            indexUrl: `${origin}/`,
        });
        await insertApp({
            uid: 'app-newer-external',
            name: `newer-external-${host}`,
            title: `newer-external-${host}`,
            indexUrl: `${origin}/index.html`,
        });

        const appUid = await authService.app_uid_from_origin(origin);
        expect(appUid).toBe('app-oldest-external');
    });

    it('collects canonical cache origins from app change payloads', () => {
        const authService = createAuthService();
        authService.global_config.static_hosting_domain = 'puter.site';
        authService.global_config.static_hosting_domain_alt = 'puter.host';
        authService.global_config.private_app_hosting_domain = 'puter.app';
        authService.global_config.private_app_hosting_domain_alt = 'puter.dev';

        const canonicalOrigins = authService.collectCanonicalCacheOriginsFromAppChangeEvent({
            app: {
                index_url: 'https://beans.puter.dev/index.html',
            },
            old_app: {
                index_url: 'https://beans.puter.site/',
            },
            old_index_url: 'https://example.com',
        });

        expect(canonicalOrigins).toContain('https://beans.puter.site');
        expect(canonicalOrigins).toContain('https://example.com');
        expect(canonicalOrigins.filter(origin => origin === 'https://beans.puter.site')).toHaveLength(1);
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
