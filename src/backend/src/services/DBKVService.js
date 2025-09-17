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
const { Context } = require('../util/context');
const BaseService = require('./BaseService');
const { DB_READ } = require('./database/consts');

const GLOBAL_APP_KEY = 'global';
class DBKVService extends BaseService {
    static MODULES = {
        murmurhash: require('murmurhash'),
    };

    _init() {
        this.db = this.services.get('database').get(DB_READ, 'kvstore');
    }

    static IMPLEMENTS = {
        ['puter-kvstore']: {
            async get({ key }) {
                const actor = Context.get('actor');

                // If the actor is an app then it gets its own KV store.
                // The way this is implemented isn't ideal for future behaviour;
                // a KV implementation specified by the user would have parameters
                // that are scoped to the app, so this should eventually be
                // changed to get the app ID from the same interface that would
                // be used to obtain per-app user-specified implementation params.
                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;

                if ( !user ) {
                    throw new Error('User not found');
                }

                const deleteExpired = async (rows) => {
                    const query = `DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (${rows.map(() => '?').join(',')})`;
                    const params = [user.id, app?.uid ?? GLOBAL_APP_KEY, ...rows.map(r => r.kkey_hash)];
                    return await this.db.write(query, params);
                };

                if ( Array.isArray(key) ) {
                    const keys = key;
                    const key_hashes = keys.map(key => this.modules.murmurhash.v3(key));
                    const rows = app ? await this.db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (?)',
                                    [user.id, app.uid, key_hashes]) : await this.db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') ` +
                                        `AND kkey_hash IN (${key_hashes.map(() => '?').join(',')})`,
                    [user.id, key_hashes]);

                    const kv = {};
                    rows.forEach(row => {
                        row.value = this.db.case({
                            mysql: () => row.value,
                            otherwise: () => JSON.parse(row.value ?? 'null'),
                        })();
                        kv[row.kkey] = row.value;
                    });

                    const expiredKeys = [];
                    rows.forEach(row => {
                        if ( row?.expireAt && row.expireAt < (Date.now() / 1000) ) {
                            expiredKeys.push(row);
                            kv[row.kkey] = null;
                        } else {
                            kv[row.kkey] = row.value ?? null;
                        }
                    });

                    // clean up expired keys asynchronously
                    if ( expiredKeys.length ) {
                        deleteExpired(expiredKeys);
                    }

                    return keys.map(key => kv[key]);

                }

                const key_hash = this.modules.murmurhash.v3(key);
                const kv = app ? await this.db.read('SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1',
                                [user.id, app.uid, key_hash]) : await this.db.read(`SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') AND kkey_hash=? LIMIT 1`,
                                [user.id, key_hash]);

                if ( kv[0] ) {
                    kv[0].value = this.db.case({
                        mysql: () => kv[0].value,
                        otherwise: () => JSON.parse(kv[0].value ?? 'null'),
                    })();
                }

                if ( kv[0]?.expireAt && kv[0].expireAt < (Date.now() / 1000) ) {
                    // key has expired
                    // clean up asynchronously
                    deleteExpired([kv[0]]);
                    return null;
                }

                return kv[0]?.value ?? null;
            },
            async set({ key, value, expireAt }) {
                const actor = Context.get('actor');
                const config = this.global_config;

                // Validate the key
                // get() doesn't String() the key but it only passes it to
                // murmurhash.v3() so it doesn't need to ¯\_(ツ)_/¯
                key = String(key);
                if ( Buffer.byteLength(key, 'utf8') > config.kv_max_key_size ) {
                    throw new Error(`key is too large. Max size is ${config.kv_max_key_size}.`);
                }

                // Validate the value
                value = value === undefined ? null : value;
                if (
                    value !== null &&
                    Buffer.byteLength(JSON.stringify(value), 'utf8') >
                    config.kv_max_value_size
                ) {
                    throw new Error(`value is too large. Max size is ${config.kv_max_value_size}.`);
                }

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;
                if ( !user ) {
                    throw new Error('User not found');
                }

                const key_hash = this.modules.murmurhash.v3(key);

                try {
                    await this.db.write(`INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
                        VALUES (?, ?, ?, ?, ?, ?) ${
    this.db.case({
        mysql: 'ON DUPLICATE KEY UPDATE value = ?',
        sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET value = excluded.value',
    })}`,
                    [
                        user.id, app?.uid ?? GLOBAL_APP_KEY, key_hash, key,
                        JSON.stringify(value), expireAt ?? null,
                        ...this.db.case({ mysql: [value], otherwise: [] }),
                    ]);
                } catch( e ) {
                    // I discovered that my .sqlite file was corrupted and the update
                    // above didn't work. The current database initialization does not
                    // cause this issue so I'm adding this log as a safeguard.
                    // - KernelDeimos / ED
                    const svc_error = this.services.get('error-service');
                    svc_error.report('kvstore:sqlite_error', {
                        message: 'Broken database version - please contact maintainers',
                        source: e,
                    });
                }

                return true;
            },
            async del({ key }) {
                const actor = Context.get('actor');

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;
                if ( !user ) {
                    throw new Error('User not found');
                }

                const key_hash = this.modules.murmurhash.v3(key);

                await this.db.write('DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?',
                                [user.id, app?.uid ?? GLOBAL_APP_KEY, key_hash]);

                return true;
            },
            async list({ as }) {
                const actor = Context.get('actor');

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;

                if ( !user ) {
                    throw new Error('User not found');
                }

                let rows = app ? await this.db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=?',
                                [user.id, app.uid]) : await this.db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}')`,
                                [user.id]);

                rows = rows.filter (row => {
                    return !row?.expireAt || row?.expireAt  > Date.now() / 1000;
                });

                rows = rows.map(row => ({
                    key: row.kkey,
                    value: this.db.case({
                        mysql: () => row.value,
                        otherwise: () => JSON.parse(row.value ?? 'null'),
                    })(),
                }));

                as = as || 'entries';

                if ( !['keys', 'values', 'entries'].includes(as) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'as',
                        expected: '"keys", "values", or "entries"',
                    });
                }

                if ( as === 'keys' ) {
                    rows = rows.map(row => row.key);
                }
                else if ( as === 'values' ) {
                    rows = rows.map(row => row.value);
                }

                return rows;
            },
            async flush() {
                const actor = Context.get('actor');

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;
                if ( !user ) {
                    throw new Error('User not found');
                }

                await this.db.write('DELETE FROM kv WHERE user_id=? AND app=?',
                                [user.id, app?.uid ?? GLOBAL_APP_KEY]);

                return true;
            },
            async expireAt({ key, timestamp }) {
                if ( key === '' ) {
                    throw APIError.create('field_empty', null, {
                        key: 'key',
                    });
                }

                timestamp = Number(timestamp);

                return await this._expireat(key, timestamp);
            },

            async expire({ key, ttl }) {
                if ( key === '' ) {
                    throw APIError.create('field_empty', null, {
                        key: 'key',
                    });
                }

                ttl = Number(ttl);

                // timestamp in seconds
                let timestamp = Math.floor(Date.now() / 1000) + ttl;

                return await this._expireat(key, timestamp);
            },

        },
    };
    async _expireat(key, timestamp) {
        const actor = Context.get('actor');

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( !user ) {
            throw new Error('User not found');
        }

        const key_hash = this.modules.murmurhash.v3(key);

        try {
            await this.db.write(`INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
                VALUES (?, ?, ?, ?, ?, ?) ${
    this.db.case({
        mysql: 'ON DUPLICATE KEY UPDATE expireAt = ?',
        sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET expireAt = excluded.expireAt',
    })}`,
            [
                user.id,
                app?.uid ?? GLOBAL_APP_KEY,
                key_hash,
                key,
                null, // empty value
                timestamp,
                ...this.db.case({ mysql: [timestamp], otherwise: [] }),
            ]);
        } catch( e ) {
            // I discovered that my .sqlite file was corrupted and the update
            // above didn't work. The current database initialization does not
            // cause this issue so I'm adding this log as a safeguard.
            // - KernelDeimos / ED
            const svc_error = this.services.get('error-service');
            svc_error.report('kvstore:sqlite_error', {
                message: 'Broken database version - please contact maintainers',
                source: e,
            });
        }
    }
}

module.exports = {
    DBKVService,
};
