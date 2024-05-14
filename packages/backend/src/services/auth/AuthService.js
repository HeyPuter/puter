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
const { Actor, UserActorType, AppUnderUserActorType, AccessTokenActorType } = require("./Actor");
const BaseService = require("../BaseService");
const { get_user, get_app } = require("../../helpers");
const { Context } = require("../../util/context");
const APIError = require("../../api/APIError");
const { DB_WRITE } = require("../database/consts");

const APP_ORIGIN_UUID_NAMESPACE = '33de3768-8ee0-43e9-9e73-db192b97a5d8';

const LegacyTokenError = class extends Error {};

class AuthService extends BaseService {
    static MODULES = {
        jwt: require('jsonwebtoken'),
        uuidv5: require('uuid').v5,
        uuidv4: require('uuid').v4,
    }

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'auth');
        this.svc_session = await this.services.get('session');

        this.sessions = {};

        const svc_token = await this.services.get('token');
        this.modules.jwt = {
            sign: (payload, _, options) => svc_token.sign('auth', payload, options),
            verify: (token, _) => svc_token.verify('auth', token),
        };
    }

    async authenticate_from_token (token) {
        const decoded = this.modules.jwt.verify(
            token,
            this.global_config.jwt_secret
        );

        if ( ! decoded.hasOwnProperty('type') ) {
            throw new LegacyTokenError();
        }

        if ( decoded.type === 'session' ) {
            const session = await this.get_session_(decoded.uuid);

            if ( ! session ) {
                throw APIError.create('token_auth_failed');
            }

            const user = await get_user({ uuid: decoded.user_uid });

            const actor_type = new UserActorType({
                user,
                session: session.uuid,
            });

            return new Actor({
                user_uid: decoded.user_uid,
                type: actor_type,
            });
        }

        if ( decoded.type === 'app-under-user' ) {
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
            });

            return new Actor({
                user_uid: decoded.user_uid,
                app_uid: decoded.app_uid,
                type: actor_type,
            });
        }

        if ( decoded.type === 'access-token' ) {
            const token = decoded.token_uid;
            console.log('DECODED', decoded);
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

        throw APIError.create('token_auth_failed');
    }

    get_user_app_token (app_uid) {
        const actor = Context.get('actor');
        const actor_type = actor.type;

        if ( ! (actor_type instanceof UserActorType) ) {
            throw APIError.create('forbidden');
        }

        this.log.info(`generating user-app token for app ${app_uid} and user ${actor_type.user.uuid}`, {
            app_uid,
            user_uid: actor_type.user.uuid,
        })

        const token = this.modules.jwt.sign(
            {
                type: 'app-under-user',
                version: '0.0.0',
                user_uid: actor_type.user.uuid,
                app_uid,
            },
            this.global_config.jwt_secret,
        );

        return token;
    }

    async create_session_ (user, meta = {}) {
        this.log.info(`CREATING SESSION`);

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

    async get_session_ (uuid) {
        return await this.svc_session.get_session(uuid);
    }

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

    async check_session (cur_token, meta) {
        const decoded = this.modules.jwt.verify(
            cur_token, this.global_config.jwt_secret
        );

        console.log('\x1B[36;1mDECODED SESSION', decoded);

        if ( decoded.type && decoded.type !== 'session' ) {
            return {};
        }

        const is_legacy = ! decoded.type;

        const user = await get_user({ uuid:
            is_legacy ? decoded.uuid : decoded.user_uid
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

            // Return the session
            return { user, token: cur_token };
        }

        this.log.info(`UPGRADING SESSION`);

        // Upgrade legacy token
        // TODO: phase this out
        const { session, token } = await this.create_session_token(user, meta);

        const actor_type = new UserActorType({
            user,
            session,
        });

        const actor = new Actor({
            user_uid: user.uuid,
            type: actor_type,
        });

        return { actor, user, token };
    }

    async remove_session_by_token (token) {
        const decoded = this.modules.jwt.verify(
            token, this.global_config.jwt_secret
        );

        if ( decoded.type !== 'session' ) {
            return;
        }

        await this.svc_session.remove_session(decoded.uuid);
    }

    async create_access_token (authorizer, permissions) {
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
        }, this.global_config.jwt_secret);

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
            await this.db.write(
                'INSERT INTO `access_token_permissions` ' +
                `(${cols}) VALUES (${vals})`,
                Object.values(insert_object),
            );
        }

        return jwt;
    }

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
                otherwise: () => JSON.parse(session.meta ?? "{}")
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

    async revoke_session (actor, uuid) {
        delete this.sessions[uuid];
        this.svc_session.remove_session(uuid);
    }

    async get_user_app_token_from_origin (origin) {
        origin = this._origin_from_url(origin);
        const app_uid = await this._app_uid_from_origin(origin);

        // Determine if the app exists
        const apps = await this.db.read(
            "SELECT * FROM `apps` WHERE `uid` = ? LIMIT 1",
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

        return this.get_user_app_token(app_uid);
    }

    async app_uid_from_origin (origin) {
        origin = this._origin_from_url(origin);
        return await this._app_uid_from_origin(origin);
    }

    async _app_uid_from_origin (origin) {
        // UUIDV5
        const uuid = this.modules.uuidv5(origin, APP_ORIGIN_UUID_NAMESPACE);
        return `app-${uuid}`;
    }

    _origin_from_url ( url ) {
        try {
            const parsedUrl = new URL(url);
            // Origin is protocol + hostname + port
            return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}`;
        } catch (error) {
            console.error('Invalid URL:', error.message);
            return null;
        }
    }
}

module.exports = {
    AuthService,
    LegacyTokenError,
};
