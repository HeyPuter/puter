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
const { Actor, UserActorType, AppUnderUserActorType, AccessTokenActorType, SiteActorType } = require('./Actor');
const { BaseService } = require('../BaseService');
const { get_user, get_app } = require('../../helpers');
const { Context } = require('../../util/context');
const { kv } = require('../../util/kvSingleton');
const APIError = require('../../api/APIError');
const { setRedisCacheValue } = require('../../clients/redis/cacheUpdate.js');
const { deleteRedisKeys } = require('../../clients/redis/deleteRedisKeys.js');
const { redisClient } = require('../../clients/redis/redisSingleton.js');
const { DB_READ, DB_WRITE } = require('../database/consts');
const { UUIDFPE } = require('../../util/uuidfpe');
const uuidLib = require('uuid');
const crypto = require('crypto');
// This constant defines the namespace used for generating app UUIDs from their origins
const APP_ORIGIN_UUID_NAMESPACE = '33de3768-8ee0-43e9-9e73-db192b97a5d8';
const APP_ORIGIN_CACHE_KEY_PREFIX = 'auth:appOriginCanonicalization:origin';
const APP_ORIGIN_LOCAL_CACHE_KEY_PREFIX = 'auth:appOriginCanonicalization:local';
const DEFAULT_APP_ORIGIN_CANONICAL_CACHE_TTL_SECONDS = 300;
const DEFAULT_PRIVATE_APP_ASSET_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_PRIVATE_APP_ASSET_COOKIE_NAME = 'puter.private.asset.token';
const DEFAULT_PUBLIC_HOSTED_ACTOR_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_PUBLIC_HOSTED_ACTOR_COOKIE_NAME = 'puter.public.hosted.actor.token';

const LegacyTokenError = class extends Error {
};

