import murmurhash from 'murmurhash';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import APIError from '../../../api/APIError.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Context } from '../../../util/context.js';
import type { MeteringService } from '../../MeteringService/MeteringService.js';
import { RecursiveRecord } from '../../MeteringService/types.js';

const GLOBAL_APP_KEY = 'global';

export interface IDBKVStore {
    get ({ key }: { key: string | string[] }): Promise<unknown | null | (unknown | null)[]>;
    set ({ key, value, expireAt }: { key: string, value: unknown, expireAt?: number }): Promise<boolean>;
    del ({ key }: { key: string }): Promise<boolean>;
    list ({ as }: { as?: 'keys' | 'values' | 'entries' }): Promise<string[] | unknown[] | { key: string, value: unknown }[]>;
    flush (): Promise<boolean>;
    expireAt ({ key, timestamp }: { key: string, timestamp: number }): Promise<void>;
    expire ({ key, ttl }: { key: string, ttl: number }): Promise<void>;
    incr<T extends Record<string, number>>({ key, pathAndAmountMap }: { key: string, pathAndAmountMap: T }): Promise<T extends { '': number } ? number : RecursiveRecord<number>>;
    decr<T extends Record<string, number>>({ key, pathAndAmountMap }: { key: string, pathAndAmountMap: T }): Promise<T extends { '': number } ? number : RecursiveRecord<number>>;
}

export class DBKVStore implements IDBKVStore {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    #db: any;
    #meteringService: MeteringService;
    #global_config: Record<string, unknown> = {};

    // TODO DS: make table name configurable
    constructor ({ sqlClient, meteringService, globalConfig }: { sqlClient: unknown, meteringService: MeteringService, globalConfig: Record<string, unknown> }) {
        this.#db = sqlClient;
        this.#meteringService = meteringService;
        this.#global_config = globalConfig;
    }

