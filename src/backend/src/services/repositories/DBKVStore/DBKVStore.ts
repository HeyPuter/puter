// TypeScript conversion of DBKVStore.mjs
import murmurhash from "murmurhash";
// @ts-ignore
import APIError from '../../../api/APIError.js';
// @ts-ignore
import { Context } from "../../../util/context.js";

const GLOBAL_APP_KEY = 'global';

export class DBKVStore {
    #db: any;
    #meteringService: any;
    #global_config: any = {};

    // TODO DS: make table name configurable
    constructor({ sqlClient, meteringAndBillingService, globalConfig }: { sqlClient: any, meteringAndBillingService: any, globalConfig: any }) {
        this.#db = sqlClient;
        this.#meteringService = meteringAndBillingService;
        this.#global_config = globalConfig;
    }

    async get({ key }: { key: any }): Promise<any> {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        if (!user) {
            throw new Error('User not found');
        }

        const deleteExpired = async (rows: any[]) => {
            const query = `DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (${rows.map(() => '?').join(',')})`;
            const params = [user.id, app?.uid ?? GLOBAL_APP_KEY, ...rows.map((r: any) => r.kkey_hash)];
            return await this.#db.write(query, params);
        };

        if (Array.isArray(key)) {
            const keys = key;
            const key_hashes = keys.map((key: any) => murmurhash.v3(key));
            const rows = app
                ? await this.#db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (?)', [user.id, app.uid, key_hashes])
                : await this.#db.read(
                    `SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') AND kkey_hash IN (${key_hashes.map(() => '?').join(',')})`,
                    [user.id, key_hashes]
                );

            const kv: any = {};
            rows.forEach((row: any) => {
                row.value = this.#db.case({
                    mysql: () => row.value,
                    otherwise: () => JSON.parse(row.value ?? 'null'),
                })();
                kv[row.kkey] = row.value;
            });

            const expiredKeys: any[] = [];
            rows.forEach((row: any) => {
                if (row?.expireAt && row.expireAt < Date.now() / 1000) {
                    expiredKeys.push(row);
                    kv[row.kkey] = null;
                } else {
                    kv[row.kkey] = row.value ?? null;
                }
            });

            // clean up expired keys asynchronously
            if (expiredKeys.length) {
                deleteExpired(expiredKeys);
            }

            return keys.map((key: any) => kv[key]);
        }

        const key_hash = murmurhash.v3(key);
        const kv = app
            ? await this.#db.read('SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1', [user.id, app.uid, key_hash])
            : await this.#db.read(
                `SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') AND kkey_hash=? LIMIT 1`,
                [user.id, key_hash]
            );

        if (kv[0]) {
            kv[0].value = this.#db.case({
                mysql: () => kv[0].value,
                otherwise: () => JSON.parse(kv[0].value ?? 'null'),
            })();
        }

        if (kv[0]?.expireAt && kv[0].expireAt < Date.now() / 1000) {
            // key has expired
            // clean up asynchronously
            deleteExpired([kv[0]]);
            return null;
        }

        await this.#meteringService.incrementUsage(actor, 'kv:read', Array.isArray(key) ? key.length : 1);

        return kv[0]?.value ?? null;
    }

    async set({ key, value, expireAt }: { key: any, value: any, expireAt?: any }): Promise<boolean> {
        const actor = Context.get('actor');
        const config = this.#global_config;

        key = String(key);
        if (Buffer.byteLength(key, 'utf8') > config.kv_max_key_size) {
            throw new Error(`key is too large. Max size is ${config.kv_max_key_size}.`);
        }

        value = value === undefined ? null : value;
        if (
            value !== null &&
            Buffer.byteLength(JSON.stringify(value), 'utf8') > config.kv_max_value_size
        ) {
            throw new Error(`value is too large. Max size is ${config.kv_max_value_size}.`);
        }

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if (!user) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        try {
            await this.#db.write(
                `INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
                    VALUES (?, ?, ?, ?, ?, ?) ${this.#db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE value = ?',
                    sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET value = excluded.value',
                })
                }`,
                [
                    user.id,
                    app?.uid ?? GLOBAL_APP_KEY,
                    key_hash,
                    key,
                    JSON.stringify(value),
                    expireAt ?? null,
                    ...this.#db.case({ mysql: [value], otherwise: [] }),
                ]
            );
        } catch (e: any) {
            console.error(e);
        }

        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }

    async del({ key }: { key: any }): Promise<boolean> {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if (!user) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        await this.#db.write('DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?', [
            user.id,
            app?.uid ?? GLOBAL_APP_KEY,
            key_hash,
        ]);

        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }

    async list({ as }: { as?: any }): Promise<any> {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        if (!user) {
            throw new Error('User not found');
        }

        let rows = app
            ? await this.#db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=?', [user.id, app.uid])
            : await this.#db.read(
                `SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}')`,
                [user.id]
            );

        rows = rows.filter((row: any) => {
            return !row?.expireAt || row?.expireAt > Date.now() / 1000;
        });

        rows = rows.map((row: any) => ({
            key: row.kkey,
            value: this.#db.case({
                mysql: () => row.value,
                otherwise: () => JSON.parse(row.value ?? 'null'),
            })(),
        }));

        as = as || 'entries';

        if (!['keys', 'values', 'entries'].includes(as)) {
            throw APIError.create('field_invalid', null, {
                key: 'as',
                expected: '"keys", "values", or "entries"',
            });
        }

        if (as === 'keys') {
            rows = rows.map((row: any) => row.key);
        } else if (as === 'values') {
            rows = rows.map((row: any) => row.value);
        }

        await this.#meteringService.incrementUsage(actor, 'kv:read', rows.length);

        return rows;
    }

    async flush(): Promise<boolean> {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if (!user) {
            throw new Error('User not found');
        }

        await this.#db.write('DELETE FROM kv WHERE user_id=? AND app=?', [
            user.id,
            app?.uid ?? GLOBAL_APP_KEY,
        ]);

        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }

    async expireAt({ key, timestamp }: { key: any, timestamp: any }): Promise<any> {
        if (key === '') {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        timestamp = Number(timestamp);

        return await this.#expireat(key, timestamp);
    }

    async expire({ key, ttl }: { key: any, ttl: any }): Promise<any> {
        if (key === '') {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        ttl = Number(ttl);

        // timestamp in seconds
        let timestamp = Math.floor(Date.now() / 1000) + ttl;

        return await this.#expireat(key, timestamp);
    }

    async incr({ key, pathAndAmountMap }: { key: string, pathAndAmountMap: Record<string, number> }): Promise<any> {
        let currVal = await this.get({ key });
        const pathEntries = Object.entries(pathAndAmountMap);
        if (typeof currVal !== 'object' && pathEntries.length <= 1 && !pathEntries[0]?.[0]) {
            const amount = pathEntries[0]?.[1] ?? 1;
            this.set({ key, value: (Number(currVal) || 0) + amount });
            return (Number(currVal) || 0) + amount;
        }
        // TODO DS: support arrays this also needs dynamodb implementation
        if (Array.isArray(currVal)) {
            throw new Error('Current value is an array');
        }
        if (!currVal) {
            currVal = {};
        }
        if (typeof currVal !== 'object') {
            throw new Error('Current value is not an object');
        }
        // create or change values as needed
        for (const [path, amount] of Object.entries(pathAndAmountMap)) {
            const pathParts = path.split('.');
            let obj = currVal;
            if (obj === null) continue;
            for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (!obj[part]) {
                    obj[part] = {};
                }
                if (typeof obj[part] !== 'object' || Array.isArray(currVal)) {
                    throw new Error(`Path ${pathParts.slice(0, i + 1).join('.')} is not an object`);
                }
                obj = obj[part];
            }
            if (obj === null) continue;
            const lastPart = pathParts[pathParts.length - 1];
            if (!obj[lastPart]) {
                obj[lastPart] = 0;
            }
            if (typeof obj[lastPart] !== 'number') {
                throw new Error(`Value at path ${path} is not a number`);
            }
            obj[lastPart] += amount;
        }
        this.set({ key, value: currVal });
        return currVal;
    }

    async decr(...params: Parameters<typeof DBKVStore.prototype.incr>): Promise<any> {
        return await this.incr(...params);
    }

    async #expireat(key: any, timestamp: any): Promise<any> {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if (!user) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        try {
            await this.#db.write(
                `INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
                    VALUES (?, ?, ?, ?, ?, ?) ${this.#db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE expireAt = ?',
                    sqlite: 'ON CONFLICT(user_id, app, kkey_hash) DO UPDATE SET expireAt = excluded.expireAt',
                })
                }`,
                [
                    user.id,
                    app?.uid ?? GLOBAL_APP_KEY,
                    key_hash,
                    key,
                    null, // empty value
                    timestamp,
                    ...this.#db.case({ mysql: [timestamp], otherwise: [] }),
                ]
            );
        } catch (e: any) {
            console.error(e);
        }
    }
}