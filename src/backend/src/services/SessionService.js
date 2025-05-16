// METADATA // {"ai-commented":{"service":"xai"}}
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
const { get_user } = require("../helpers");
const { asyncSafeSetInterval } = require('@heyputer/putility').libs.promise;
const { MINUTE, SECOND } = require("@heyputer/putility").libs.time;
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

/**
 * This service is responsible for updating session activity
 * timestamps and maintaining the number of active sessions.
 */
/**
* @class SessionService
* @description
* The SessionService class manages session-related operations within the Puter application.
* It handles the creation, retrieval, updating, and deletion of user sessions. This service:
* - Tracks session activity with timestamps.
* - Maintains a cache of active sessions.
* - Periodically updates session information in the database.
* - Ensures the integrity of session data across different parts of the application.
* - Provides methods to interact with sessions, including session creation, retrieval, and termination.
*/
class SessionService extends BaseService {
    static MODULES = {
        // uuidv5: require('uuid').v5,
        uuidv4: require('uuid').v4,
    }


    _construct () {
        this.sessions = {};
    }


    /**
    * Initializes the session storage by setting up the database connection
    * and starting a periodic session update interval.
    * 
    * @async
    * @memberof SessionService
    * @method _init
    */
    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'session');

        (async () => {
            // TODO: change to 5 minutes or configured value
            /**
            * Initializes periodic session updates.
            * 
            * This method sets up an interval to call `_update_sessions` every 2 minutes.
            * 
            * @memberof SessionService
            * @private
            * @async
            * @param {none} - No parameters are required.
            * @returns {Promise<void>} - Resolves when the interval is set.
            */
            asyncSafeSetInterval(async () => {
                await this._update_sessions();
            }, 2 * MINUTE);
        })();
    }


    /**
    * Creates a new session for the specified user and records metadata about
    * the requestor.
    * 
    * @async
    * @returns {Promise<Session>} A new session object
    */
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


    /**
    * Retrieves a session by its UUID, updates the session's last touch timestamp, 
    * and prepares the session data for external use by removing internal values.
    * 
    * @param {string} uuid - The UUID of the session to retrieve.
    * @returns {Object|undefined} The session object with internal values removed, or undefined if the session does not exist.
    */
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
            /**
            * Parses session metadata based on the database type.
            * @param {Object} session - The session object from the database.
            * @returns {Object} The parsed session metadata.
            */
            otherwise: () => JSON.parse(session.meta ?? "{}")
        })();
        const user = await get_user(session.user_id);
        session.user_uid = user?.uuid;
        this.sessions[uuid] = session;
        return session;
    }
    /**
    * Retrieves a session by its UUID, updates its last touch time, and prepares it for external use.
    * @param {string} uuid - The unique identifier for the session to retrieve.
    * @returns {Promise<Object|undefined>} The session object with internal values removed, or undefined if not found.
    */
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

    /**
    * Removes a session from the in-memory cache and the database.
    * 
    * @param {string} uuid - The UUID of the session to remove.
    * @returns {Promise} A promise that resolves to the result of the database write operation.
    */
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