    async get ({ key }: { key: string | string[] }) {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        if ( ! user ) {
            throw new Error('User not found');
        }

        const deleteExpired = async (rows: { kkey_hash: string }[]) => {
            const query = `DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (${rows.map(() => '?').join(',')})`;
            const params = [user.id, app?.uid ?? GLOBAL_APP_KEY, ...rows.map((r) => r.kkey_hash)];
            return await this.#db.write(query, params);
        };

        if ( Array.isArray(key) ) {
            const keys = key;
            const key_hashes = keys.map((key: string) => murmurhash.v3(key));
            const placeholders = key_hashes.map(() => '?').join(',');
            const params = app
                ? [user.id, app.uid, ...key_hashes]
                : [user.id, ...key_hashes];
            const rows = app
                ? await this.#db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=? AND kkey_hash IN (${placeholders})`, params)
                : await this.#db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') AND kkey_hash IN (${placeholders})`,
                                params);

            const kvPairs: Record<string, unknown> = {};
            rows.forEach((row: { kkey: string, value: string }) => {
                row.value = this.#db.case({
                    mysql: () => row.value,
                    otherwise: () => JSON.parse(row.value ?? 'null'),
                })();
                kvPairs[row.kkey] = row.value;
            });

            const expiredKeys: { kkey_hash: string }[] = [];
            rows.forEach((row: { kkey: string, expireAt: number, kkey_hash: string, value: unknown }) => {
                if ( row?.expireAt && row.expireAt < Date.now() / 1000 ) {
                    expiredKeys.push(row);
                    kvPairs[row.kkey] = null;
                } else {
                    kvPairs[row.kkey] = row.value ?? null;
                }
            });

            // clean up expired keys asynchronously
            if ( expiredKeys.length ) {
                deleteExpired(expiredKeys);
            }

            return keys.map((key: string) => Object.prototype.hasOwnProperty.call(kvPairs, key) ? kvPairs[key] : null) as unknown[];
        }

        const key_hash = murmurhash.v3(key);
        const kv = app
            ? await this.#db.read('SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1', [user.id, app.uid, key_hash])
            : await this.#db.read(`SELECT * FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}') AND kkey_hash=? LIMIT 1`,
                            [user.id, key_hash]);

        if ( kv[0] ) {
            kv[0].value = this.#db.case({
                mysql: () => kv[0].value,
                otherwise: () => JSON.parse(kv[0].value ?? 'null'),
            })();
        }

        if ( kv[0]?.expireAt && kv[0].expireAt < Date.now() / 1000 ) {
            // key has expired
            // clean up asynchronously
            deleteExpired([kv[0]]);
            return null;
        }

        await this.#meteringService.incrementUsage(actor, 'kv:read', Array.isArray(key) ? key.length : 1);

        return kv[0]?.value ?? null;
    }

    async set ({ key, value, expireAt }: { key: string, value: unknown, expireAt?: number }) {
        const actor = Context.get('actor');
        const config = this.#global_config;

        key = String(key);
        if ( Buffer.byteLength(key, 'utf8') > (config.kv_max_key_size as number) ) {
            throw new Error(`key is too large. Max size is ${config.kv_max_key_size}.`);
        }

        if (
            value !== null &&
            Buffer.byteLength(JSON.stringify(value), 'utf8') > (config.kv_max_value_size as number)
        ) {
            throw new Error(`value is too large. Max size is ${config.kv_max_value_size}.`);
        }

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        try {
            await this.#db.write(`INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
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
            ]);
        } catch ( e: unknown ) {
            console.error(e);
        }

        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }

    async del ({ key }: { key: string }) {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) {
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

    async list ({ as }: { as?: string }) {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        if ( ! user ) {
            throw new Error('User not found');
        }

        let rows = app
            ? await this.#db.read('SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND app=?', [user.id, app.uid])
            : await this.#db.read(`SELECT kkey, value, expireAt FROM kv WHERE user_id=? AND (app IS NULL OR app = '${GLOBAL_APP_KEY}')`,
                            [user.id]);

        rows = rows.filter((row: { expireAt: number }) => {
            return !row?.expireAt || row?.expireAt > Date.now() / 1000;
        });

        rows = rows.map((row: { kkey: string, value: string }) => ({
            key: row.kkey,
            value: this.#db.case({
                mysql: () => row.value,
                otherwise: () => JSON.parse(row.value ?? 'null'),
            })(),
        }));

        as = as || 'entries';

        if ( ! ['keys', 'values', 'entries'].includes(as) ) {
            throw APIError.create('field_invalid', null, {
                key: 'as',
                expected: '"keys", "values", or "entries"',
            });
        }

        if ( as === 'keys' ) {
            rows = rows.map((row: { key: string }) => row.key);
        } else if ( as === 'values' ) {
            rows = rows.map((row: { value: unknown }) => row.value);
        }

        await this.#meteringService.incrementUsage(actor, 'kv:read', rows.length);

        return rows;
    }

    async flush () {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) {
            throw new Error('User not found');
        }

        await this.#db.write('DELETE FROM kv WHERE user_id=? AND app=?', [
            user.id,
            app?.uid ?? GLOBAL_APP_KEY,
        ]);

        await this.#meteringService.incrementUsage(actor, 'kv:write', 1);

        return true;
    }

    async expireAt ({ key, timestamp }: { key: string, timestamp: number }) {
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        timestamp = Number(timestamp);

        return await this.#expireat(key, timestamp);
    }

    async expire ({ key, ttl }: { key: string, ttl: number }) {
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

    async incr<T extends Record<string, number>>({ key, pathAndAmountMap }: { key: string; pathAndAmountMap: T; }): Promise<T extends { '': number; } ? number : RecursiveRecord<number>> {
        if ( Object.values(pathAndAmountMap).find((v) => typeof v !== 'number') ) {
            throw new Error('All values in pathAndAmountMap must be numbers');
        }
        let currVal = await this.get({ key });
        const pathEntries = Object.entries(pathAndAmountMap);
        if ( typeof currVal !== 'object' && pathEntries.length <= 1 && !pathEntries[0]?.[0] ) {
            const amount = pathEntries[0]?.[1] ?? 1;
            this.set({ key, value: (Number(currVal) || 0) + amount });
            return ((Number(currVal) || 0) + amount) as T extends { '': number } ? number : RecursiveRecord<number>;
        }
        // TODO DS: support arrays this also needs dynamodb implementation
        if ( Array.isArray(currVal) ) {
            throw new Error('Current value is an array');
        }
        if ( ! currVal ) {
            currVal = {};
        }
        if ( typeof currVal !== 'object' ) {
            throw new Error('Current value is not an object');
        }
        // create or change values as needed
        for ( const [path, amount] of Object.entries(pathAndAmountMap) ) {
            const pathParts = path.split('.');
            let obj = currVal;
            if ( obj === null ) continue;
            for ( let i = 0; i < pathParts.length - 1; i++ ) {
                const part = pathParts[i];
                if ( ! obj[part] ) {
                    obj[part] = {};
                }
                if ( typeof obj[part] !== 'object' || Array.isArray(currVal) ) {
                    throw new Error(`Path ${pathParts.slice(0, i + 1).join('.')} is not an object`);
                }
                obj = obj[part];
            }
            if ( obj === null ) continue;
            const lastPart = pathParts[pathParts.length - 1];
            if ( ! obj[lastPart] ) {
                obj[lastPart] = 0;
            }
            if ( typeof obj[lastPart] !== 'number' ) {
                throw new Error(`Value at path ${path} is not a number`);
            }
            obj[lastPart] += amount;
        }
        this.set({ key, value: currVal });
        return currVal as T extends { '': number } ? number : RecursiveRecord<number>;
    }

    async decr<T extends Record<string, number>>({ key, pathAndAmountMap }: { key: string; pathAndAmountMap: T; }): Promise<T extends { '': number; } ? number : RecursiveRecord<number>> {
        return this.incr({ key, pathAndAmountMap: Object.fromEntries(Object.entries(pathAndAmountMap).map(([k, v]) => [k, -v])) as T });
    }

    async #expireat (key: string, timestamp: number) {
        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) {
            throw new Error('User not found');
        }

        const key_hash = murmurhash.v3(key);

        try {
            await this.#db.write(`INSERT INTO kv (user_id, app, kkey_hash, kkey, value, expireAt)
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
            ]);
        } catch ( e: unknown ) {
            console.error(e);
        }
    }
}
