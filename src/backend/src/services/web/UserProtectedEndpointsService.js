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
const { get_user } = require('../../helpers');
const auth2 = require('../../middleware/auth2');
const { Context } = require('../../util/context');
const BaseService = require('../BaseService');
const { UserActorType } = require('../auth/Actor');
const { Endpoint } = require('../../util/expressutil');
const APIError = require('../../api/APIError.js');
const configurable_auth = require('../../middleware/configurable_auth.js');
const config = require('../../config');
const jwt = require('jsonwebtoken');

const REVALIDATION_COOKIE_NAME = 'puter_revalidation';

async function revalidateUrlFields_ (svc, req, user) {
    const origin = (config.origin || '').replace(/\/$/, '');
    const svc_oidc = req.services.get('oidc');
    const providers = await svc_oidc.getEnabledProviderIds();
    const provider = providers && providers[0];
    if ( ! provider ) return {};
    return { revalidate_url: `${origin}/auth/oidc/${provider}/start?flow=revalidate&user_id=${user.id}` };
}

/**
* @class UserProtectedEndpointsService
* @extends BaseService
* @classdesc
* This service manages endpoints that are protected by password authentication,
* excluding login. It ensures that only authenticated user sessions can access
* these endpoints, which typically involve actions affecting security settings
* such as changing passwords, email addresses, or disabling two-factor authentication.
* The service also handles middleware for rate limiting, session validation,
* and password verification for security-critical operations.
*/
class UserProtectedEndpointsService extends BaseService {
    static MODULES = {
        express: require('express'),
    };

    /**
    * Sets up and configures routes for user-protected endpoints.
    * This method initializes an Express router, applies middleware for authentication,
    * rate limiting, and session validation, and attaches user-specific endpoints.
    *
    * @memberof UserProtectedEndpointsService
    * @instance
    * @method __on_install.routes
    */
    '__on_install.routes' () {
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        const { app } = this.services.get('web-server');
        app.use('/user-protected', router);

        // Apply edge (unauthenticated) rate-limiting
        router.use((req, res, next) => {
            if ( req.method === 'OPTIONS' ) return next();

            const svc_edgeRateLimit = req.services.get('edge-rate-limit');
            if ( ! svc_edgeRateLimit.check(req.baseUrl + req.path) ) {
                return APIError.create('too_many_requests').write(res);
            }
            next();
        });

        // Require authenticated session
        router.use(configurable_auth({ no_options_auth: true }));

        // Only allow user sessions with HTTP powers (session token), not GUI tokens or API tokens
        router.use((req, res, next) => {
            if ( req.method === 'OPTIONS' ) return next();

            const actor = Context.get('actor');
            if ( ! (actor.type instanceof UserActorType) ) {
                return APIError.create('user_tokens_only').write(res);
            }
            if ( ! actor.type.hasHttpPowers ) {
                return APIError.create('session_required').write(res);
            }
            next();
        });

        // Prioritize consistency for user object
        router.use(async (req, res, next) => {
            if ( req.method === 'OPTIONS' ) return next();
            const user = await get_user({ id: req.user.id, force: true });
            req.user = user;
            next();
        });

        // Do not allow temporary users
        router.use(async (req, res, next) => {
            if ( req.method === 'OPTIONS' ) return next();

            if ( req.user.password === null && req.user.email === null ) {
                return APIError.create('temporary_account').write(res);
            }
            next();
        });

        /**
        * Middleware to validate identity: either password (bcrypt) or a valid OIDC revalidation cookie.
        * OIDC-only accounts (user.password === null) must use revalidation; password accounts may use either.
        */
        router.use(async (req, res, next) => {
            if ( req.method === 'OPTIONS' ) return next();

            const user = await get_user({ id: req.user.id, force: true });
            const revalidationCookie = req.cookies && req.cookies[REVALIDATION_COOKIE_NAME];

            if ( req.body.password ) {
                if ( user.password === null ) {
                    return (APIError.create('oidc_revalidation_required', null, await revalidateUrlFields_(this, req, user))).write(res);
                }
                const bcrypt = (() => {
                    const require = this.require;
                    return require('bcrypt');
                })();
                const isMatch = await bcrypt.compare(req.body.password, user.password);
                if ( ! isMatch ) {
                    return APIError.create('password_mismatch').write(res);
                }
                return next();
            }

            if ( revalidationCookie ) {
                try {
                    const payload = jwt.verify(revalidationCookie, config.jwt_secret);
                    if ( payload.purpose === 'revalidate' && payload.user_id === req.user.id ) {
                        return next();
                    }
                } catch ( e ) {
                    // invalid or expired
                }
            }

            if ( user.password === null ) {
                return (APIError.create('oidc_revalidation_required', null, await revalidateUrlFields_(this, req, user))).write(res);
            }
            return (APIError.create('password_required')).write(res);
        });

        Endpoint(require('../../routers/user-protected/change-password.js')).attach(router);

        Endpoint(require('../../routers/user-protected/change-email.js')).attach(router);

        Endpoint(require('../../routers/user-protected/change-username.js')).attach(router);

        Endpoint(require('../../routers/user-protected/disable-2fa.js')).attach(router);
    }
}

module.exports = {
    UserProtectedEndpointsService,
};
