/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const APIError = require("../api/APIError");
const config = require("../config");
const { Context } = require("../util/context");

// TODO: Allow auth middleware to be used without requiring
// authentication. This will allow us to use the auth middleware
// in endpoints that do not require authentication, but can
// provide additional functionality if the user is authenticated.
const auth2 = async (req, res, next) => {

    // === Getting the Token ===
    // This step came from jwt_auth in src/helpers.js
    // However, since request-response handling is a concern of the
    // auth middleware, it makes more sense to put it here.

    let token;
    // HTTML Auth header
    if(req.header && req.header('Authorization'))
        token = req.header('Authorization');
    // Cookie
    else if(req.cookies && req.cookies[config.cookie_name])
        token = req.cookies[config.cookie_name];
    // Auth token in URL
    else if(req.query && req.query.auth_token)
        token = req.query.auth_token;
    // Socket
    else if(req.handshake && req.handshake.query && req.handshake.query.auth_token)
        token = req.handshake.query.auth_token;

    if(!token) {
        APIError.create('token_missing').write(res);
    } else if (typeof token !== 'string') {
        APIError.create('token_auth_failed').write(res);
    } else {
        token = token.replace('Bearer ', '')
    }

    // === Delegate to AuthService ===
    // AuthService will attempt to authenticate the token and return
    // an Actor object, which is a high-level representation of the
    // entity that is making the request; it could be a user, an app
    // acting on behalf of a user, or an app acting on behalf of itself.

    const context = Context.get();
    const services = context.get('services');
    const svc_auth = services.get('auth');

    let actor; try {
        actor = await svc_auth.authenticate_from_token(token);
    } catch ( e ) {
        if ( e instanceof APIError ) {
            e.write(res);
            return;
        }
        const re = APIError.create('token_auth_failed');
        re.write(res);
        return;
    }

    // === Populate Context ===
    context.set('actor', actor);
    if ( actor.type.user ) context.set('user', actor.type.user);

    // === Populate Request ===
    req.actor = actor;
    req.user = actor.type.user;
    req.token = token;

    next();
};

module.exports = auth2;
