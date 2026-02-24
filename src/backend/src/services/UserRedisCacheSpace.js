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
import { redisClient } from '../clients/redis/redisSingleton.js';
import { deleteRedisKeys } from '../clients/redis/deleteRedisKeys.js';
import { emitOuterCacheUpdate } from '../clients/redis/cacheUpdate.js';

const userKeyPrefix = 'users';
const defaultUserIdProperties = ['username', 'uuid', 'email', 'id', 'referral_code'];
const DEFAULT_USER_CACHE_TTL_SECONDS = 15 * 60;

const safeParseJson = (value, fallback = null) => {
    if ( value === null || value === undefined ) return fallback;
    try {
        return JSON.parse(value);
    } catch (e) {
        return fallback;
    }
};

const setKey = async (key, value, { ttlSeconds } = {}) => {
    if ( ttlSeconds ) {
        await redisClient.set(key, value, 'EX', ttlSeconds);
        return;
    }
    await redisClient.set(key, value);
};

const userCacheKey = (prop, value) => `${userKeyPrefix}:${prop}:${value}`;

const UserRedisCacheSpace = {
    key: userCacheKey,
    keysForUser: (user, props = defaultUserIdProperties) => {
        if ( ! user ) return [];
        return props
            .filter(prop => user[prop] !== undefined && user[prop] !== null && user[prop] !== '')
            .map(prop => userCacheKey(prop, user[prop]));
    },
    getByProperty: async (prop, value) => safeParseJson(await redisClient.get(userCacheKey(prop, value))),
    getById: async (id) => UserRedisCacheSpace.getByProperty('id', id),
    setUser: async (
        user,
        { props = defaultUserIdProperties, ttlSeconds = DEFAULT_USER_CACHE_TTL_SECONDS } = {},
    ) => {
        if ( ! user ) return;
        const serialized = JSON.stringify(user);
        const writes = [];
        const cacheKeys = [];
        for ( const prop of props ) {
            if ( user[prop] === undefined || user[prop] === null || user[prop] === '' ) continue;
            const key = userCacheKey(prop, user[prop]);
            cacheKeys.push(key);
            writes.push(setKey(key, serialized, { ttlSeconds }));
        }
        if ( writes.length ) {
            await Promise.all(writes);
            emitOuterCacheUpdate({
                cacheKey: cacheKeys,
                data: user,
                ttlSeconds,
            });
        }
    },
    invalidateUser: async (user, props = defaultUserIdProperties) => {
        const keys = UserRedisCacheSpace.keysForUser(user, props);
        if ( keys.length ) {
            await deleteRedisKeys(...keys);
        }
    },
    invalidateById: async (id, props = defaultUserIdProperties) => {
        const user = await UserRedisCacheSpace.getById(id);
        if ( ! user ) return;
        await UserRedisCacheSpace.invalidateUser(user, props);
    },
};

export { UserRedisCacheSpace };
