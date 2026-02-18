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
const BaseService = require('../BaseService');
const { get_user, get_app } = require('../../helpers');
const { Context } = require('../../util/context');
const APIError = require('../../api/APIError');
const { DB_WRITE } = require('../database/consts');
const { UUIDFPE } = require('../../util/uuidfpe');

// This constant defines the namespace used for generating app UUIDs from their origins
const APP_ORIGIN_UUID_NAMESPACE = '33de3768-8ee0-43e9-9e73-db192b97a5d8';

const LegacyTokenError = class extends Error {
};

/**
* @class AuthService
* This class is responsible for handling authentication and authorization tasks for the application.
*/
class AuthService extends BaseService {
    static MODULES = {
        jwt: require('jsonwebtoken'),
        crypto: require('crypto'),
        uuidv5: require('uuid').v5,
        uuidv4: require('uuid').v4,
    };

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
            : this.modules.crypto.randomBytes(16);
        this.uuid_fpe = new UUIDFPE(uuid_fpe_key);

        this.sessions = {};

        const svc_token = await this.services.get('token');
        this.modules.jwt = {
            sign: (payload, _, options) => svc_token.sign('auth', payload, options),
            verify: (token, _) => svc_token.verify('auth', token),
        };
    }

    /**
    * This method authenticates a user or app using a token.
    * It checks the token's type (session, app-under-user, access-token) and decodes it.
    * Depending on the token type, it returns the corresponding user/app actor.
    * @param {string} token - The token to authenticate.
    * @returns {Promise<Actor>} The authenticated user or app actor.
    */
    async authenticate_from_token (token) {
        const decoded = this.modules.jwt.verify(token,
                        this.global_config.jwt_secret);

        if ( ! decoded.hasOwnProperty('type') ) {
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
                hasHttpPowers: true,
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
                hasHttpPowers: false,
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

        const token = this.modules.jwt.sign({
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: actor_type.user.uuid,
            app_uid,
            ...(actor_type.session ? { session: this.uuid_fpe.encrypt(actor_type.session) } : {}),
        },
        this.global_config.jwt_secret);

        return token;
    }

    get_site_app_token ({ site_uid }) {
        const token = this.modules.jwt.sign({
            type: 'actor-site',
            version: '0.0.0',
            site_uid,
        },
        this.global_config.jwt_secret,
        { expiresIn: '1h' });

        return token;
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

        const token = this.modules.jwt.sign({
            type: 'session',
            version: '0.0.0',
            uuid: session.uuid,
            // meta: session.meta,
            user_uid: user.uuid,
        }, this.global_config.jwt_secret);

        return { session, token };
    }

    /**
     * Creates a GUI token bound to the same session as the given session object.
     * GUI tokens create a UserActorType with hasHttpPowers false, so they cannot
     * access user-protected HTTP endpoints (e.g. change password). The GUI receives
     * only this token, not the full session token.
     *
     * @param {*} user - User object (must have .uuid).
     * @param {{ uuid: string }} session - Session object (must have .uuid).
     * @returns {string} JWT GUI token.
     */
    create_gui_token (user, session) {
        return this.modules.jwt.sign({
            type: 'gui',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        }, this.global_config.jwt_secret);
    }

    /**
     * Creates a session token (hasHttpPowers) for an existing session.
     * Used when the client authenticated with a GUI token (e.g. QR login via
     * ?auth_token=) so we can set the HTTP-only cookie and allow user-protected
     * endpoints (change password, email, username, etc.) to work.
     *
     * @param {*} user - User object (must have .uuid).
     * @param {string} session_uuid - Existing session UUID.
     * @returns {string} JWT session token.
     */
    create_session_token_for_session (user, session_uuid) {
        return this.modules.jwt.sign({
            type: 'session',
            version: '0.0.0',
            uuid: session_uuid,
            user_uid: user.uuid,
        }, this.global_config.jwt_secret);
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
        const decoded = this.modules.jwt.verify(cur_token, this.global_config.jwt_secret);

        console.log('\x1B[36;1mDECODED SESSION', decoded);

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
            hasHttpPowers: true,
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
        const decoded = this.modules.jwt.verify(token, this.global_config.jwt_secret);

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

        const uuid = this.modules.uuidv4();

        const jwt = this.modules.jwt.sign({
            type: 'access-token',
            version: '0.0.0',
            token_uid: uuid,
            ...jwt_obj,
        }, this.global_config.jwt_secret, options);

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
            const vals = Object.values(insert_object).map(v => '?').join(', ');
            await this.db.write('INSERT INTO `access_token_permissions` ' +
                `(${cols}) VALUES (${vals})`,
            Object.values(insert_object));
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
            const decoded = this.modules.jwt.verify(tokenOrUuid, this.global_config.jwt_secret);
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

        const svc_permission = this.services.get('permission');
        svc_permission.invalidate_permission_scan_cache_for_access_token(token_uid);
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
        const db_sessions = await this.db.read('SELECT uuid, meta FROM `sessions` WHERE `user_id` = ?',
                        [actor.type.user.id]);

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
        const app_uid = await this._app_uid_from_origin(origin);

        // Determine if the app exists
        const apps = await this.db.read('SELECT * FROM `apps` WHERE `uid` = ? LIMIT 1',
                        [app_uid]);

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
        await this.db.write('INSERT INTO `apps` ' +
            '(`uid`, `name`, `title`, `description`, `index_url`, `owner_user_id`) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
        [app_uid, name, title, description, index_url, owner_user_id]);

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
        return await this._app_uid_from_origin(origin);
    }

    async _app_uid_from_origin (origin) {
        const event = { origin };
        const svc_event = this.services.get('event');
        await svc_event.emit('app.from-origin', event);
        // UUIDV5
        const uuid = this.modules.uuidv5(event.origin, APP_ORIGIN_UUID_NAMESPACE);
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
    ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');
        const config = require('../../config');
        const { subdomain } = require('../../helpers');
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
