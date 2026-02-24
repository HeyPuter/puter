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
import { redisClient } from '../../clients/redis/redisSingleton.js';
import { deleteRedisKeys } from '../../clients/redis/deleteRedisKeys.js';
import { emitOuterCacheUpdate } from '../../clients/redis/cacheUpdate.js';

const appFullNamespace = 'apps';
const appLiteNamespace = 'apps:lite';
const appLookupKeys = ['uid', 'name', 'id'];

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

const appNamespace = ({ rawIcon = true } = {}) => (
    rawIcon ? appFullNamespace : appLiteNamespace
);

const appCacheKey = ({ lookup, value, rawIcon = true }) => (
    `${appNamespace({ rawIcon })}:${lookup}:${value}`
);

export const AppRedisCacheSpace = {
    key: appCacheKey,
    namespace: appNamespace,
    keysForApp: (app, { rawIcon = true } = {}) => {
        if ( ! app ) return [];
        return appLookupKeys
            .filter(lookup => app[lookup] !== undefined && app[lookup] !== null && app[lookup] !== '')
            .map(lookup => appCacheKey({ lookup, value: app[lookup], rawIcon }));
    },
    uidScanPattern: ({ rawIcon = true } = {}) => `${appNamespace({ rawIcon })}:uid:*`,
    pendingNamespace: ({ rawIcon = true } = {}) => rawIcon ? 'pending_app' : 'pending_app_lite',
    pendingKey: ({ lookup, value, rawIcon = true }) => (
        `${AppRedisCacheSpace.pendingNamespace({ rawIcon })}:${lookup}:${value}`
    ),
    openCountKey: uid => `apps:open_count:uid:${uid}`,
    userCountKey: uid => `apps:user_count:uid:${uid}`,
    referralCountKey: uid => `apps:referral_count:uid:${uid}`,
    statsKeys: uid => [
        AppRedisCacheSpace.openCountKey(uid),
        AppRedisCacheSpace.userCountKey(uid),
        AppRedisCacheSpace.referralCountKey(uid),
    ],
    associationAppsKey: (fileExtension) => {
        const ext = String(fileExtension ?? '')
            .trim()
            .replace(/^\./, '')
            .toLowerCase();
        return `assocs:${ext}:apps`;
    },
    getCachedApp: async ({ lookup, value, rawIcon = true }) => (
        safeParseJson(await redisClient.get(appCacheKey({ lookup, value, rawIcon })))
    ),
    setCachedApp: async (app, { rawIcon = true, ttlSeconds } = {}) => {
        if ( ! app ) return;
        const serialized = JSON.stringify(app);
        const cacheKeys = AppRedisCacheSpace.keysForApp(app, { rawIcon });
        const writes = cacheKeys
            .map(key => setKey(key, serialized, { ttlSeconds }));
        if ( writes.length ) {
            await Promise.all(writes);
            emitOuterCacheUpdate({
                cacheKey: cacheKeys,
                data: app,
                ttlSeconds,
            });
        }
    },
    invalidateCachedApp: (app, {
        rawIconVariants = [true, false],
        includeStats = false,
    } = {}) => {
        if ( ! app ) return;
        const keys = [];
        for ( const rawIcon of rawIconVariants ) {
            keys.push(...AppRedisCacheSpace.keysForApp(app, { rawIcon }));
        }
        if ( includeStats && app.uid ) {
            keys.push(...AppRedisCacheSpace.statsKeys(app.uid));
        }
        if ( keys.length ) {
            return deleteRedisKeys(keys);
        }
    },
    invalidateCachedAppName: async (name, { rawIconVariants = [true, false] } = {}) => {
        if ( ! name ) return;
        const keys = rawIconVariants.map(rawIcon => appCacheKey({
            lookup: 'name',
            value: name,
            rawIcon,
        }));
        return deleteRedisKeys(keys);
    },
    invalidateAppStats: async (uid) => {
        if ( ! uid ) return;
        return deleteRedisKeys(AppRedisCacheSpace.statsKeys(uid));
    },
};
