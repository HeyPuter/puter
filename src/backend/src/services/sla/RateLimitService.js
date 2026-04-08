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
const APIError = require('../../api/APIError');
const { Context } = require('../../util/context');
const BaseService = require('../BaseService');
const { SyncFeature } = require('../../traits/SyncFeature');
const { DB_WRITE } = require('../database/consts');
const { redisClient } = require('../../clients/redis/redisSingleton');
const { RateLimitRedisCacheSpace } = require('./RateLimitRedisCacheSpace.js');

const toSqlTimestamp = (timestampMs) => Math.floor(timestampMs / 1000);
const fromSqlTimestamp = (timestampSec) => timestampSec * 1000;
const defaultRateLimitRedisTimeoutMs = 200;
const formatErrorMessage = (error) => error instanceof Error ? error.message : String(error);
const withTimeout = async (operationPromise, timeoutMs, timeoutMessage) => {
    let timeout;
    try {
        return await Promise.race([
            operationPromise,
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error(timeoutMessage));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if ( timeout ) clearTimeout(timeout);
    }
};

/**
* RateLimitService class handles rate limiting functionality for API requests.
* Implements a fixed window counter strategy to track and limit request rates
* per user/consumer. Manages rate limit data both in memory (KV store) and
* persistent storage (database). Extends BaseService and includes SyncFeature
* for synchronized rate limit checking and incrementing.
*/
class RateLimitService extends BaseService {
    static FEATURES = [
        new SyncFeature([
            'check_and_increment',
        ]),
    ];

    /**
    * Initializes the service by setting up the database connection
    * for rate limiting operations. Gets a database instance from
    * the database service using the 'rate-limit' namespace.
    * @private
    * @returns {Promise<void>}
    */
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'rate-limit');
    }

    async #checkAndIncrementInDb ({ dbKey, max, period, methodName }) {
        const rows = await this.db.read(
            'SELECT * FROM `rl_usage_fixed_window` WHERE `key` = ?',
            [dbKey],
        );

        let windowStart = 0;
        let currentCount = 0;

        if ( rows.length === 0 ) {
            windowStart = Date.now();
            this.db.write(
                'INSERT INTO `rl_usage_fixed_window` (`key`, `window_start`, `count`) VALUES (?, ?, ?)',
                [dbKey, toSqlTimestamp(windowStart), 0],
            );
        } else {
            const row = rows[0];
            windowStart = fromSqlTimestamp(row.window_start);
            currentCount = Number.isFinite(Number(row.count)) ? Number(row.count) : 0;
        }

        if ( windowStart + period < Date.now() ) {
            windowStart = Date.now();
            currentCount = 0;
            this.db.write(
                'UPDATE `rl_usage_fixed_window` SET `window_start` = ?, `count` = ? WHERE `key` = ?',
                [toSqlTimestamp(windowStart), 0, dbKey],
            );
        }

        if ( currentCount >= max ) {
            throw APIError.create('rate_limit_exceeded', null, {
                method_name: methodName,
                rate_limit: { max, period },
            });
        }

        this.db.write(
            'UPDATE `rl_usage_fixed_window` SET `count` = `count` + 1 WHERE `key` = ?',
            [dbKey],
        );
    }

    /**
    * Checks if a rate limit has been exceeded and increments the counter
    * @param {string} key - The rate limit key/identifier
    * @param {number} max - Maximum number of requests allowed in the period
    * @param {number} period - Time window in milliseconds
    * @param {Object} [options={}] - Additional options
    * @param {boolean} [options.global] - Whether this is a global rate limit across servers
    * @throws {APIError} When rate limit is exceeded
    */
    async check_and_increment (key, max, period, options = {}) {
        const consumerId = this._get_consumer_id();
        const methodName = key;
        const rateLimitKey = `${consumerId}:${key}`;
        const windowStartKey = RateLimitRedisCacheSpace.windowStartKey(rateLimitKey);
        const countKey = RateLimitRedisCacheSpace.countKey(rateLimitKey);
        const dbKey = options.global
            ? rateLimitKey
            : `${this.global_config.server_id}:${rateLimitKey}`;
        const rateLimitRedisTimeoutMs = Number(this.global_config?.services?.['rate-limit']?.redis_timeout_ms)
            || defaultRateLimitRedisTimeoutMs;
        const runRedis = async (operationName, operationPromise) => {
            try {
                const value = await withTimeout(
                    operationPromise,
                    rateLimitRedisTimeoutMs,
                    `rate-limit redis ${operationName} timed out after ${rateLimitRedisTimeoutMs}ms`,
                );
                return { ok: true, value };
            } catch ( error ) {
                this.log.warn('rate-limit redis operation failed; continuing with db fallback', {
                    operationName,
                    rateLimitKey,
                    error: formatErrorMessage(error),
                });
                return { ok: false, value: null };
            }
        };

        // Fixed window counter strategy (see devlog 2023-11-21)
        const windowStartRead = await runRedis('window-start-read', redisClient.get(windowStartKey));
        if ( ! windowStartRead.ok ) {
            await this.#checkAndIncrementInDb({ dbKey, max, period, methodName });
            return;
        }
        let windowStart = Number.isFinite(Number(windowStartRead.value)) ? Number(windowStartRead.value) : 0;
        if ( windowStart === 0 ) {
            // Try database
            const rows = await this.db.read(
                'SELECT * FROM `rl_usage_fixed_window` WHERE `key` = ?',
                [dbKey],
            );

            if ( rows.length !== 0 ) {
                const row = rows[0];
                windowStart = fromSqlTimestamp(row.window_start);
                const count = row.count;

                void Promise.all([
                    runRedis('window-start-seed', redisClient.set(windowStartKey, windowStart)),
                    runRedis('count-seed', redisClient.set(countKey, count)),
                ]);
            }
        }

        if ( windowStart === 0 ) {
            windowStart = Date.now();
            void Promise.all([
                runRedis('window-start-init', redisClient.set(windowStartKey, windowStart)),
                runRedis('count-init', redisClient.set(countKey, 0)),
            ]);

            this.db.write(
                'INSERT INTO `rl_usage_fixed_window` (`key`, `window_start`, `count`) VALUES (?, ?, ?)',
                [dbKey, toSqlTimestamp(windowStart), 0],
            );

        }

        if ( windowStart + period < Date.now() ) {
            windowStart = Date.now();
            Promise.all([
                runRedis('window-start-reset', redisClient.set(windowStartKey, windowStart)),
                runRedis('count-reset', redisClient.set(countKey, 0)),
            ]);

            this.db.write(
                'UPDATE `rl_usage_fixed_window` SET `window_start` = ?, `count` = ? WHERE `key` = ?',
                [toSqlTimestamp(windowStart), 0, dbKey],
            );
        }

        const currentRead = await runRedis('count-read', redisClient.get(countKey));
        if ( ! currentRead.ok ) {
            await this.#checkAndIncrementInDb({ dbKey, max, period, methodName });
            return;
        }
        const current = Number.isFinite(Number(currentRead.value)) ? Number(currentRead.value) : 0;
        if ( current >= max ) {
            throw APIError.create('rate_limit_exceeded', null, {
                method_name: methodName,
                rate_limit: { max, period },
            });
        }

        runRedis('count-incr', redisClient.incr(countKey));
        this.db.write(
            'UPDATE `rl_usage_fixed_window` SET `count` = `count` + 1 WHERE `key` = ?',
            [dbKey],
        );
    }

    /**
    * Gets the consumer ID for rate limiting based on the current user context
    * @returns {string} Consumer ID in format 'user:{id}' if user exists, or 'missing' if no user
    * @private
    */
    _get_consumer_id () {
        const context = Context.get();
        const user = context.get('user');
        return user ? `user:${user.id}` : 'missing';
    }
}

module.exports = {
    RateLimitService,
};
