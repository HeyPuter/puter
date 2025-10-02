import murmurhash from "murmurhash";
import APIError from '../../../api/APIError.js';
import { Context } from "../../../util/context.js";

const GLOBAL_APP_KEY = 'global';
export class DBKVStore {
    #db;
    /** @type {import('../../abuse-prevention/MeteringService/MeteringService').MeteringAndBillingService} */
    #meteringService;
    global_config = {};
    // TODO DS: make table name configurable
    constructor(sqlDb, meteringService, global_config) {
        this.#db = sqlDb;
        this.#meteringService = meteringService;
        this.global_config = global_config;
    }
    async get({ key }) {
        const actor = Context.get('actor');

        // If the actor is an app then it gets its own KV store.
        // The way this is implemented isn't ideal for future behaviour;
        // a KV implementation specified by the user would have parameters
        // that are scoped to the app, so this should eventually be
        // changed to get the app ID from the same interface that would
        // be used to obtain per-app user-specified implementation params.
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        if ( !user ) {
            throw new Error('User not found');
        }

        const deleteExpired = async (rows) => {
            const query = `DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (${rows.map(() => '?').join(',')})`;
            const params = [user.id, app?.uid ?? GLOBAL_APP_KEY, ...rows.map(r => r.kkey_hash)];
            return await this.#db.write(query, params);
        };

        if ( Array.isArray(key) ) {
            const keys = key;
            const key_hashes = keys.map(key => murmurhash.v3(key));
            const rows = app ? await this.#db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (?)',
                            [user.id, app.uid, key_hashes]) : await this.#db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') ` +
                                `AND kkey_hash IN (${key_hashes.map(() => '?').join(',')})`,
            [user.id, key_hashes]);

            const kv = {};
            rows.forEach(row => {
                row.value = this.#db.case({
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

        const key_hash = murmurhash.v3(key);
        const kv = app ? await this.#db.read('SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1',
                        [user.id, app.uid, key_hash]) : await this.#db.read(`SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') AND kkey_hash=? LIMIT 1`,
                        [user.id, key_hash]);

        if ( kv[0] ) {
            kv[0].value = this.#db.case({
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

        // TODO DS: we await because of the batching done for our sql db, we need to make OSS increment usage atomic
        await this.#meteringService.incrementUsage(actor, 'kv:read', Array.isArray(key) ? key.length : 1);

        return kv[0]?.value ?? null;
    }
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

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( !user ) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        try {
            await this.#db.write(`INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
                        VALUES (?, ?, ?, ?, ?, ?) ${
    this.#db.case({
        mysql: 'ON DUPLICATE KEY UPDATE value = ?',
        sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET value = excluded.value',
    })}`,
            [
                user.id, app?.uid ?? GLOBAL_APP_KEY, key_hash, key,
                JSON.stringify(value), expireAt ?? null,
                ...this.#db.case({ mysql: [value], otherwise: [] }),
            ]);
        } catch ( e ) {
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

        // TODO DS: we await because of the batching done for our sql db
        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }
    async del({ key }) {
        const actor = Context.get('actor');

        const app  = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( !user ) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        await this.#db.write('DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?',
                        [user.id, app?.uid ?? GLOBAL_APP_KEY, key_hash]);

        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }
    async list({ as }) {
        const actor = Context.get('actor');

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        if ( !user ) {
            throw new Error('User not found');
        }

        let rows = app ? await this.#db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=?',
                        [user.id, app.uid]) : await this.#db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}')`,
                        [user.id]);

        rows = rows.filter (row => {
            return !row?.expireAt || row?.expireAt  > Date.now() / 1000;
        });

        rows = rows.map(row => ({
            key: row.kkey,
            value: this.#db.case({
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

        await this.#meteringService.incrementUsage(actor, 'kv:read', rows.length);

        return rows;
    }
    async flush() {
        const actor = Context.get('actor');

        const app  = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( !user ) {
            throw new Error('User not found');
        }

        await this.#db.write('DELETE FROM kv WHERE user_id=? AND app=?',
                        [user.id, app?.uid ?? GLOBAL_APP_KEY]);

        // TODO DS: should handle actual number of deleted items
        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }
    async expireAt({ key, timestamp }) {
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        timestamp = Number(timestamp);

        return await this.#expireat(key, timestamp);
    }
    async expire({ key, ttl }) {
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        ttl = Number(ttl);

        // timestamp in seconds
        let timestamp = Math.floor(Date.now() / 1000) + ttl;

        return await this.#expireat(key, timestamp);
    }
    /** @type {(params: {key:string, pathAndAmountMap: Record<string, number>}) => Promise<unknown>} */
    async incr({ key, pathAndAmountMap }) {
        let currVal = await this.get({ key });
        const pathEntries = Object.entries(pathAndAmountMap);
        if ( typeof currVal !== 'object' && pathEntries.length <= 1 && !pathEntries[0]?.[0] ){
            const amount = pathEntries[0]?.[1] ?? 1;
            this.set({ key, value: (Number(currVal) || 0) + amount });
            return (Number(currVal) || 0) + amount;
        }
        // TODO DS: support arrays this also needs dynamodb implementation
        if ( Array.isArray(currVal) ){
            throw new Error('Current value is an array');
        }
        if ( !currVal ){
            currVal = {};
        }
        if ( typeof currVal !== 'object' ){
            throw new Error('Current value is not an object');
        }
        // create or change values as needed
        for ( const [path, amount] of Object.entries(pathAndAmountMap) ){
            const pathParts = path.split('.');
            let obj = currVal;
            for ( let i = 0; i < pathParts.length - 1; i++ ){
                const part = pathParts[i];
                if ( !obj[part] ){
                    obj[part] = {};
                }
                if ( typeof obj[part] !== 'object' || Array.isArray(currVal) ){
                    throw new Error(`Path ${pathParts.slice(0, i + 1).join('.')} is not an object`);
                }
                obj = obj[part];
            }
            const lastPart = pathParts[pathParts.length - 1];
            if ( !obj[lastPart] ){
                obj[lastPart] = 0;
            }
            if ( typeof obj[lastPart] !== 'number' ){
                throw new Error(`Value at path ${path} is not a number`);
            }
            obj[lastPart] += amount;
        }
        this.set({ key, value: currVal });
        return currVal;
    }
    async decr({ key, path = '', amount = 1 }) {
        return await this.incr({ key, path, amount: -amount });
    }
    async #expireat(key, timestamp) {
        const actor = Context.get('actor');

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( !user ) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        try {
            await this.#db.write(`INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
                VALUES (?, ?, ?, ?, ?, ?) ${
    this.#db.case({
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
                ...this.#db.case({ mysql: [timestamp], otherwise: [] }),
            ]);
        } catch ( e ) {
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