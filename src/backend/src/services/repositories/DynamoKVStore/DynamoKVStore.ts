import { Actor, SystemActorType } from '@heyputer/backend/src/services/auth/Actor.js';
import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.js';
import type { MeteringService } from '@heyputer/backend/src/services/MeteringService/MeteringService.js';
import { RecursiveRecord } from '@heyputer/backend/src/services/MeteringService/types.js';
import { Context } from '@heyputer/backend/src/util/context.js';
import murmurhash from 'murmurhash';
import { DDBClient } from '../DDBClient.js';
import { PUTER_KV_STORE_TABLE_DEFINITION } from './tableDefinition.js';
import APIError from '../../../api/APIError.js';

export class DynamoKVStore {
    static GLOBAL_APP_KEY = 'os-global';
    static LEGACY_GLOBAL_APP_KEY = 'global';

    #ddbClient: DDBClient;
    #sqlClient: BaseDatabaseAccessService;
    #meteringService: MeteringService;
    #tableName = 'store-kv-v1';
    #pathCleanerRegex = /[:\-+/*]/g;
    #enableMigrationFromSQL = false;

    constructor ({ ddbClient, sqlClient, tableName, meteringService }: { ddbClient: DDBClient, sqlClient: BaseDatabaseAccessService, tableName: string, meteringService: MeteringService }) {
        this.#ddbClient = ddbClient;
        this.#sqlClient = sqlClient;
        this.#tableName = tableName;
        this.#meteringService = meteringService;
        this.#enableMigrationFromSQL = !this.#ddbClient.config?.aws; // TODO: disable via config after some time passes
        this.#createTableIfNotExists();
    }

    async #createTableIfNotExists () {
        if ( ! this.#enableMigrationFromSQL ) return;
        await this.#ddbClient.createTableIfNotExists({ ...PUTER_KV_STORE_TABLE_DEFINITION, TableName: this.#tableName }, 'ttl');
    }

    #getNameSpace (actor: Actor) {
        if ( actor.type instanceof SystemActorType ) {
            return 'v1:system';
        } else {
            const app = actor.type?.app ?? undefined;
            const user = actor.type?.user ?? undefined;
            if ( ! user ) throw new Error('User not found');

            return `v1:${app ? `${user.uuid}:${app.uid}`
                : `${user.uuid}:${this.#enableMigrationFromSQL ? DynamoKVStore.LEGACY_GLOBAL_APP_KEY : DynamoKVStore.GLOBAL_APP_KEY}`}`;
        }
    }