/**
* @class AuthService
* This class is responsible for handling authentication and authorization tasks for the application.
*/
class AuthService extends BaseService {

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'auth');
        this.svc_session = await this.services.get('session');

        const svc_feature_flag = await this.services.get('feature-flag');
        svc_feature_flag.register('temp-users-disabled', {
            $: 'config-flag',
            value: this.global_config.disable_temp_users ?? false,
        });

        svc_feature_flag.register('user-signup-disabled', {
            $: 'config-flag',
            value: this.global_config.disable_user_signup ?? false,
        });

        // "FPE" stands for "Format Preserving Encryption"
        // The `uuid_fpe_key` is a key for creating encrypted alternatives
        // to UUIDs and decrypting them back to the original UUIDs
        //
        // We do this to avoid exposing the internal UUID for sessions.
        const uuid_fpe_key = this.config.uuid_fpe_key
            ? UUIDFPE.uuidToBuffer(this.config.uuid_fpe_key)
            : crypto.randomBytes(16);
        this.uuid_fpe = new UUIDFPE(uuid_fpe_key);

        this.sessions = {};

        this.tokenService = await this.services.get('token');

        this.appOriginCanonicalizationLocalCacheNamespace = this.createAppOriginLocalCacheNamespace();

        const eventService = await this.services.get('event');
        eventService.on('app.changed', async (_meta, event = {}) => {
            await this.invalidateCanonicalAppUidCacheFromAppChangeEvent(event);
        });
    }

    /**
    * This method authenticates a user or app using a token.
    * It checks the token's type (session, app-under-user, access-token) and decodes it.
    * Depending on the token type, it returns the corresponding user/app actor.
    * @param {string} token - The token to authenticate.
    * @returns {Promise<Actor>} The authenticated user or app actor.
    */
    async authenticate_from_token (token) {
        const decoded = this.tokenService.verify(
            'auth',
            token,
        );

        if ( ! Object.prototype.hasOwnProperty.call(decoded, 'type') ) {
            throw new LegacyTokenError();
        }

        if ( decoded.type === 'session' ) {
            const session = await this.get_session_(decoded.uuid);

            if ( ! session ) {
                throw APIError.create('token_auth_failed');
            }

            const user = await get_user({ uuid: decoded.user_uid });

            if ( ! user ) {
                throw APIError.create('user_not_found');
            }

            const actor_type = new UserActorType({
                user,
                session: session.uuid,
                hasHttpOnlyCookie: true,
            });

            return new Actor({
                user_uid: decoded.user_uid,
                type: actor_type,
            });
        }

        if ( decoded.type === 'gui' ) {
            const session = await this.get_session_(decoded.uuid);

            if ( ! session ) {
                throw APIError.create('token_auth_failed');
            }

            const user = await get_user({ uuid: decoded.user_uid });

            if ( ! user ) {
                throw APIError.create('user_not_found');
            }

            const actor_type = new UserActorType({
                user,
                session: session.uuid,
                hasHttpOnlyCookie: false,
            });

            return new Actor({
                user_uid: decoded.user_uid,
                type: actor_type,
            });
        }

        if ( decoded.type === 'app-under-user' ) {
            let session;
            if ( decoded.session ) {
                const session_uuid = this.uuid_fpe.decrypt(decoded.session);
                session = await this.get_session_(session_uuid);

                if ( ! session ) {
                    throw APIError.create('token_auth_failed');
                }
            }

            const user = await get_user({ uuid: decoded.user_uid });
            if ( ! user ) {
                throw APIError.create('token_auth_failed');
            }

            const app = await get_app({ uid: decoded.app_uid });
            if ( ! app ) {
                throw APIError.create('token_auth_failed');
            }

            const actor_type = new AppUnderUserActorType({
                user,
                app,
                session,
            });

            return new Actor({
                user_uid: decoded.user_uid,
                app_uid: decoded.app_uid,
                type: actor_type,
            });
        }

        if ( decoded.type === 'access-token' ) {
            const token = decoded.token_uid;
            if ( ! token ) {
                throw APIError.create('token_auth_failed');
            }

            const user_uid = decoded.user_uid;
            if ( ! user_uid ) {
                throw APIError.create('token_auth_failed');
            }

            const app_uid = decoded.app_uid;

            const authorizer = ( user_uid && app_uid )
                ? await Actor.create(AppUnderUserActorType, { user_uid, app_uid })
                : await Actor.create(UserActorType, { user_uid });

            const authorized = Context.get('actor');

            const actor_type = new AccessTokenActorType({
                token, authorizer, authorized,
            });

            return new Actor({
                user_uid,
                app_uid,
                type: actor_type,
            });
        }

        if ( decoded.type === 'actor-site' ) {
            const site_uid = decoded.site_uid;
            const svc_puterSite = this.services.get('puter-site');
            const site =
                await svc_puterSite.get_subdomain_by_uid(site_uid);
            return Actor.create(SiteActorType, {
                site,
                iat: decoded.iat,
            });
        }

        throw APIError.create('token_auth_failed');
    }

    get_user_app_token (app_uid) {
        const actor = Context.get('actor');
        const actor_type = actor.type;

        if ( ! (actor_type instanceof UserActorType) ) {
            throw APIError.create('forbidden');
        }

        this.log.debug(`generating user-app token for app ${app_uid} and user ${actor_type.user.uuid}`, {
            app_uid,
            user_uid: actor_type.user.uuid,
        });

        const token = this.tokenService.sign(
            'auth',
            {
                type: 'app-under-user',
                version: '0.0.0',
                user_uid: actor_type.user.uuid,
                app_uid,
                ...(actor_type.session ? { session: this.uuid_fpe.encrypt(actor_type.session) } : {}),
            },
        );

        return token;
    }

    get_site_app_token ({ site_uid }) {
        const token = this.tokenService.sign(
            'auth',
            {
                type: 'actor-site',
                version: '0.0.0',
                site_uid,
            },
            { expiresIn: '1h' },
        );

        return token;
    }

    resolvePositiveInteger (value, fallback) {
        const parsed = Number(value);
        if ( !Number.isFinite(parsed) || parsed <= 0 ) {
            return fallback;
        }
        return Math.floor(parsed);
    }

    getPrivateAssetTokenTtlSeconds () {
        return this.resolvePositiveInteger(
            this.global_config.private_app_asset_token_ttl_seconds,
            DEFAULT_PRIVATE_APP_ASSET_TOKEN_TTL_SECONDS,
        );
    }

    getPrivateAssetCookieName () {
        const configuredCookieName = this.global_config.private_app_asset_cookie_name;
        if ( typeof configuredCookieName === 'string' && configuredCookieName.trim() ) {
            return configuredCookieName.trim();
        }
        return DEFAULT_PRIVATE_APP_ASSET_COOKIE_NAME;
    }

    getPublicHostedActorTokenTtlSeconds () {
        return this.resolvePositiveInteger(
            this.global_config.public_hosted_actor_token_ttl_seconds,
            DEFAULT_PUBLIC_HOSTED_ACTOR_TOKEN_TTL_SECONDS,
        );
    }

    getPublicHostedActorCookieName () {
        const configuredCookieName = this.global_config.public_hosted_actor_cookie_name;
        if ( typeof configuredCookieName === 'string' && configuredCookieName.trim() ) {
            return configuredCookieName.trim();
        }
        return DEFAULT_PUBLIC_HOSTED_ACTOR_COOKIE_NAME;
    }

    normalizeHostnameForCookieDomain (hostnameValue) {
        if ( typeof hostnameValue !== 'string' ) return null;
        const trimmedHostname = hostnameValue.trim().toLowerCase().replace(/^\./, '');
        if ( ! trimmedHostname ) return null;
        try {
            return new URL(`http://${trimmedHostname}`).hostname.toLowerCase();
        } catch {
            return trimmedHostname.split(':')[0] || null;
        }
    }

    isCookieDomainHostEligible (hostnameValue) {
        if ( typeof hostnameValue !== 'string' || !hostnameValue ) return false;
        if ( hostnameValue === 'localhost' ) return false;
        if ( hostnameValue.includes(':') ) return false;
        if ( ! hostnameValue.includes('.') ) return false;
        if ( /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostnameValue) ) return false;
        return true;
    }

    getConfiguredPrivateCookieDomains () {
        const configuredDomains = [];
        for ( const configuredDomainCandidate of [
            this.global_config.private_app_hosting_domain,
            this.global_config.private_app_hosting_domain_alt,
        ] ) {
            const normalizedDomain = this.normalizeHostnameForCookieDomain(configuredDomainCandidate);
            if ( normalizedDomain ) {
                configuredDomains.push(normalizedDomain);
            }
        }
        return [...new Set(configuredDomains)];
    }

    getConfiguredHostedCookieDomains () {
        const configuredDomains = [];
        for ( const configuredDomainCandidate of [
            this.global_config.static_hosting_domain,
            this.global_config.static_hosting_domain_alt,
            this.global_config.private_app_hosting_domain,
            this.global_config.private_app_hosting_domain_alt,
        ] ) {
            const normalizedDomain = this.normalizeHostnameForCookieDomain(configuredDomainCandidate);
            if ( normalizedDomain ) {
                configuredDomains.push(normalizedDomain);
            }
        }
        return [...new Set(configuredDomains)];
    }

    resolvePrivateAssetCookieDomain ({ requestHostname } = {}) {
        const configuredDomains = this.getConfiguredPrivateCookieDomains();
        const normalizedRequestHost = this.normalizeHostnameForCookieDomain(requestHostname);

        if ( normalizedRequestHost ) {
            const matchedConfiguredDomain = configuredDomains
                .sort((domainA, domainB) => domainB.length - domainA.length)
                .find(configuredDomain =>
                    normalizedRequestHost === configuredDomain ||
                    normalizedRequestHost.endsWith(`.${configuredDomain}`));
            if ( this.isCookieDomainHostEligible(matchedConfiguredDomain) ) {
                return `.${matchedConfiguredDomain}`;
            }
            return undefined;
        }

        const normalizedConfiguredPrimaryDomain = this.normalizeHostnameForCookieDomain(
            this.global_config.private_app_hosting_domain,
        );
        if ( this.isCookieDomainHostEligible(normalizedConfiguredPrimaryDomain) ) {
            return `.${normalizedConfiguredPrimaryDomain}`;
        }
        return undefined;
    }

    getPrivateAssetCookieOptions ({ ttlSeconds, requestHostname } = {}) {
        const effectiveTtlSeconds = this.resolvePositiveInteger(
            ttlSeconds,
            this.getPrivateAssetTokenTtlSeconds(),
        );

        const cookieOptions = {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
            path: '/',
            maxAge: effectiveTtlSeconds * 1000,
        };

        const cookieDomain = this.resolvePrivateAssetCookieDomain({ requestHostname });
        if ( cookieDomain ) {
            cookieOptions.domain = cookieDomain;
        }

        return cookieOptions;
    }

    resolvePublicHostedActorCookieDomain ({ requestHostname } = {}) {
        const configuredDomains = this.getConfiguredHostedCookieDomains();
        const normalizedRequestHost = this.normalizeHostnameForCookieDomain(requestHostname);

        if ( normalizedRequestHost ) {
            const matchedConfiguredDomain = configuredDomains
                .sort((domainA, domainB) => domainB.length - domainA.length)
                .find(configuredDomain =>
                    normalizedRequestHost === configuredDomain ||
                    normalizedRequestHost.endsWith(`.${configuredDomain}`));
            if ( this.isCookieDomainHostEligible(matchedConfiguredDomain) ) {
                return `.${matchedConfiguredDomain}`;
            }
            return undefined;
        }

        const [firstConfiguredDomain] = configuredDomains;
        if ( this.isCookieDomainHostEligible(firstConfiguredDomain) ) {
            return `.${firstConfiguredDomain}`;
        }
        return undefined;
    }

    getPublicHostedActorCookieOptions ({ ttlSeconds, requestHostname } = {}) {
        const effectiveTtlSeconds = this.resolvePositiveInteger(
            ttlSeconds,
            this.getPublicHostedActorTokenTtlSeconds(),
        );

        const cookieOptions = {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
            path: '/',
            maxAge: effectiveTtlSeconds * 1000,
        };

        const cookieDomain = this.resolvePublicHostedActorCookieDomain({
            requestHostname,
        });
        if ( cookieDomain ) {
            cookieOptions.domain = cookieDomain;
        }

        return cookieOptions;
    }

    normalizePrivateAssetSubdomain (subdomain) {
        if ( typeof subdomain !== 'string' ) return undefined;
        const normalizedSubdomain = subdomain.trim().toLowerCase();
        return normalizedSubdomain || undefined;
    }

    normalizePrivateAssetHost (privateHost) {
        if ( typeof privateHost !== 'string' ) return undefined;
        const normalizedPrivateHost = privateHost.trim().toLowerCase().replace(/^\./, '');
        if ( ! normalizedPrivateHost ) return undefined;
        return normalizedPrivateHost;
    }

    createPrivateAssetToken ({ appUid, userUid, sessionUuid, subdomain, privateHost, ttlSeconds } = {}) {
        if ( typeof appUid !== 'string' || !appUid.trim() ) {
            throw new Error('appUid is required to create private asset token.');
        }
        if ( typeof userUid !== 'string' || !userUid.trim() ) {
            throw new Error('userUid is required to create private asset token.');
        }
        if ( sessionUuid !== undefined && (typeof sessionUuid !== 'string' || !sessionUuid.trim()) ) {
            throw new Error('sessionUuid must be a non-empty string when provided.');
        }
        const normalizedSubdomain = this.normalizePrivateAssetSubdomain(subdomain);
        if ( subdomain !== undefined && !normalizedSubdomain ) {
            throw new Error('subdomain must be a non-empty string when provided.');
        }
        const normalizedPrivateHost = this.normalizePrivateAssetHost(privateHost);
        if ( privateHost !== undefined && !normalizedPrivateHost ) {
            throw new Error('privateHost must be a non-empty string when provided.');
        }

        const effectiveTtlSeconds = this.resolvePositiveInteger(
            ttlSeconds,
            this.getPrivateAssetTokenTtlSeconds(),
        );

        const payload = {
            type: 'app-private-asset',
            version: '0.0.0',
            app_uid: appUid.trim(),
            user_uid: userUid.trim(),
            ...(sessionUuid ? { session: this.uuid_fpe.encrypt(sessionUuid) } : {}),
            ...(normalizedSubdomain ? { subdomain: normalizedSubdomain } : {}),
            ...(normalizedPrivateHost ? { private_host: normalizedPrivateHost } : {}),
        };

        return this.tokenService.sign('auth', payload, {
            expiresIn: effectiveTtlSeconds,
        });
    }

    createPublicHostedActorToken ({ appUid, userUid, sessionUuid, subdomain, host, ttlSeconds } = {}) {
        if ( typeof appUid !== 'string' || !appUid.trim() ) {
            throw new Error('appUid is required to create public hosted actor token.');
        }
        if ( typeof userUid !== 'string' || !userUid.trim() ) {
            throw new Error('userUid is required to create public hosted actor token.');
        }
        if ( sessionUuid !== undefined && (typeof sessionUuid !== 'string' || !sessionUuid.trim()) ) {
            throw new Error('sessionUuid must be a non-empty string when provided.');
        }
        const normalizedSubdomain = this.normalizePrivateAssetSubdomain(subdomain);
        if ( subdomain !== undefined && !normalizedSubdomain ) {
            throw new Error('subdomain must be a non-empty string when provided.');
        }
        const normalizedHost = this.normalizePrivateAssetHost(host);
        if ( host !== undefined && !normalizedHost ) {
            throw new Error('host must be a non-empty string when provided.');
        }

        const effectiveTtlSeconds = this.resolvePositiveInteger(
            ttlSeconds,
            this.getPublicHostedActorTokenTtlSeconds(),
        );

        const payload = {
            type: 'app-public-hosted-actor',
            version: '0.0.0',
            app_uid: appUid.trim(),
            user_uid: userUid.trim(),
            ...(sessionUuid ? { session: this.uuid_fpe.encrypt(sessionUuid) } : {}),
            ...(normalizedSubdomain ? { subdomain: normalizedSubdomain } : {}),
            ...(normalizedHost ? { host: normalizedHost } : {}),
        };

        return this.tokenService.sign('auth', payload, {
            expiresIn: effectiveTtlSeconds,
        });
    }

    verifyPrivateAssetToken (
        token,
        { expectedAppUid, expectedUserUid, expectedSessionUuid, expectedSubdomain, expectedPrivateHost } = {},
    ) {
        let decoded;
        try {
            decoded = this.tokenService.verify('auth', token);
        } catch (e) {
            throw APIError.create('token_auth_failed');
        }

        if (
            !decoded ||
            decoded.type !== 'app-private-asset' ||
            typeof decoded.app_uid !== 'string' ||
            !decoded.app_uid ||
            typeof decoded.user_uid !== 'string' ||
            !decoded.user_uid
        ) {
            throw APIError.create('token_auth_failed');
        }

        let sessionUuid;
        if ( decoded.session !== undefined ) {
            if ( typeof decoded.session !== 'string' || !decoded.session ) {
                throw APIError.create('token_auth_failed');
            }
            try {
                sessionUuid = this.uuid_fpe.decrypt(decoded.session);
            } catch (e) {
                throw APIError.create('token_auth_failed');
            }
        }

        let subdomain;
        if ( decoded.subdomain !== undefined ) {
            if ( typeof decoded.subdomain !== 'string' || !decoded.subdomain.trim() ) {
                throw APIError.create('token_auth_failed');
            }
            subdomain = decoded.subdomain.trim().toLowerCase();
        }
        let privateHost;
        if ( decoded.private_host !== undefined ) {
            if ( typeof decoded.private_host !== 'string' || !decoded.private_host.trim() ) {
                throw APIError.create('token_auth_failed');
            }
            privateHost = decoded.private_host.trim().toLowerCase();
        }

        if ( expectedAppUid && decoded.app_uid !== expectedAppUid ) {
            throw APIError.create('token_auth_failed');
        }
        if ( expectedUserUid && decoded.user_uid !== expectedUserUid ) {
            throw APIError.create('token_auth_failed');
        }
        if ( expectedSessionUuid ) {
            if ( !sessionUuid || sessionUuid !== expectedSessionUuid ) {
                throw APIError.create('token_auth_failed');
            }
        }
        const normalizedExpectedSubdomain = this.normalizePrivateAssetSubdomain(expectedSubdomain);
        if ( expectedSubdomain !== undefined && !normalizedExpectedSubdomain ) {
            throw APIError.create('token_auth_failed');
        }
        if ( normalizedExpectedSubdomain ) {
            if ( !subdomain || subdomain !== normalizedExpectedSubdomain ) {
                throw APIError.create('token_auth_failed');
            }
        }
        const normalizedExpectedPrivateHost = this.normalizePrivateAssetHost(expectedPrivateHost);
        if ( expectedPrivateHost !== undefined && !normalizedExpectedPrivateHost ) {
            throw APIError.create('token_auth_failed');
        }
        if ( normalizedExpectedPrivateHost ) {
            if ( !privateHost || privateHost !== normalizedExpectedPrivateHost ) {
                throw APIError.create('token_auth_failed');
            }
        }

        return {
            appUid: decoded.app_uid,
            userUid: decoded.user_uid,
            sessionUuid,
            subdomain,
            privateHost,
            exp: decoded.exp,
            iat: decoded.iat,
        };
    }

    verifyPublicHostedActorToken (
        token,
        { expectedAppUid, expectedUserUid, expectedSessionUuid, expectedSubdomain, expectedHost } = {},
    ) {
        let decoded;
        try {
            decoded = this.tokenService.verify('auth', token);
        } catch (e) {
            throw APIError.create('token_auth_failed');
        }

        if (
            !decoded ||
            decoded.type !== 'app-public-hosted-actor' ||
            typeof decoded.app_uid !== 'string' ||
            !decoded.app_uid ||
            typeof decoded.user_uid !== 'string' ||
            !decoded.user_uid
        ) {
            throw APIError.create('token_auth_failed');
        }

        let sessionUuid;
        if ( decoded.session !== undefined ) {
            if ( typeof decoded.session !== 'string' || !decoded.session ) {
                throw APIError.create('token_auth_failed');
            }
            try {
                sessionUuid = this.uuid_fpe.decrypt(decoded.session);
            } catch (e) {
                throw APIError.create('token_auth_failed');
            }
        }

        let subdomain;
        if ( decoded.subdomain !== undefined ) {
            if ( typeof decoded.subdomain !== 'string' || !decoded.subdomain.trim() ) {
                throw APIError.create('token_auth_failed');
            }
            subdomain = decoded.subdomain.trim().toLowerCase();
        }

        let host;
        if ( decoded.host !== undefined ) {
            if ( typeof decoded.host !== 'string' || !decoded.host.trim() ) {
                throw APIError.create('token_auth_failed');
            }
            host = decoded.host.trim().toLowerCase();
        }

        if ( expectedAppUid && decoded.app_uid !== expectedAppUid ) {
            throw APIError.create('token_auth_failed');
        }
        if ( expectedUserUid && decoded.user_uid !== expectedUserUid ) {
            throw APIError.create('token_auth_failed');
        }
        if ( expectedSessionUuid ) {
            if ( !sessionUuid || sessionUuid !== expectedSessionUuid ) {
                throw APIError.create('token_auth_failed');
            }
        }

        const normalizedExpectedSubdomain = this.normalizePrivateAssetSubdomain(expectedSubdomain);
        if ( expectedSubdomain !== undefined && !normalizedExpectedSubdomain ) {
            throw APIError.create('token_auth_failed');
        }
        if ( normalizedExpectedSubdomain ) {
            if ( !subdomain || subdomain !== normalizedExpectedSubdomain ) {
                throw APIError.create('token_auth_failed');
            }
        }

        const normalizedExpectedHost = this.normalizePrivateAssetHost(expectedHost);
        if ( expectedHost !== undefined && !normalizedExpectedHost ) {
            throw APIError.create('token_auth_failed');
        }
        if ( normalizedExpectedHost ) {
            if ( !host || host !== normalizedExpectedHost ) {
                throw APIError.create('token_auth_failed');
            }
        }

        return {
            appUid: decoded.app_uid,
            userUid: decoded.user_uid,
            sessionUuid,
            subdomain,
            host,
            exp: decoded.exp,
            iat: decoded.iat,
        };
    }

    resolvePrivateBootstrapSessionUuid (decoded) {
        if ( !decoded || typeof decoded !== 'object' ) {
            return null;
        }

        if ( decoded.type === 'session' || decoded.type === 'gui' ) {
            if ( typeof decoded.uuid !== 'string' || !decoded.uuid ) {
                return null;
            }
            return decoded.uuid;
        }

        if ( decoded.type === 'app-under-user' ) {
            if ( typeof decoded.session !== 'string' || !decoded.session ) {
                return null;
            }
            try {
                return this.uuid_fpe.decrypt(decoded.session);
            } catch (e) {
                return null;
            }
        }

        return null;
    }

    async resolvePrivateBootstrapIdentityFromToken (token, { expectedAppUid, expectedAppUids } = {}) {
        let decoded;
        try {
            decoded = this.tokenService.verify('auth', token);
        } catch (e) {
            throw new Error('Token decode error');
        }

        const userUid = typeof decoded?.user_uid === 'string'
            ? decoded.user_uid
            : null;
        if ( ! userUid ) {
            throw new Error('Token missing uuid');
        }

        const allowedTypes = new Set(['session', 'gui', 'app-under-user']);
        if ( ! allowedTypes.has(decoded.type) ) {
            throw new Error(`Token wrong type: ${ decoded.type}`);
        }
        const bootstrapAppUid = typeof decoded?.app_uid === 'string'
            ? decoded.app_uid
            : null;
        const expectedAppUidCandidates = new Set();
        if ( typeof expectedAppUid === 'string' && expectedAppUid ) {
            expectedAppUidCandidates.add(expectedAppUid);
        }
        if ( Array.isArray(expectedAppUids) ) {
            for ( const appUidCandidate of expectedAppUids ) {
                if ( typeof appUidCandidate === 'string' && appUidCandidate ) {
                    expectedAppUidCandidates.add(appUidCandidate);
                }
            }
        }
        if (
            bootstrapAppUid
            && expectedAppUidCandidates.size > 0
            && !expectedAppUidCandidates.has(bootstrapAppUid)
        ) {
            throw new Error(`Token app uuid: ${ bootstrapAppUid } doesn't match expected appUuid candidates: ${ JSON.stringify(expectedAppUidCandidates)}`);
        }

        const sessionUuid = this.resolvePrivateBootstrapSessionUuid(decoded);
        if ( ! sessionUuid ) {
            throw new Error('Token missing sessionUuid');
        }

        const session = await this.get_session_(sessionUuid);
        if ( ! session ) {
            throw new Error('Token missing session');
        }

        const sessionUserUid = typeof session.user_uid === 'string'
            ? session.user_uid
            : null;
        if ( !sessionUserUid || sessionUserUid !== userUid ) {
            throw new Error('Token mismatch userId');
        }

        return {
            userUid,
            sessionUuid: session.uuid || sessionUuid,
        };
    }

    /**
     * Internal method for creating a session.
     *
     * If a request object is provided in the metadata, it will be used to
     * extract information about the requestor and include it in the
     * session's metadata.
     */
    async create_session_ (user, meta = {}) {
        this.log.debug('CREATING SESSION');

        if ( meta.req ) {
            const req = meta.req;
            delete meta.req;

            const ip = this.global_config.fowarded
                ? req.headers['x-forwarded-for'] ||
                req.connection.remoteAddress
                : req.connection.remoteAddress
                ;

            meta.ip = ip;

            meta.server = this.global_config.server_id;

            if ( req.headers['user-agent'] ) {
                meta.user_agent = req.headers['user-agent'];
            }

            if ( req.headers['referer'] ) {
                meta.referer = req.headers['referer'];
            }

            if ( req.headers['origin'] ) {
                const origin = this._origin_from_url(req.headers['origin']);
                if ( origin ) {
                    meta.origin = origin;
                }
            }

            if ( req.headers['host'] ) {
                const host = this._origin_from_url(req.headers['host']);
                if ( host ) {
                    meta.host = host;
                }
            }
        }

        return await this.svc_session.create_session(user, meta);
    }

    /**
     * Alias to SessionService's get_session method,
     * in case AuthService ever needs to wrap this functionality.
     */
    async get_session_ (uuid) {
        return await this.svc_session.get_session(uuid);
    }

    /**
     * Creates a session token using TokenService's sign method
     * with type 'session' using a newly created session for the
     * specified user.
     * @param {*} user
     * @param {*} meta
     * @returns
     */
    async create_session_token (user, meta) {
        const session = await this.create_session_(user, meta);

        const token = this.tokenService.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: session.uuid,
            // meta: session.meta,
            user_uid: user.uuid,
        });

        return { session, token };
    }

    /**
     * Creates a GUI token bound to the same session as the given session object.
     * GUI tokens create a UserActorType with hasHttpOnlyCookie false, so they cannot
     * access user-protected HTTP endpoints (e.g. change password). The GUI receives
     * only this token, not the full session token.
     *
     * @param {*} user - User object (must have .uuid).
     * @param {{ uuid: string }} session - Session object (must have .uuid).
     * @returns {string} JWT GUI token.
     */
    create_gui_token (user, session) {
        return this.tokenService.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });
    }

    /**
     * Creates a session token (hasHttpOnlyCookie) for an existing session.
     * Used when the client authenticated with a GUI token (e.g. QR login via
     * ?auth_token=) so we can set the HTTP-only cookie and allow user-protected
     * endpoints (change password, email, username, etc.) to work.
     *
     * @param {*} user - User object (must have .uuid).
     * @param {string} session_uuid - Existing session UUID.
     * @returns {string} JWT session token.
     */
    create_session_token_for_session (user, session_uuid) {
        return this.tokenService.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: session_uuid,
            user_uid: user.uuid,
        });
    }

    /**
    * This method checks if the provided session token is valid and returns the associated user and token.
    * If the token is not a valid session token or it does not exist in the database, it returns an empty object.
    *
    * @param {string} cur_token - The session token to be checked.
    * @param {object} meta - Additional metadata associated with the token.
    * @returns {object} Object containing the user and token if the token is valid, otherwise an empty object.
    */
    async check_session (cur_token, meta) {
        const decoded = this.tokenService.verify('auth', cur_token);

        console.debug('\x1B[36;1mDECODED SESSION', decoded);

        if ( decoded.type && decoded.type !== 'session' && decoded.type !== 'gui' ) {
            return {};
        }

        const is_legacy = !decoded.type;

        const user = await get_user({ uuid:
            is_legacy ? decoded.uuid : decoded.user_uid,
        });
        if ( ! user ) {
            return {};
        }

        if ( ! is_legacy ) {
            // Ensure session exists
            const session = await this.get_session_(decoded.uuid);
            if ( ! session ) {
                return {};
            }

            // Return GUI token to client (if they sent session token, exchange for GUI token)
            const gui_token = decoded.type === 'gui'
                ? cur_token
                : this.create_gui_token(user, session);
            return { user, token: gui_token };
        }

        this.log.info('UPGRADING SESSION');

        // Upgrade legacy token
        // TODO: phase this out
        const { session, token: session_token } = await this.create_session_token(user, meta);
        const gui_token = this.create_gui_token(user, session);

        const actor_type = new UserActorType({
            user,
            session,
            hasHttpOnlyCookie: true,
        });

        const actor = new Actor({
            user_uid: user.uuid,
            type: actor_type,
        });

        // token = GUI token for client (response body); session_token = for HTTP-only cookie
        return { actor, user, token: gui_token, session_token };
    }

    /**
    * Removes a session with the specified token
    *
    * @param {string} token - The token to be authenticated.
    * @returns {Promise<void>}
    */
    async remove_session_by_token (token) {
        const decoded = this.tokenService.verify('auth', token);

        if ( decoded.type !== 'session' && decoded.type !== 'gui' ) {
            return;
        }

        await this.svc_session.remove_session(decoded.uuid);
    }

    /**
     * This method is used to create an access token for a user or an application.
     *
     * Access tokens aren't currently used by any of Puter's features.
     * The feature is kept here for future-use.
     *
     * @param {1} authorizer - The actor that is creating the access token.
     * @param {*} permissions - The permissions to be granted to the access token.
     * @returns
     */
    async create_access_token (authorizer, permissions, options) {
        const jwt_obj = {};
        const authorizer_obj = {};
        if ( authorizer.type instanceof UserActorType ) {
            Object.assign(authorizer_obj, {
                authorizer_user_id: authorizer.type.user.id,
            });
            const user = await get_user({ id: authorizer.type.user.id });
            jwt_obj.user_uid = user.uuid;
        }
        else if ( authorizer.type instanceof AppUnderUserActorType ) {
            Object.assign(authorizer_obj, {
                authorizer_user_id: authorizer.type.user.id,
                authorizer_app_id: authorizer.type.app.id,
            });
            const user = await get_user({ id: authorizer.type.user.id });
            jwt_obj.user_uid = user.uuid;
            const app = await get_app({ id: authorizer.type.app.id });
            jwt_obj.app_uid = app.uid;
        }
        else {
            throw APIError.create('forbidden');
        }

        const uuid = uuidLib.v4();

        const jwt = this.tokenService.sign('auth', {
            type: 'access-token',
            version: '0.0.0',
            token_uid: uuid,
            ...jwt_obj,
        }, options);

        for ( const permmission_spec of permissions ) {
            let [permission, extra] = permmission_spec;

            const svc_permission = await Context.get('services').get('permission');
            permission = await svc_permission._rewrite_permission(permission);

            const insert_object = {
                token_uid: uuid,
                ...authorizer_obj,
                permission,
                extra: JSON.stringify(extra ?? {}),
            };
            const cols = Object.keys(insert_object).join(', ');
            const vals = Object.values(insert_object).map(() => '?').join(', ');
            await this.db.write(
                'INSERT INTO `access_token_permissions` ' +
                `(${cols}) VALUES (${vals})`,
                Object.values(insert_object),
            );
        }

        console.log('token uuid?', uuid);

        return jwt;
    }

    /**
     * Revokes an access token by removing it from the database.
     * Accepts either the access token JWT or the token UUID.
     *
     * @param {string} tokenOrUuid - The access token JWT or the token UUID.
     * @returns {Promise<void>}
     */
    async revoke_access_token (tokenOrUuid) {
        let token_uid;
        const isJwt = typeof tokenOrUuid === 'string' &&
            /^[\w-]*\.[\w-]*\.[\w-]*$/.test(tokenOrUuid.trim());
        if ( isJwt ) {
            const decoded = this.tokenService.verify('auth', tokenOrUuid);
            if ( decoded.type !== 'access-token' || !decoded.token_uid ) {
                throw APIError.create('token_auth_failed');
            }
            token_uid = decoded.token_uid;
        } else {
            token_uid = tokenOrUuid;
        }

        await this.db.write(
            'DELETE FROM `access_token_permissions` WHERE `token_uid` = ?',
            [token_uid],
        );
    }

    /**
     * Get the session list for the specified actor.
     *
     * This is primarily used by the `/list-sessions` API endpoint
     * for the Session Manager in Puter's settings window.
     *
     * @param {*} actor - The actor for which to list sessions.
     * @returns {Promise<Array>} - A list of sessions for the actor.
     */
    async list_sessions (actor) {
        const seen = new Set();
        const sessions = [];

        const cache_sessions = this.svc_session.get_user_sessions(actor.type.user);
        for ( const session of cache_sessions ) {
            seen.add(session.uuid);
            sessions.push(session);
        }

        // We won't take the cached sessions here because it's
        // possible the user has sessions on other servers
        const db_sessions = await this.db.read(
            'SELECT uuid, meta FROM `sessions` WHERE `user_id` = ?',
            [actor.type.user.id],
        );

        for ( const session of db_sessions ) {
            if ( seen.has(session.uuid) ) {
                continue;
            }
            session.meta = this.db.case({
                mysql: () => session.meta,
                /**
                * This method is responsible for authenticating a user or app using a token. It decodes the token and checks if it's valid, then returns an appropriate actor object based on the token type.
                *
                * @param {string} token - The user or app access token.
                * @returns {Actor} - Actor object representing the authenticated user or app.
                */
                otherwise: () => JSON.parse(session.meta ?? '{}'),
            })();
            sessions.push(session);
        };

        for ( const session of sessions ) {
            if ( session.uuid === actor.type.session ) {
                session.current = true;
            }
        }

        return sessions;
    }

    /**
     * Revokes a session by UUID. The actor is ignored but should be provided
     * for future use.
     *
     * @param {*} actor
     * @param {*} uuid
     */
    async revoke_session (actor, uuid) {
        delete this.sessions[uuid];
        this.svc_session.remove_session(uuid);
    }

    /**
     * This method is used to create or obtain a user-app token deterministically
     * from an origin at which puter.js might be embedded.
     *
     * @param {*} origin - The origin URL at which puter.js is embedded.
     * @returns
     */
    async get_user_app_token_from_origin (origin) {
        origin = this._origin_from_url(origin);
        if ( origin === null ) {
            throw APIError.create('no_origin_for_app');
        }

        const canonicalAppUid = await this.resolveCanonicalAppUidFromOrigin(origin);
        const app_uid = canonicalAppUid ?? await this._app_uid_from_origin(origin);

        // Determine if the app exists
        const apps = await this.db.read(
            'SELECT * FROM `apps` WHERE `uid` = ? LIMIT 1',
            [app_uid],
        );

        if ( apps[0] ) {
            return this.get_user_app_token(app_uid);
        }

        this.log.info(`creating app ${app_uid} from origin ${origin}`);

        const name = app_uid;
        const title = app_uid;
        const description = `App created from origin ${origin}`;
        const index_url = origin;
        const owner_user_id = null;

        // Create the app
        await this.db.write(
            'INSERT INTO `apps` ' +
            '(`uid`, `name`, `title`, `description`, `index_url`, `owner_user_id`) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
            [app_uid, name, title, description, index_url, owner_user_id],
        );

        await this.invalidateCanonicalAppUidCacheForOrigins([origin]);

        return this.get_user_app_token(app_uid);
    }

    /**
     * Generates a deterministic app uuid from an origin
     *
     * @param {*} origin
     * @returns
     */
    async app_uid_from_origin (origin) {
        origin = this._origin_from_url(origin);
        if ( origin === null ) {
            throw APIError.create('no_origin_for_app');
        }
        const canonicalAppUid = await this.resolveCanonicalAppUidFromOrigin(origin);
        if ( canonicalAppUid ) {
            return canonicalAppUid;
        }
        return await this._app_uid_from_origin(origin);
    }

    getAppOriginCanonicalCacheTtlSeconds () {
        return this.resolvePositiveInteger(
            this.global_config.app_origin_canonical_cache_ttl_seconds,
            DEFAULT_APP_ORIGIN_CANONICAL_CACHE_TTL_SECONDS,
        );
    }

    buildAppOriginCanonicalCacheKey ({ origin }) {
        const encodedOrigin = encodeURIComponent(origin);
        return `${APP_ORIGIN_CACHE_KEY_PREFIX}:${encodedOrigin}`;
    }

    createAppOriginLocalCacheNamespace () {
        return `${APP_ORIGIN_LOCAL_CACHE_KEY_PREFIX}:${uuidLib.v4()}`;
    }

    getAppOriginLocalCacheNamespace () {
        if (
            typeof this.appOriginCanonicalizationLocalCacheNamespace !== 'string'
            || !this.appOriginCanonicalizationLocalCacheNamespace
        ) {
            this.appOriginCanonicalizationLocalCacheNamespace = this.createAppOriginLocalCacheNamespace();
        }
        return this.appOriginCanonicalizationLocalCacheNamespace;
    }

    buildLocalCanonicalAppUidCacheKey (origin) {
        const encodedOrigin = encodeURIComponent(origin);
        return `${this.getAppOriginLocalCacheNamespace()}:${encodedOrigin}`;
    }

    readLocalCanonicalAppUidFromCache (origin) {
        const localCacheKey = this.buildLocalCanonicalAppUidCacheKey(origin);
        const cachedResolution = kv.get(localCacheKey);
        if ( !cachedResolution || typeof cachedResolution !== 'object' ) {
            return undefined;
        }
        if ( ! Object.prototype.hasOwnProperty.call(cachedResolution, 'appUid') ) {
            return undefined;
        }
        return cachedResolution.appUid;
    }

    writeLocalCanonicalAppUidToCache (origin, appUid) {
        const ttlSeconds = this.getAppOriginCanonicalCacheTtlSeconds();
        const localCacheKey = this.buildLocalCanonicalAppUidCacheKey(origin);
        kv.set(localCacheKey, {
            appUid: appUid ?? null,
        }, { EX: ttlSeconds });
    }

    async readCanonicalAppUidFromRedisCache (origin) {
        const cacheKey = this.buildAppOriginCanonicalCacheKey({
            origin,
        });

        try {
            const cachedPayload = await redisClient.get(cacheKey);
            if ( typeof cachedPayload !== 'string' || cachedPayload === '' ) {
                return undefined;
            }

            const parsedPayload = JSON.parse(cachedPayload);
            if ( !parsedPayload || typeof parsedPayload !== 'object' ) {
                return undefined;
            }
            if ( ! Object.prototype.hasOwnProperty.call(parsedPayload, 'appUid') ) {
                return undefined;
            }
            return parsedPayload.appUid ?? null;
        } catch {
            return undefined;
        }
    }

    async writeCanonicalAppUidToRedisCache (origin, appUid) {
        const cacheKey = this.buildAppOriginCanonicalCacheKey({
            origin,
        });

        await setRedisCacheValue(
            cacheKey,
            JSON.stringify({ appUid: appUid ?? null }),
            { ttlSeconds: this.getAppOriginCanonicalCacheTtlSeconds() },
        );
    }

    async resolveCanonicalAppUidFromOrigin (origin) {
        const normalizedOrigin = this._origin_from_url(origin);
        if ( normalizedOrigin === null ) return null;

        const canonicalOrigin = this.canonicalizeHostedAppOriginForUid(normalizedOrigin);
        const localCachedAppUid = this.readLocalCanonicalAppUidFromCache(canonicalOrigin);
        if ( localCachedAppUid !== undefined ) {
            return localCachedAppUid;
        }

        const redisCachedAppUid = await this.readCanonicalAppUidFromRedisCache(canonicalOrigin);
        if ( redisCachedAppUid !== undefined ) {
            this.writeLocalCanonicalAppUidToCache(canonicalOrigin, redisCachedAppUid);
            return redisCachedAppUid;
        }

        const canonicalAppUid = await this.lookupCanonicalAppUidFromOrigin(canonicalOrigin);
        this.writeLocalCanonicalAppUidToCache(canonicalOrigin, canonicalAppUid);
        try {
            await this.writeCanonicalAppUidToRedisCache(canonicalOrigin, canonicalAppUid);
        } catch {
            // Redis cache writes are best-effort.
        }
        return canonicalAppUid;
    }

    normalizeOriginForCanonicalAppUidCache (originCandidate) {
        const normalizedOrigin = this._origin_from_url(originCandidate);
        if ( normalizedOrigin === null ) return null;
        return this.canonicalizeHostedAppOriginForUid(normalizedOrigin);
    }

    collectCanonicalCacheOriginsFromAppChangeEvent (event = {}) {
        const originCandidates = [];
        if ( event?.app?.index_url ) {
            originCandidates.push(event.app.index_url);
        }
        if ( event?.old_app?.index_url ) {
            originCandidates.push(event.old_app.index_url);
        }
        if ( event?.index_url ) {
            originCandidates.push(event.index_url);
        }
        if ( event?.old_index_url ) {
            originCandidates.push(event.old_index_url);
        }

        const canonicalOrigins = new Set();
        for ( const originCandidate of originCandidates ) {
            const normalizedCanonicalOrigin = this.normalizeOriginForCanonicalAppUidCache(originCandidate);
            if ( normalizedCanonicalOrigin ) {
                canonicalOrigins.add(normalizedCanonicalOrigin);
            }
        }

        return [...canonicalOrigins];
    }

    async invalidateCanonicalAppUidCacheForOrigins (originCandidates = []) {
        const canonicalOrigins = new Set();
        for ( const originCandidate of originCandidates ) {
            const normalizedCanonicalOrigin = this.normalizeOriginForCanonicalAppUidCache(originCandidate);
            if ( normalizedCanonicalOrigin ) {
                canonicalOrigins.add(normalizedCanonicalOrigin);
            }
        }

        if ( canonicalOrigins.size === 0 ) return;

        const localCacheKeys = [];
        const redisCacheKeys = [];
        for ( const canonicalOrigin of canonicalOrigins ) {
            localCacheKeys.push(this.buildLocalCanonicalAppUidCacheKey(canonicalOrigin));
            redisCacheKeys.push(this.buildAppOriginCanonicalCacheKey({ origin: canonicalOrigin }));
        }

        if ( localCacheKeys.length > 0 ) {
            kv.del(...localCacheKeys);
        }
        if ( redisCacheKeys.length > 0 ) {
            try {
                await deleteRedisKeys(redisCacheKeys);
            } catch {
                // best-effort invalidation; cache TTL bounds stale reads.
            }
        }
    }

    async invalidateCanonicalAppUidCacheFromAppChangeEvent (event = {}) {
        const canonicalOrigins = this.collectCanonicalCacheOriginsFromAppChangeEvent(event);
        await this.invalidateCanonicalAppUidCacheForOrigins(canonicalOrigins);
    }

    buildIndexUrlCandidatesFromOrigin (origin) {
        try {
            const parsedOrigin = new URL(origin);
            const hostCandidates = new Set();
            hostCandidates.add(parsedOrigin.host.toLowerCase());

            const hostedSubdomain = this.extractHostedAppSubdomainFromHostname(parsedOrigin.hostname);
            if ( hostedSubdomain ) {
                const hostedDomainCandidates = this.getHostedAppDomainCandidatesForMatch();
                for ( const hostedDomainCandidate of hostedDomainCandidates ) {
                    if ( hostedDomainCandidate?.host ) {
                        hostCandidates.add(`${hostedSubdomain}.${hostedDomainCandidate.host}`);
                    }
                }
            }

            const indexUrlCandidates = [];
            for ( const hostCandidate of hostCandidates ) {
                const baseUrl = `${parsedOrigin.protocol}//${hostCandidate}`;
                indexUrlCandidates.push(baseUrl);
                indexUrlCandidates.push(`${baseUrl}/`);
                indexUrlCandidates.push(`${baseUrl}/index.html`);
            }

            return [...new Set(indexUrlCandidates)];
        } catch {
            return [];
        }
    }

    async getHostedSubdomainOwnerUserId (subdomain) {
        if ( typeof subdomain !== 'string' || !subdomain ) return null;
        try {
            const databaseService = this.services.get('database');
            const dbReadSites = databaseService.get(DB_READ, 'sites');
            const rows = await dbReadSites.read(
                'SELECT user_id FROM subdomains WHERE subdomain = ? LIMIT 1',
                [subdomain],
            );
            const ownerUserId = Number(rows?.[0]?.user_id);
            if ( Number.isInteger(ownerUserId) && ownerUserId > 0 ) {
                return ownerUserId;
            }
            return null;
        } catch {
            return null;
        }
    }

    async queryOldestAppUidForIndexUrlCandidates ({
        indexUrlCandidates,
        ownerUserId,
    }) {
        if ( !Array.isArray(indexUrlCandidates) || indexUrlCandidates.length === 0 ) {
            return null;
        }

        const placeholders = indexUrlCandidates.map(() => '?').join(', ');
        const parameters = [];
        let whereClause = `index_url IN (${placeholders})`;
        parameters.push(...indexUrlCandidates);

        if ( Number.isInteger(ownerUserId) && ownerUserId > 0 ) {
            whereClause = `owner_user_id = ? AND ${whereClause}`;
            parameters.unshift(ownerUserId);
        }

        try {
            const dbReadApps = this.services.get('database').get(DB_READ, 'apps');
            const rows = await dbReadApps.read(
                `SELECT uid FROM apps WHERE ${whereClause} ORDER BY timestamp ASC, id ASC LIMIT 1`,
                parameters,
            );
            const oldestAppUid = rows?.[0]?.uid;
            if ( typeof oldestAppUid === 'string' && oldestAppUid ) {
                return oldestAppUid;
            }
        } catch {
            return null;
        }

        return null;
    }

    async lookupCanonicalAppUidFromOrigin (origin) {
        const indexUrlCandidates = this.buildIndexUrlCandidatesFromOrigin(origin);
        if ( indexUrlCandidates.length === 0 ) return null;

        try {
            const parsedOrigin = new URL(origin);
            const hostedSubdomain = this.extractHostedAppSubdomainFromHostname(parsedOrigin.hostname);

            if ( hostedSubdomain ) {
                const hostedSubdomainOwnerUserId = await this.getHostedSubdomainOwnerUserId(hostedSubdomain);
                if ( ! hostedSubdomainOwnerUserId ) {
                    return null;
                }
                return await this.queryOldestAppUidForIndexUrlCandidates({
                    ownerUserId: hostedSubdomainOwnerUserId,
                    indexUrlCandidates,
                });
            }

            return await this.queryOldestAppUidForIndexUrlCandidates({ indexUrlCandidates });
        } catch {
            return null;
        }
    }

    normalizeHostedDomainCandidate (domainValue) {
        if ( typeof domainValue !== 'string' ) return null;

        const normalizedDomainValue = domainValue.trim().toLowerCase().replace(/^\./, '');
        if ( ! normalizedDomainValue ) return null;

        try {
            const parsedDomain = new URL(`http://${normalizedDomainValue}`);
            return {
                host: parsedDomain.host.toLowerCase(),
                hostname: parsedDomain.hostname.toLowerCase(),
            };
        } catch {
            const [hostname] = normalizedDomainValue.split(':');
            if ( ! hostname ) return null;
            return {
                host: normalizedDomainValue,
                hostname,
            };
        }
    }

    getHostedAppDomainCandidatesForMatch () {
        const hostedDomainCandidates = [];
        const seenHostnames = new Set();

        for ( const domainCandidate of [
            this.global_config.static_hosting_domain,
            this.global_config.static_hosting_domain_alt,
            this.global_config.private_app_hosting_domain,
            this.global_config.private_app_hosting_domain_alt,
        ] ) {
            const normalizedDomainCandidate = this.normalizeHostedDomainCandidate(domainCandidate);
            if ( ! normalizedDomainCandidate ) continue;
            if ( seenHostnames.has(normalizedDomainCandidate.hostname) ) continue;
            seenHostnames.add(normalizedDomainCandidate.hostname);
            hostedDomainCandidates.push(normalizedDomainCandidate);
        }

        return hostedDomainCandidates;
    }

    getCanonicalHostedAppDomain () {
        for ( const domainCandidate of [
            this.global_config.static_hosting_domain,
            this.global_config.static_hosting_domain_alt,
            this.global_config.private_app_hosting_domain,
            this.global_config.private_app_hosting_domain_alt,
        ] ) {
            const normalizedDomainCandidate = this.normalizeHostedDomainCandidate(domainCandidate);
            if ( normalizedDomainCandidate?.host ) {
                return normalizedDomainCandidate.host;
            }
        }
        return null;
    }

    extractHostedAppSubdomainFromHostname (hostname) {
        if ( typeof hostname !== 'string' ) return null;
        const normalizedHostname = hostname.trim().toLowerCase();
        if ( ! normalizedHostname ) return null;

        const hostedDomainCandidates = this.getHostedAppDomainCandidatesForMatch()
            .sort((domainCandidateA, domainCandidateB) =>
                domainCandidateB.hostname.length - domainCandidateA.hostname.length);

        for ( const hostedDomainCandidate of hostedDomainCandidates ) {
            if ( normalizedHostname === hostedDomainCandidate.hostname ) {
                return null;
            }
            const hostedDomainSuffix = `.${hostedDomainCandidate.hostname}`;
            if ( normalizedHostname.endsWith(hostedDomainSuffix) ) {
                const subdomain = normalizedHostname.slice(
                    0,
                    normalizedHostname.length - hostedDomainSuffix.length,
                );
                return subdomain || null;
            }
        }

        return null;
    }

    canonicalizeHostedAppOriginForUid (origin) {
        try {
            const parsedOrigin = new URL(origin);
            const hostedSubdomain = this.extractHostedAppSubdomainFromHostname(parsedOrigin.hostname);
            if ( ! hostedSubdomain ) return origin;

            const canonicalHostedDomain = this.getCanonicalHostedAppDomain();
            if ( ! canonicalHostedDomain ) return origin;

            return `${parsedOrigin.protocol}//${hostedSubdomain}.${canonicalHostedDomain}`;
        } catch {
            return origin;
        }
    }

    async _app_uid_from_origin (origin) {
        const canonicalOrigin = this.canonicalizeHostedAppOriginForUid(origin);
        const event = { origin: canonicalOrigin };
        const eventService = this.services.get('event');
        await eventService.emit('app.from-origin', event);
        // UUIDV5
        const uuid = uuidLib.v5(event.origin, APP_ORIGIN_UUID_NAMESPACE);
        return `app-${uuid}`;
    }

    _origin_from_url ( url ) {
        try {
            const parsedUrl = new URL(url);
            // Origin is protocol + hostname + port
            return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}`;
        } catch ( error ) {
            console.error('Invalid URL:', error.message);
            return null;
        }
    }

    /**
     * Registers GET /get-gui-token. Must be called from the GUI origin (no api. subdomain)
     * so the HTTP-only session cookie is sent. Returns the GUI token for use in Authorization headers.
     */
    '__on_install.routes' () {
        const { app } = this.services.get('web-server');
        const config = require('../../config');
        const configurable_auth = require('../../middleware/configurable_auth');
        const { Endpoint } = require('../../util/expressutil');
        const svc_auth = this;

        Endpoint({
            route: '/get-gui-token',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                if ( ! req.user ) {
                    return res.status(401).json({});
                }

                const actor = Context.get('actor');
                if ( ! (actor.type instanceof UserActorType) ) {
                    return res.status(403).json({});
                }
                if ( ! actor.type.session ) {
                    return res.status(400).json({ error: 'No session bound to this actor' });
                }

                const gui_token = svc_auth.create_gui_token(actor.type.user, { uuid: actor.type.session });
                return res.json({ token: gui_token });
            },
        }).attach(app);

        // Sync HTTP-only session cookie to the user implied by the request's auth token.
        // Used when switching users in the UI: client sends Authorization with the new user's
        // GUI token; we set the session cookie so cookie-based (e.g. user-protected) requests match.
        Endpoint({
            route: '/session/sync-cookie',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                if ( ! req.user ) {
                    return res.status(401).end();
                }
                const actor = Context.get('actor');
                if ( !(actor.type instanceof UserActorType) || !actor.type.session ) {
                    return res.status(400).end();
                }
                const session_token = svc_auth.create_session_token_for_session(
                    actor.type.user,
                    actor.type.session,
                );
                res.cookie(config.cookie_name, session_token, {
                    sameSite: 'none',
                    secure: true,
                    httpOnly: true,
                });
                return res.status(204).end();
            },
        }).attach(app);
    }
}

module.exports = {
    AuthService,
    LegacyTokenError,
};
