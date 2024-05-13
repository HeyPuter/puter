const { get_user } = require("../../helpers");
const auth2 = require("../../middleware/auth2");
const { Context } = require("../../util/context");
const BaseService = require("../BaseService");
const { UserActorType } = require("../auth/Actor");
const { Endpoint } = require("../../util/expressutil");
const APIError = require("../../api/APIError.js");

/**
 * This service registers endpoints that are protected by password authentication,
 * excluding login. These endpoints are typically for actions that affect
 * security settings on the user's account.
 */
class UserProtectedEndpointsService extends BaseService {
    static MODULES = {
        express: require('express'),
    };

    ['__on_install.routes'] () {
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })()

        const { app } = this.services.get('web-server');
        app.use('/user-protected', router);

        // Apply edge (unauthenticated) rate-limiting
        router.use((req, res, next) => {
            const svc_edgeRateLimit = req.services.get('edge-rate-limit');
            if ( ! svc_edgeRateLimit.check(req.baseUrl + req.path) ) {
                return APIError.create('too_many_requests').write(res);
            }
            next();
        })

        // Require authenticated session
        router.use(auth2);

        // Only allow user sessions, not API tokens for apps
        router.use((req, res, next) => {
            const actor = Context.get('actor');
            if ( ! (actor.type instanceof UserActorType) ) {
                return APIError.create('user_tokens_only').write(res);
            }
            next();
        });

        // Prioritize consistency for user object
        router.use(async (req, res, next) => {
            const user = await get_user({ id: req.user.id, force: true });
            req.user = user;
            next();
        });

        // Do not allow temporary users
        router.use(async (req, res, next) => {
            if ( req.user.password === null ) {
                return APIError.create('temporary_account').write(res);
            }
            next();
        });

        // Require password in request
        router.use(async (req, res, next) => {
            if ( ! req.body.password ) {
                return (APIError.create('password_required')).write(res);
            }

            const bcrypt = (() => {
                const require = this.require;
                return require('bcrypt');
            })();

            const user = await get_user({ id: req.user.id, force: true });
            const isMatch = await bcrypt.compare(req.body.password, user.password);
            if ( ! isMatch ) {
                return APIError.create('password_mismatch').write(res);
            }
            next();
        });

        Endpoint(
            require('../../routers/user-protected/change-password.js'),
        ).attach(router);

        Endpoint(
            require('../../routers/user-protected/change-email.js'),
        ).attach(router);

        Endpoint(
            require('../../routers/user-protected/disable-2fa.js'),
        ).attach(router);
    }
}

module.exports = {
    UserProtectedEndpointsService
};