    async get ({ key }: { key: string | string[]; }): Promise<unknown | null | (unknown | null)[]> {
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        const actor = Context.get('actor');
        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;

        const namespace = this.#getNameSpace(actor);

        const multi = Array.isArray(key);
        const keys = multi ? key : [key];
        const values: unknown[] = [];

        let kvEntries;
        let usage;
        if ( multi ) {
            const entriesAndUsage  = (await this.#getBatches(namespace, keys));
            kvEntries = entriesAndUsage.kvEntries;
            usage = entriesAndUsage.usage;
        } else {
            const res = await this.#ddbClient.get(this.#tableName, { namespace, key });
            kvEntries = res.Item ? [res.Item] : [];
            usage = res.ConsumedCapacity?.CapacityUnits ?? 0;
        }

        this.#meteringService.incrementUsage(actor, 'kv:read', usage || 0);

        for ( const key of keys ) {
            const kv_entry = kvEntries?.find(e => e.key === key);
            const time = Date.now() / 1000;
            if ( kv_entry?.ttl && kv_entry.ttl <= (time) ) {
                values.push(null);
                continue;
            }
            if ( kv_entry?.value ) {
                values.push(kv_entry.value);
                continue;
            }

            if ( this.#enableMigrationFromSQL ) {
                const key_hash = murmurhash.v3(key);
                const kv_row = await this.#sqlClient.read('SELECT * FROM kv WHERE user_id=? AND app=? AND kkey_hash=? LIMIT 1',
                                [user.id, app?.uid ?? DynamoKVStore.LEGACY_GLOBAL_APP_KEY, key_hash]);

                if ( kv_row[0]?.value ) {
                    // update and delete from this table
                    (async () => {
                        await this.set({ key: kv_row[0].key, value: kv_row[0].value });
                        await this.#sqlClient.write('DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?',
                                        [user.id, app?.uid ?? DynamoKVStore.LEGACY_GLOBAL_APP_KEY, key_hash]);
                    })();
                    values.push(kv_row[0]?.value);
                    continue;
                }
            }
            values.push(kv_entry?.value ?? null);
        }
        return multi ? values : values[0];
    }
    /**
     *
     * @param {string} namespace
     * @param {string[]} allKeys
     * @returns
     */
    async #getBatches (namespace: string, allKeys: string[]) {

        const batches: string[][] = [];
        for ( let i = 0; i < allKeys.length; i += 100 ) {
            batches.push(allKeys.slice(i, i + 100));
        }
        const batchPromises = batches.map(async (keys) => {
            const requests = [...new Set(keys)].map(k => ({ table: this.#tableName, items: { namespace, key: k } }));
            const res = await this.#ddbClient.batchGet(requests);
            const kvEntries = res.Responses?.[this.#tableName];
            const usage = res.ConsumedCapacity?.reduce((acc, curr) => acc + (curr.CapacityUnits ?? 0), 0);
            return { kvEntries, usage };
        });

        const batchGets = await Promise.all(batchPromises);

        return batchGets.reduce((acc, curr) => {
            acc.kvEntries!.push(...curr?.kvEntries ?? []);
            acc.usage! += curr.usage || 0;
            return acc;
        }, { kvEntries: [], usage: 0 });

    }

    async set ({ key, value, expireAt }: { key: string; value: unknown; expireAt?: number; }): Promise<boolean> {

        const context = Context.get();
        const actor = context.get('actor');

        if ( key === '' ) {
            throw APIError.create('field_empty', undefined, {
                key: 'key',
            });
        }

        key = String(key);
        if ( Buffer.byteLength(key, 'utf8') > 1024 ) {
            throw new Error(`key is too large. Max size is ${1024}.`);
        }

        if ( this.#enableMigrationFromSQL ) {
            this.get({ key });
        }

        const namespace = this.#getNameSpace(actor);

        const res = await this.#ddbClient.put(this.#tableName, {
            namespace,
            key,
            value,
            ttl: expireAt,
        });

        this.#meteringService.incrementUsage(actor, 'kv:write', res?.ConsumedCapacity?.CapacityUnits ?? 1);
        return true;
    }

    async del ({ key }: { key: string; }): Promise<boolean> {
        const actor = Context.get('actor');

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) throw new Error('User not found');

        const namespace = this.#getNameSpace(actor);

        const res = await this.#ddbClient.del(this.#tableName, {
            namespace,
            key,
        });

        this.#meteringService.incrementUsage(actor, 'kv:write', res?.ConsumedCapacity?.CapacityUnits ?? 1);

        if ( this.#enableMigrationFromSQL ) {
            const key_hash = murmurhash.v3(key);
            await this.#sqlClient.write('DELETE FROM kv WHERE user_id=? AND app=? AND kkey_hash=?',
                            [user.id, app?.uid ?? DynamoKVStore.LEGACY_GLOBAL_APP_KEY, key_hash]);
        }

        return true;
    }

    async list ({ as }: { as?: 'keys' | 'values' | 'entries'; }): Promise<string[] | unknown[] | { key: string; value: unknown; }[]> {
        const actor = Context.get('actor');

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) throw new Error('User not found');

        const namespace = this.#getNameSpace(actor);

        const entriesRes = await this.#ddbClient.query(this.#tableName,
                        { namespace });

        this.#meteringService.incrementUsage(actor, 'kv:read', entriesRes.ConsumedCapacity?.CapacityUnits ?? 1);

        let entries = entriesRes.Items ?? [];

        entries = entries?.filter(entry => {
            if ( ! entry ) {
                return false;
            }
            if ( entry.ttl && entry.ttl <= (Date.now() / 1000) ) {
                return false;
            }
            return true;
        });

        if ( this.#enableMigrationFromSQL ) {
            const oldEntries =  await this.#sqlClient.read('SELECT * FROM kv WHERE user_id=? AND app=?',
                            [user.id, app?.uid ?? DynamoKVStore.LEGACY_GLOBAL_APP_KEY]);
            oldEntries.forEach(oldEntry => {
                if ( ! entries.find(e => e.key === oldEntry.kkey) ) {
                    if ( oldEntry.ttl && oldEntry.ttl <= (Date.now() / 1000) ) {
                        entries.push({ key: oldEntry.kkey, value: oldEntry.value });
                    }
                }
            });
        }

        entries = entries?.map(entry => ({
            key: entry.key,
            value: entry.value,
        }));

        as = as || 'entries';

        if ( ! ['keys', 'values', 'entries'].includes(as) ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'as',
                expected: '"keys", "values", or "entries"',
            });
        }

        if ( as === 'keys' ) entries = entries.map(entry => entry.key);
        else if ( as === 'values' ) entries = entries.map(entry => entry.value);

        return entries;
    }

    async flush () {
        const actor = Context.get('actor');

        const app = actor.type.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) throw new Error('User not found');

        const namespace = this.#getNameSpace(actor);

        // Query all keys
        const entriesRes = await this.#ddbClient.query(this.#tableName,
                        { namespace });
        const entries = entriesRes.Items ?? [];
        const readUsage = entriesRes?.ConsumedCapacity?.CapacityUnits ?? 0;

        // meter usage
        this.#meteringService.incrementUsage(actor, 'kv:read', readUsage);

        // TODO DS: implement batch delete so its faster and less demanding on server
        const allRes = (await Promise.all(entries.map(entry => {
            try {
                return this.#ddbClient.del(this.#tableName, {
                    namespace,
                    key: entry.key,
                });
            } catch ( e ) {
                console.error('Error deleting key', entry.key, e);
            }
        }))).filter(Boolean);

        const writeUsage = allRes.reduce((acc, curr) => acc + (curr?.ConsumedCapacity?.CapacityUnits ?? 0), 0);

        // meter usage
        this.#meteringService.incrementUsage(actor, 'kv:write', writeUsage);

        if ( this.#enableMigrationFromSQL ) {
            await this.#sqlClient.write('DELETE FROM kv WHERE user_id=? AND app=?',
                            [user.id, app?.uid ?? DynamoKVStore.LEGACY_GLOBAL_APP_KEY]);
        }

        return !!allRes;
    }

    async expireAt ({ key, timestamp }: { key: string; timestamp: number; }): Promise<void> {
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        timestamp = Number(timestamp);

        return await this.#expireAt(key, timestamp);
    }

    async expire ({ key, ttl }: { key: string; ttl: number; }): Promise<void> {
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        ttl = Number(ttl);

        // timestamp in seconds
        let timestamp = Math.floor(Date.now() / 1000) + ttl;

        return await this.#expireAt(key, timestamp);
    }

    async #createPaths ( namespace: string, key: string, pathList: string[]) {

        // Collect all intermediate map paths for all entries
        const allIntermediatePaths = new Set<string>();
        pathList.forEach((valPath) => {
            const chunks = ['value', ...valPath.split('.')].filter(Boolean);
            // For each intermediate map (excluding the leaf)
            for ( let i = 1; i < chunks.length; i++ ) {
                const subPath = chunks.slice(0, i).join('.');
                allIntermediatePaths.add(subPath);
            }
        });

        // TODO DS: make it so that the top layers are checked first to avoid creating each layer multiple times

        let writeUnits = 0;
        // Ensure each intermediate map layer exists by issuing a separate DynamoDB update for each
        for ( const layerPath of allIntermediatePaths ) {
            // Build attribute names for the layer
            const chunks = layerPath.split('.');
            const attrName = chunks.map((chunk) => `#${chunk}`.replaceAll(this.#pathCleanerRegex, '')).join('.');
            const expressionNames: Record<string, string> = {};
            chunks.forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                expressionNames[`#${cleanedChunk}`.replaceAll(this.#pathCleanerRegex, '')] = cleanedChunk;
            });
            // Issue update to set layer to {} if not exists
            const layerUpsertRes = await this.#ddbClient.update(this.#tableName,
                            { key, namespace },
                            `SET ${attrName} = if_not_exists(${attrName}, :emptyMap)`,
                            { ':emptyMap': {} },
                            expressionNames);
            writeUnits += layerUpsertRes.ConsumedCapacity?.CapacityUnits ?? 0;
        }
        return writeUnits;
    }

    // Ideally the paths support syntax like "a.b[2].c"
    async incr<T extends Record<string, number>>({ key, pathAndAmountMap }: { key: string; pathAndAmountMap: T; }): Promise<T extends { '': number; } ? number : RecursiveRecord<number>> {
        if ( Object.values(pathAndAmountMap).find((v) => typeof v !== 'number') ) {
            throw new Error('All values in pathAndAmountMap must be numbers');
        }
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
        }

        if ( ! pathAndAmountMap ) {
            throw new Error('invalid use of #incr: no pathAndAmountMap');
        }

        const actor = Context.get('actor');

        const user = actor.type?.user ?? undefined;
        if ( ! user ) throw new Error('User not found');

        const namespace = this.#getNameSpace(actor);

        if ( this.#enableMigrationFromSQL ) {
            // trigger get to move element if exists
            await this.get({ key });
        }

        const cleanerRegex = /[:\-+/*]/g;

        let writeUnits = await this.#createPaths(namespace, key, Object.keys(pathAndAmountMap));

        const setStatements = Object.entries(pathAndAmountMap).map(([valPath, _amt], idx) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            const attrName = path.split('.').map((chunk) => `#${chunk}`.replaceAll(cleanerRegex, '')).join('.');
            return `${attrName} = if_not_exists(${attrName}, :start${idx}) + :incr${idx}`;
        });
        const valueAttributeValues = Object.entries(pathAndAmountMap).reduce((acc, [_path, amt], idx) => {
            acc[`:incr${idx}`] = amt;
            acc[`:start${idx}`] = 0;
            return acc;
        }, {} as Record<string, number>);
        const valueAttributeNames = Object.entries(pathAndAmountMap).reduce((acc, [valPath, _amt]) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            path.split('.').forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                acc[`#${cleanedChunk}`.replaceAll(cleanerRegex, '')] = cleanedChunk;
            });
            return acc;
        }, {} as Record<string, string>);

        const res = await this.#ddbClient.update(this.#tableName,
                        { key, namespace },
                        `SET ${[...setStatements].join(', ')}`,
                        valueAttributeValues,
                        { ...valueAttributeNames, '#value': 'value' });

        writeUnits += res.ConsumedCapacity?.CapacityUnits ?? 0;
        this.#meteringService.incrementUsage(actor, 'kv:write', writeUnits);
        return res.Attributes?.value;
    }

    async decr<T extends Record<string, number>>({ key, pathAndAmountMap }: { key: string; pathAndAmountMap: T; }) {
        return await this.incr({ key, pathAndAmountMap: Object.fromEntries(Object.entries(pathAndAmountMap).map(([k, v]) => [k, -v])) as T });
    }

    async #expireAt (key: string, timestamp: number) {

        const actor = Context.get('actor');

        const user = actor.type?.user ?? undefined;
        if ( ! user ) throw new Error('User not found');

        const namespace = this.#getNameSpace(actor);

        // if possibly migrating from old SQL store, get entry first to move to dynamo
        if ( this.#enableMigrationFromSQL ) {
            await this.get({ key });
        }

        const res = await this.#ddbClient.update(this.#tableName,
                        { key, namespace },
                        'SET #ttl = :ttl, #value = if_not_exists(#value, :defaultValue)',
                        { ':ttl': timestamp, ':defaultValue': null },
                        { '#ttl': 'ttl', '#value': 'value' });

        // meter usage
        this.#meteringService.incrementUsage(actor, 'kv:write', res?.ConsumedCapacity?.CapacityUnits ?? 1);
    }

}
