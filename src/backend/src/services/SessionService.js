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
const { redisClient } = require('../clients/redis/redisSingleton');
const { UserRedisCacheSpace } = require('./UserRedisCacheSpace.js');
const { get_user } = require('../helpers');
const { v4: uuidv4 } = require('uuid');
const SECOND = 1000;
const { BaseService } = require('./BaseService');
const SESSION_CACHE_TTL_SECONDS = 5 * 60;
const SESSION_CACHE_KEY_PREFIX = 'session-cache';
const SESSION_FLUSH_PENDING_SET_KEY = `${SESSION_CACHE_KEY_PREFIX}:flush-pending`;
const SESSION_USER_SESSIONS_KEY_PREFIX = `${SESSION_CACHE_KEY_PREFIX}:user-sessions`;
const SESSION_FLUSH_LOCK_KEY_PREFIX = `${SESSION_CACHE_KEY_PREFIX}:flush-lock`;
const SESSION_FLUSH_LOCK_TTL_SECONDS = 30;
const SESSION_FLUSH_INTERVAL_STEP_SECONDS = 5;
const SESSION_FLUSH_INTERVAL_MIN_STEPS = 1;
const SESSION_FLUSH_INTERVAL_MAX_STEPS = 12;

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
    getSessionCacheKey (uuid) {
        return `${SESSION_CACHE_KEY_PREFIX}:${uuid}`;
    }

    getSessionUserSetKey (userId) {
        return `${SESSION_USER_SESSIONS_KEY_PREFIX}:${userId}`;
    }

    getSessionFlushLockKey (uuid) {
        return `${SESSION_FLUSH_LOCK_KEY_PREFIX}:${uuid}`;
    }

    #getRandomFlushIntervalMs () {
        const randomSteps =
            Math.floor(
                Math.random() * (
                    SESSION_FLUSH_INTERVAL_MAX_STEPS
                    - SESSION_FLUSH_INTERVAL_MIN_STEPS
                    + 1
                ),
            ) + SESSION_FLUSH_INTERVAL_MIN_STEPS;
        return randomSteps * SESSION_FLUSH_INTERVAL_STEP_SECONDS * SECOND;
    }

    #scheduleSessionFlushLoop () {
        setTimeout(async () => {
            try {
                await this.#updateSessions();
            } catch (e) {
                console.warn('session flush loop failed', {
                    reason: e?.message || String(e),
                });
            }
            this.#scheduleSessionFlushLoop();
        }, this.#getRandomFlushIntervalMs());
    }

    async cacheSession (session, options = {}) {
        if ( ! session?.uuid ) return;
        const flushState = options.flushState || 'unchanged';
        const normalizedSession = {
            ...session,
            flushPending:
                flushState === 'pending'
                    ? true
                    : (
                        flushState === 'flushed'
                            ? false
                            : !!session.flushPending
                    ),
        };
        try {
            await redisClient.set(
                this.getSessionCacheKey(normalizedSession.uuid),
                JSON.stringify(normalizedSession),
                'EX',
                SESSION_CACHE_TTL_SECONDS,
            );

            if ( normalizedSession.user_id ) {
                const userSessionSetKey =
                    this.getSessionUserSetKey(normalizedSession.user_id);
                await redisClient.sadd(userSessionSetKey, normalizedSession.uuid);
                await redisClient.expire(userSessionSetKey, SESSION_CACHE_TTL_SECONDS);
            }

            if ( flushState === 'pending' ) {
                await redisClient.sadd(SESSION_FLUSH_PENDING_SET_KEY, normalizedSession.uuid);
            } else if ( flushState === 'flushed' ) {
                await redisClient.srem(SESSION_FLUSH_PENDING_SET_KEY, normalizedSession.uuid);
            }
        } catch (e) {
            console.warn('failed to cache session in redis', {
                uuid: normalizedSession.uuid,
                reason: e?.message || String(e),
            });
        }
    }

    async getCachedSession (uuid) {
        let cachedSessionRaw;
        try {
            cachedSessionRaw = await redisClient.get(this.getSessionCacheKey(uuid));
        } catch (e) {
            console.warn('failed to read session from redis', {
                uuid,
                reason: e?.message || String(e),
            });
            return null;
        }
        if ( ! cachedSessionRaw ) return null;

        try {
            const parsedSession = JSON.parse(cachedSessionRaw);
            if ( !parsedSession || parsedSession.uuid !== uuid ) {
                throw new Error('cached session payload mismatch');
            }
            return parsedSession;
        } catch {
            await this.invalidateCachedSession(uuid);
            return null;
        }
    }

    async invalidateCachedSession (uuid, userId) {
        try {
            await redisClient.del(
                this.getSessionCacheKey(uuid),
            );
            await redisClient.srem(SESSION_FLUSH_PENDING_SET_KEY, uuid);
            if ( userId ) {
                await redisClient.srem(this.getSessionUserSetKey(userId), uuid);
            }
        } catch (e) {
            console.warn('failed to delete cached session from redis', {
                uuid,
                reason: e?.message || String(e),
            });
        }
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
        this.db = await this.services.get('database').get();
        this.#scheduleSessionFlushLoop();
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
        const uuid = uuidv4();
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
            flushPending: false,
        };
        await this.cacheSession(session);

        return session;
    }

    /**
    * Retrieves a session by its UUID, updates the session's last touch timestamp,
    * and prepares the session data for external use by removing internal values.
    *
    * @param {string} uuid - The UUID of the session to retrieve.
    * @returns {Object|undefined} The session object with internal values removed, or undefined if the session does not exist.
    */
    async #getSession (uuid) {
        let session = await this.getCachedSession(uuid);
        if ( session ) {
            session.last_touch = Date.now();
            return session;
        }
        ;[session] = await this.db.tryHardRead(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
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
            otherwise: () => JSON.parse(session.meta ?? '{}'),
        })();
        const user = await get_user({ id: session.user_id });
        session.user_uid = user?.uuid;
        return session;
    }
    /**
    * Retrieves a session by its UUID, updates its last touch time, and prepares it for external use.
    * @param {string} uuid - The unique identifier for the session to retrieve.
    * @returns {Promise<Object|undefined>} The session object with internal values removed, or undefined if not found.
    */
    async getSession (uuid) {
        const session = await this.#getSession(uuid);
        if ( session ) {
            session.last_touch = Date.now();
            session.meta = {
                ...(session.meta || {}),
                last_activity: (new Date()).toISOString(),
            };
            await this.cacheSession(session, {
                flushState: 'pending',
            });
        }
        return this.#removeInternalValues(session);
    }

    #removeInternalValues (session) {
        if ( session === undefined ) return;

        const copy = {
            ...session,
        };
        delete copy.last_touch;
        delete copy.last_store;
        delete copy.user_id;
        delete copy.flushPending;
        return copy;
    }

    async get_user_sessions (user) {
        if ( ! user?.id ) return [];

        let sessionUuids;
        try {
            sessionUuids = await redisClient.smembers(
                this.getSessionUserSetKey(user.id),
            );
        } catch (e) {
            console.warn('failed to read user session set from redis', {
                userId: user.id,
                reason: e?.message || String(e),
            });
            return [];
        }

        if ( !Array.isArray(sessionUuids) || sessionUuids.length === 0 ) {
            return [];
        }

        const sessions = [];
        for ( const sessionUuid of sessionUuids ) {
            const session = await this.getCachedSession(sessionUuid);
            if ( !session || session.user_id !== user.id ) {
                await redisClient.srem(this.getSessionUserSetKey(user.id), sessionUuid);
                continue;
            }
            sessions.push(session);
        }

        return sessions.map(this.#removeInternalValues.bind(this));
    }

    /**
    * Removes a session from Redis-backed cache state and the database.
    *
    * @param {string} uuid - The UUID of the session to remove.
    * @returns {Promise} A promise that resolves to the result of the database write operation.
    */
    async remove_session (uuid) {
        const cachedSession = await this.getCachedSession(uuid);
        const [dbSession] = await this.db.tryHardRead(
            'SELECT `user_id` FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [uuid],
        );
        await this.invalidateCachedSession(uuid, cachedSession?.user_id ?? dbSession?.user_id);
        return await this.db.write(
            'DELETE FROM `sessions` WHERE `uuid` = ?',
            [uuid],
        );
    }

    async #updateSessions () {
        const now = Date.now();
        let pendingSessionUuids;
        try {
            pendingSessionUuids = await redisClient.smembers(SESSION_FLUSH_PENDING_SET_KEY);
        } catch (e) {
            console.warn('failed to read pending session flush set from redis', {
                reason: e?.message || String(e),
            });
            return;
        }
        if ( !Array.isArray(pendingSessionUuids) || pendingSessionUuids.length === 0 ) {
            return;
        }

        const userUpdates = {};

        for ( const sessionUuid of pendingSessionUuids ) {
            const lockKey = this.getSessionFlushLockKey(sessionUuid);
            let lockAcquired = false;
            try {
                lockAcquired = await redisClient.set(
                    lockKey,
                    '1',
                    'EX',
                    SESSION_FLUSH_LOCK_TTL_SECONDS,
                    'NX',
                );
                if ( ! lockAcquired ) continue;

                const session = await this.getCachedSession(sessionUuid);
                if ( ! session ) {
                    await redisClient.srem(SESSION_FLUSH_PENDING_SET_KEY, sessionUuid);
                    continue;
                }
                if ( ! session.flushPending ) {
                    await redisClient.srem(SESSION_FLUSH_PENDING_SET_KEY, sessionUuid);
                    continue;
                }

                const lastTouch = typeof session.last_touch === 'number'
                    ? session.last_touch
                    : now;
                const unixTs = Math.floor(lastTouch / 1000);
                session.meta = {
                    ...(session.meta || {}),
                    last_activity: (new Date(lastTouch)).toISOString(),
                };

                const { anyRowsAffected } = await this.db.write(
                    'UPDATE `sessions` ' +
                    'SET `meta` = ?, `last_activity` = ? ' +
                    'WHERE `uuid` = ? AND (`last_activity` IS NULL OR `last_activity` < ?)',
                    [JSON.stringify(session.meta), unixTs, session.uuid, unixTs],
                );

                if ( ! anyRowsAffected ) {
                    const [existingSession] = await this.db.tryHardRead(
                        'SELECT `uuid` FROM `sessions` WHERE `uuid` = ? LIMIT 1',
                        [session.uuid],
                    );
                    if ( ! existingSession ) {
                        await this.invalidateCachedSession(session.uuid, session.user_id);
                        continue;
                    }
                }

                session.last_store = now;
                await this.cacheSession({
                    ...session,
                    flushPending: false,
                }, {
                    flushState: 'flushed',
                });

                if (
                    session.user_id &&
                    (
                        !userUpdates[session.user_id]
                        || userUpdates[session.user_id] < lastTouch
                    )
                ) {
                    userUpdates[session.user_id] = lastTouch;
                }
            } catch (e) {
                console.warn('failed to flush session update to db', {
                    uuid: sessionUuid,
                    reason: e?.message || String(e),
                });
            } finally {
                if ( lockAcquired ) {
                    await redisClient.del(lockKey);
                }
            }
        }

        for ( const [userIdRaw, lastTouch] of Object.entries(userUpdates) ) {
            const userId = Number(userIdRaw);
            const sql_ts = (date =>
                `${date.toISOString().split('T')[0] } ${
                    date.toTimeString().split(' ')[0]}`
            )(new Date(lastTouch));

            await this.db.write(
                'UPDATE `user` ' +
                'SET `last_activity_ts` = ? ' +
                'WHERE `id` = ? AND (`last_activity_ts` IS NULL OR `last_activity_ts` < ?) LIMIT 1',
                [sql_ts, userId, sql_ts],
            );
            const cachedUser = await redisClient.get(UserRedisCacheSpace.key('id', userId));
            if ( cachedUser ) {
                try {
                    const user = JSON.parse(cachedUser);
                    if (
                        !user.last_activity_ts ||
                        user.last_activity_ts < sql_ts
                    ) {
                        user.last_activity_ts = sql_ts;
                        UserRedisCacheSpace.setUser(user);
                    }
                } catch ( e ) {
                    console.warn(e);
                    // ignore malformed cache entries
                }
            }
        }
    }
}

module.exports = { SessionService };
