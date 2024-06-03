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
const config = require("../config");
const APIError = require("../api/APIError");
const { DB_READ, DB_WRITE } = require("../services/database/consts");
const { Driver } = require("../definitions/Driver");

class DBKVStore extends Driver {
    static ID = 'public-db-kvstore';
    static VERSION = '0.0.0';
    static INTERFACE = 'puter-kvstore';
    static MODULES = {
        murmurhash: require('murmurhash'),
    }
    static METHODS = {
        get: async function ({ key }) {
            console.log('THIS WAS CALLED', { key });
            const actor = this.context.get('actor');

            // If the actor is an app then it gets its own KV store.
            // The way this is implemented isn't ideal for future behaviour;
            // a KV implementation specified by the user would have parameters
            // that are scoped to the app, so this should eventually be
            // changed to get the app ID from the same interface that would
            // be used to obtain per-app user-specified implementation params.
            const app = actor.type?.app ?? undefined;
            const user = actor.type?.user ?? undefined;

            if ( ! user ) throw new Error('User not found');

            const db = this.services.get('database').get(DB_READ, 'kvstore');
            const key_hash = this.modules.murmurhash.v3(key);
            const kv = app ? await db.read(
                `SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1`,
                [ user.id, app.uid, key_hash ]
            ) : await db.read(
                `SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = 'global') AND kkey_hash=? LIMIT 1`,
                [ user.id, key_hash ]
            );

            return kv[0]?.value ?? null;
        },
        set: async function ({ key, value }) {
            console.log('THIS WAS CALLED (SET)', { key, value })
            const actor = this.context.get('actor');

            // Validate the key
            // get() doesn't String() the key but it only passes it to
            // murmurhash.v3() so it doesn't need to ¯\_(ツ)_/¯
            key = String(key);
            if ( Buffer.byteLength(key, 'utf8') > config.kv_max_key_size ) {
                throw new Error(`key is too large. Max size is ${config.kv_max_key_size}.`);
            }

            // Validate the value
            value = value === undefined ? null : String(value);
            if (
                value !== null &&
                Buffer.byteLength(value, 'utf8') > config.kv_max_value_size
            ) {
                throw new Error(`value is too large. Max size is ${config.kv_max_value_size}.`);
            }

            const app = actor.type?.app ?? undefined;
            const user = actor.type?.user ?? undefined;
            if ( ! user ) throw new Error('User not found');

            const db = this.services.get('database').get(DB_WRITE, 'kvstore');
            const key_hash = this.modules.murmurhash.v3(key);

            try {
                await db.write(
                    `INSERT INTO kv (user_id, app, kkey_hash, kkey, value)
                    VALUES (?, ?, ?, ?, ?) ` +
                    db.case({
                        mysql: 'ON DUPLICATE KEY UPDATE value = ?',
                        sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET value = excluded.value',
                    }),
                    [
                        user.id, app?.uid ?? 'global', key_hash, key, value,
                        ...db.case({ mysql: [value], otherwise: [] }),
                    ]
                );
            } catch (e) {
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
        del: async function ({ key }) {
            const actor = this.context.get('actor');

            const app = actor.type?.app ?? undefined;
            const user = actor.type?.user ?? undefined;
            if ( ! user ) throw new Error('User not found');

            const db = this.services.get('database').get(DB_WRITE, 'kvstore');
            const key_hash = this.modules.murmurhash.v3(key);

            await db.write(
                `DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?`,
                [ user.id, app?.uid ?? 'global', key_hash ]
            );

            return true;
        },
        list: async function ({ as }) {
            const actor = this.context.get('actor');

            const app = actor.type?.app ?? undefined;
            const user = actor.type?.user ?? undefined;

            if ( ! user ) throw new Error('User not found');

            const db = this.services.get('database').get(DB_READ, 'kvstore');
            let rows = app ? await db.read(
                `SELECT kkey, value FROM kv WHERE user_id=? AND app=?`,
                [ user.id, app.uid ]
            ) : await db.read(
                `SELECT kkey, value FROM kv WHERE user_id=? AND (app IS NULL OR app = 'global')`,
                [ user.id ]
            );

            rows = rows.map(row => ({
                key: row.kkey,
                value: row.value,
            }));

            as = as || 'entries';

            if ( ! ['keys','values','entries'].includes(as) ) {
                throw APIError.create('field_invalid', null, {
                    key: 'as',
                    expected: '"keys", "values", or "entries"',
                });
            }

            if ( as === 'keys' ) rows = rows.map(row => row.key);
            else if ( as === 'values' ) rows = rows.map(row => row.value);

            return rows;
        },
        flush: async function () {
            const actor = this.context.get('actor');

            const app = actor.type?.app ?? undefined;
            const user = actor.type?.user ?? undefined;
            if ( ! user ) throw new Error('User not found');

            const db = this.services.get('database').get(DB_WRITE, 'kvstore');

            await db.write(
                `DELETE FROM kv WHERE user_id=? AND app=?`,
                [ user.id, app?.uid ?? 'global' ]
            );

            return true;
        }
    }
}

module.exports = {
    DBKVStore,
}
