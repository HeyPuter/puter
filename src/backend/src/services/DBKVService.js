const { get_app } = require("../helpers");
const { Context } = require("../util/context");
const BaseService = require("./BaseService");
const { DB_READ } = require("./database/consts");

class DBKVService extends BaseService {
    static MODULES = {
        murmurhash: require('murmurhash'),
    }

    _init () {
        this.db = this.services.get('database').get(DB_READ, 'kvstore');
    }

    static IMPLEMENTS = {
        ['puter-kvstore']: {
            async get ({ app_uid, key }) {
                const actor = Context.get('actor');

                // If the actor is an app then it gets its own KV store.
                // The way this is implemented isn't ideal for future behaviour;
                // a KV implementation specified by the user would have parameters
                // that are scoped to the app, so this should eventually be
                // changed to get the app ID from the same interface that would
                // be used to obtain per-app user-specified implementation params.
                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;

                if ( ! user ) throw new Error('User not found');

                if ( ! app && app_uid ) {
                    app = await get_app({ uid: app_uid });
                }

                if ( Array.isArray(key) ) {
                    const keys = key;
                    const key_hashes = keys.map(key => this.modules.murmurhash.v3(key));
                    const rows = app ? await this.db.read(
                        `SELECT kkey, value FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (?)`,
                        [ user.id, app.uid, key_hashes ]
                    ) : await this.db.read(
                        `SELECT kkey, value FROM kv WHERE user_id=? AND (app IS NULL OR app = 'global') AND kkey_hash IN (?)`,
                        [ user.id, key_hashes ]
                    );

                    const kv = {};
                    rows.forEach(row => {
                        row.value = this.db.case({
                            mysql: () => row.value,
                            otherwise: () => JSON.parse(row.value ?? 'null'),
                        })();
                        kv[row.kkey] = row.value;
                    });

                    return keys.map(key => kv[key]);
                }

                const key_hash = this.modules.murmurhash.v3(key);
                const kv = app ? await this.db.read(
                    `SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1`,
                    [ user.id, app.uid, key_hash ]
                ) : await this.db.read(
                    `SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = 'global') AND kkey_hash=? LIMIT 1`,
                    [ user.id, key_hash ]
                );
                
                if ( kv[0] ) kv[0].value = this.db.case({
                    mysql: () => kv[0].value,
                    otherwise: () => JSON.parse(kv[0].value ?? 'null'),
                })();

                return kv[0]?.value ?? null;
            },
            async set ({ app_uid, key, value }) {
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
                if ( ! user ) throw new Error('User not found');
                
                if ( ! app && app_uid ) {
                    app = await get_app({ uid: app_uid });
                }

                const key_hash = this.modules.murmurhash.v3(key);

                try {
                    await this.db.write(
                        `INSERT INTO kv (user_id, app, kkey_hash, kkey, value)
                        VALUES (?, ?, ?, ?, ?) ` +
                        this.db.case({
                            mysql: 'ON DUPLICATE KEY UPDATE value = ?',
                            sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET value = excluded.value',
                        }),
                        [
                            user.id, app?.uid ?? 'global', key_hash, key,
                            JSON.stringify(value),
                            ...this.db.case({ mysql: [value], otherwise: [] }),
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
            async del ({ app_uid, key }) {
                const actor = Context.get('actor');

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;
                if ( ! user ) throw new Error('User not found');

                if ( ! app && app_uid ) {
                    app = await get_app({ uid: app_uid });
                }

                const key_hash = this.modules.murmurhash.v3(key);

                await this.db.write(
                    `DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?`,
                    [ user.id, app?.uid ?? 'global', key_hash ]
                );

                return true;
            },
            async list ({ app_uid, as }) {
                const actor = Context.get('actor');

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;

                if ( ! app && app_uid ) {
                    app = await get_app({ uid: app_uid });
                }

                if ( ! user ) throw new Error('User not found');

                let rows = app ? await this.db.read(
                    `SELECT kkey, value FROM kv WHERE user_id=? AND app=?`,
                    [ user.id, app.uid ]
                ) : await this.db.read(
                    `SELECT kkey, value FROM kv WHERE user_id=? AND (app IS NULL OR app = 'global')`,
                    [ user.id ]
                );

                rows = rows.map(row => ({
                    key: row.kkey,
                    value: this.db.case({
                        mysql: () => row.value,
                        otherwise: () => JSON.parse(row.value ?? 'null')
                    })(),
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
            async flush ({ app_uid }) {
                const actor = Context.get('actor');

                let app = actor.type?.app ?? undefined;
                const user = actor.type?.user ?? undefined;
                if ( ! user ) throw new Error('User not found');

                if ( ! app && app_uid ) {
                    app = await get_app({ uid: app_uid });
                }

                await this.db.write(
                    `DELETE FROM kv WHERE user_id=? AND app=?`,
                    [ user.id, app?.uid ?? 'global' ]
                );

                return true;
            },
        }
    };
}

module.exports = {
    DBKVService,
};
