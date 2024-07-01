const { invalidate_cached_user, get_user } = require("../helpers");
const { asyncSafeSetInterval } = require("../util/promise");
const { MINUTE, SECOND } = require("../util/time");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

/**
 * This service is responsible for updating session activity
 * timestamps and maintaining the number of active sessions.
 */
class SessionService extends BaseService {
    static MODULES = {
        // uuidv5: require('uuid').v5,
        uuidv4: require('uuid').v4,
    }

    _construct () {
        this.sessions = {};
    }

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'session');

        (async () => {
            // TODO: change to 5 minutes or configured value
            asyncSafeSetInterval(async () => {
                await this._update_sessions();
            }, 2 * MINUTE);
        })();
    }

    async create_session (user, meta) {
        const unix_ts = Math.floor(Date.now() / 1000);

        meta = {
            // clone
            ...(meta || {}),
        };
        meta.created = new Date().toISOString();
        meta.created_unix = unix_ts;
        const uuid = this.modules.uuidv4();
        await this.db.write(
            'INSERT INTO `sessions` ' +
            '(`uuid`, `user_id`, `meta`, `last_activity`, `created_at`) ' +
            'VALUES (?, ?, ?, ?, ?)',
            [uuid, user.id, JSON.stringify(meta), unix_ts, unix_ts],
        );
        const session = {
            last_touch: Date.now(),
            last_store: Date.now(),
            uuid,
            user_uid: user.uuid,
            user_id: user.id,
            meta,
        };
        this.sessions[uuid] = session;

        return session;
    }

    async get_session_ (uuid) {
        let session = this.sessions[uuid];
        if ( session ) {
            session.last_touch = Date.now();
            return session;
        }
        ;[session] = await this.db.read(
            "SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1",
            [uuid],
        );
        if ( ! session ) return;
        session.last_store = Date.now();
        session.meta = this.db.case({
            mysql: () => session.meta,
            otherwise: () => JSON.parse(session.meta ?? "{}")
        })();
        const user = await get_user(session.user_id);
        session.user_uid = user?.uuid;
        this.sessions[uuid] = session;
        return session;
    }
    async get_session (uuid) {
        const session = await this.get_session_(uuid);
        if ( session ) {
            session.last_touch = Date.now();
            session.meta.last_activity = (new Date()).toISOString();
        }
        return this.remove_internal_values_(session);
    }

    remove_internal_values_ (session) {
        if ( session === undefined ) return;

        const copy = {
            ...session,
        };
        delete copy.last_touch;
        delete copy.last_store;
        delete copy.user_id;
        return copy;
    }

    get_user_sessions (user) {
        const sessions = [];
        for ( const session of Object.values(this.sessions) ) {
            if ( session.user_id === user.id ) {
                sessions.push(session);
            }
        }
        return sessions.map(this.remove_internal_values_.bind(this));
    }

    remove_session (uuid) {
        delete this.sessions[uuid];
        return this.db.write(
            'DELETE FROM `sessions` WHERE `uuid` = ?',
            [uuid],
        );
    }

    async _update_sessions () {
        this.log.tick('UPDATING SESSIONS');
        const now = Date.now();
        const keys = Object.keys(this.sessions);

        const user_updates = {};

        for ( const key of keys ) {
            const session = this.sessions[key];
            if ( now - session.last_store > 5 * MINUTE ) {
                this.log.debug('storing session meta: ' + session.uuid);
                const unix_ts = Math.floor(now / 1000);
                const { anyRowsAffected } = await this.db.write(
                    'UPDATE `sessions` ' +
                    'SET `meta` = ?, `last_activity` = ? ' +
                    'WHERE `uuid` = ?',
                    [JSON.stringify(session.meta), unix_ts, session.uuid],
                );

                if ( ! anyRowsAffected ) {
                    delete this.sessions[key];
                    continue;
                }

                session.last_store = now;
                if (
                    ! user_updates[session.user_id] ||
                    user_updates[session.user_id][1] < session.last_touch
                ) {
                    user_updates[session.user_id] = [session.user_id, session.last_touch];
                }
            }
        }

        for ( const [user_id, last_touch] of Object.values(user_updates) ) {
            const sql_ts = (date =>
                date.toISOString().split('T')[0] + ' '
                + date.toTimeString().split(' ')[0]
            )(new Date(last_touch));

            await this.db.write(
                'UPDATE `user` ' +
                'SET `last_activity_ts` = ? ' +
                'WHERE `id` = ? LIMIT 1',
                [sql_ts, user_id],
            );
            const user = kv.get('users:id:' + user_id);
            if ( user ) {
                user.last_activity_ts = sql_ts;
            }
        }
    }
}

module.exports = { SessionService };
