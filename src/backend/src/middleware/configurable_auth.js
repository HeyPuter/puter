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
const APIError = require('../api/APIError');
const config = require("../config");
const { LegacyTokenError } = require("../services/auth/AuthService");
const { Context } = require("../util/context");

// The "/whoami" endpoint is a special case where we want to allow
// a legacy token to be used for authentication. The "/whoami"
// endpoint will then return a new token for further requests.
//
const is_whoami = (req) => {
    if ( ! config.legacy_token_migrate ) return;

    if ( req.path !== '/whoami' ) return;

    // const subdomain = req.subdomains[res.subdomains.length - 1];
    // if ( subdomain !== 'api' ) return;
    return true;
}

// TODO: Allow auth middleware to be used without requiring
// authentication. This will allow us to use the auth middleware
// in endpoints that do not require authentication, but can
// provide additional functionality if the user is authenticated.
const configurable_auth = options => async (req, res, next) => {
    if ( options?.no_options_auth && req.method === 'OPTIONS' ) {
        return next();
    }

    const optional = options?.optional;

    // Request might already have been authed (PreAuthService)
    if ( req.actor ) next();

    // === Getting the Token ===
    // This step came from jwt_auth in src/helpers.js
    // However, since request-response handling is a concern of the
    // auth middleware, it makes more sense to put it here.

    let token;
    // Auth token in body
    if(req.body && req.body.auth_token)
        token = req.body.auth_token;
    // HTTML Auth header
    else if (req.header && req.header('Authorization') && !req.header('Authorization').startsWith("Basic ") && req.header('Authorization') !== "Bearer") { // Bearer with no space is something office does
        token = req.header('Authorization');
        token = token.replace('Bearer ', '').trim();
        if ( token === 'undefined' ) {
            APIError.create('unexpected_undefined', null, {
                msg: `The Authorization token cannot be the string "undefined"`
            });
        }
    }
    // Cookie
    else if(req.cookies && req.cookies[config.cookie_name])
        token = req.cookies[config.cookie_name];
    // Auth token in URL
    else if(req.query && req.query.auth_token)
        token = req.query.auth_token;
    // Socket
    else if(req.handshake && req.handshake.query && req.handshake.query.auth_token)
        token = req.handshake.query.auth_token;
    
    if(!token || token.startsWith("Basic ")) {
        if ( optional ) {
            next();
            return;
        }
        APIError.create('token_missing').write(res);
        return;
    } else if (typeof token !== 'string') {
        APIError.create('token_auth_failed').write(res);
        return;
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
        if ( e instanceof LegacyTokenError && is_whoami(req) ) {
            const new_info = await svc_auth.check_session(token, {
                req,
                from_upgrade: true,
            })
            context.set('actor', new_info.actor);
            context.set('user', new_info.user);
            req.new_token = new_info.token;
            req.token = new_info.token;
            req.user = new_info.user;
            req.actor = new_info.actor;
            
            if ( req.user?.suspended ) {
                throw APIError.create('forbidden');
            }

            res.cookie(config.cookie_name, new_info.token, {
                sameSite: 'none',
                secure: true,
                httpOnly: true,
            });
            next();
            return;
        }
        const re = APIError.create('token_auth_failed');
        re.write(res);
        return;
    }

    // === Populate Context ===
    context.set('actor', actor);
    if ( actor.type.user ) {
        if ( actor.type.user?.suspended ) {
            throw APIError.create('forbidden');
        }
        context.set('user', actor.type.user);
    }

    // === Populate Request ===
    req.actor = actor;
    req.user = actor.type.user;
    req.token = token;

    next();
};

module.exports = configurable_auth;