// METADATA // {"ai-commented":{"service":"claude"}}
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
const APIError = require("../../api/APIError");
const { Context } = require("../../util/context");
const BaseService = require("../BaseService");
const { SyncFeature } = require("../../traits/SyncFeature");
const { DB_WRITE } = require("../database/consts");

const ts_to_sql = (ts) => Math.floor(ts / 1000);
const ts_fr_sql = (ts) => ts * 1000;


/**
* RateLimitService class handles rate limiting functionality for API requests.
* Implements a fixed window counter strategy to track and limit request rates
* per user/consumer. Manages rate limit data both in memory (KV store) and
* persistent storage (database). Extends BaseService and includes SyncFeature
* for synchronized rate limit checking and incrementing.
*/
class RateLimitService extends BaseService {
    static MODULES = {
        kv: globalThis.kv,
    }

    static FEATURES = [
        new SyncFeature([
            'check_and_increment',
        ]),
    ]


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
        const { kv } = this.modules;
        const consumer_id = this._get_consumer_id();
        const method_name = key;
        key = `${consumer_id}:${key}`
        const kvkey = `rate-limit:${key}`;
        const dbkey = options.global ? key : `${this.global_config.server_id}:${key}`;

        // Fixed window counter strategy (see devlog 2023-11-21)
        let window_start = kv.get(`${kvkey}:window_start`) ?? 0;
        if ( window_start === 0 ) {
            // Try database
            const rows = await this.db.read(
                'SELECT * FROM `rl_usage_fixed_window` WHERE `key` = ?',
                [dbkey]
            );

            if ( rows.length !== 0 ) {
                const row = rows[0];
                window_start = ts_fr_sql(row.window_start);
                const count = row.count;

                kv.set(`${kvkey}:window_start`, window_start);
                kv.set(`${kvkey}:count`, count);
            }
        }

        if ( window_start === 0 ) {
            window_start = Date.now();
            kv.set(`${kvkey}:window_start`, window_start);
            kv.set(`${kvkey}:count`, 0);

            await this.db.write(
                'INSERT INTO `rl_usage_fixed_window` (`key`, `window_start`, `count`) VALUES (?, ?, ?)',
                [dbkey, ts_to_sql(window_start), 0]
            );

            console.log(
                'CREATE window_start and count',
                { window_start, count: 0 }
            );
        }

        if ( window_start + period < Date.now() ) {
            window_start = Date.now();
            kv.set(`${kvkey}:window_start`, window_start);
            kv.set(`${kvkey}:count`, 0);

            await this.db.write(
                'UPDATE `rl_usage_fixed_window` SET `window_start` = ?, `count` = ? WHERE `key` = ?',
                [ts_to_sql(window_start), 0, dbkey]
            );
        }

        const current = kv.get(`${kvkey}:count`) ?? 0;
        if ( current >= max ) {
            throw APIError.create('rate_limit_exceeded', null, {
                method_name,
                rate_limit: { max, period }
            });
        }

        kv.incr(`${kvkey}:count`);
        await this.db.write(
            'UPDATE `rl_usage_fixed_window` SET `count` = `count` + 1 WHERE `key` = ?',
            [dbkey]
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
