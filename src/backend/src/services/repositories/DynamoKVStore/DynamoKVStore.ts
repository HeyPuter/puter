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
    }

    async createTableIfNotExists () {
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

    #encodeCursor (pageKey?: Record<string, unknown>) {
        if ( !pageKey || Object.keys(pageKey).length === 0 ) {
            return undefined;
        }
        return Buffer.from(JSON.stringify(pageKey)).toString('base64');
    }

    #decodeCursor (cursor?: string | Record<string, unknown>) {
        if ( ! cursor ) {
            return undefined;
        }
        if ( typeof cursor === 'object' ) {
            return cursor;
        }
        if ( typeof cursor !== 'string' ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'cursor',
            });
        }
        const trimmed = cursor.trim();
        if ( trimmed === '' ) {
            return undefined;
        }
        try {
            const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
            return JSON.parse(decoded);
        } catch ( e ) {
            try {
                return JSON.parse(trimmed);
            } catch ( err ) {
                throw APIError.create('field_invalid', undefined, {
                    key: 'cursor',
                });
            }
        }
    }

    #normalizeLimit (limit?: number) {
        if ( limit === undefined || limit === null ) {
            return undefined;
        }
        const parsed = Number(limit);
        if ( !Number.isFinite(parsed) || parsed <= 0 ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'limit',
                expected: 'positive number',
            });
        }
        return Math.floor(parsed);
    }

    #normalizePattern (pattern?: string) {
        if ( pattern === undefined || pattern === null ) {
            return undefined;
        }
        if ( typeof pattern !== 'string' ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'pattern',
            });
        }
        const trimmed = pattern.trim();
        if ( trimmed === '' ) {
            return undefined;
        }
        if ( trimmed.endsWith('*') ) {
            const prefix = trimmed.slice(0, -1);
            return prefix === '' ? undefined : prefix;
        }
        return trimmed;
    }

    async list ({
        as,
        limit,
        cursor,
        pattern,
    }: {
        as?: 'keys' | 'values' | 'entries';
        limit?: number;
        cursor?: string | Record<string, unknown>;
        pattern?: string;
    }): Promise<
        | string[]
        | unknown[]
        | { key: string; value: unknown; }[]
        | { items: string[]; cursor?: string; }
        | { items: unknown[]; cursor?: string; }
        | { items: { key: string; value: unknown; }[]; cursor?: string; }
    > {
        const actor = Context.get('actor');

        const app = actor.type?.app ?? undefined;
        const user = actor.type?.user ?? undefined;
        if ( ! user ) throw new Error('User not found');

        const namespace = this.#getNameSpace(actor);

        const normalizedLimit = this.#normalizeLimit(limit);
        const pageKey = this.#decodeCursor(cursor);
        const normalizedPattern = this.#normalizePattern(pattern);
        const paginated = normalizedLimit !== undefined || pageKey !== undefined;

        const entriesRes = await this.#ddbClient.query(this.#tableName,
                        { namespace },
                        normalizedLimit ?? 0,
                        pageKey,
                        '',
                        false,
                        normalizedPattern ? { beginsWith: { key: 'key', value: normalizedPattern } } : undefined);

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

        if ( this.#enableMigrationFromSQL && !paginated ) {
            const oldEntries =  await this.#sqlClient.read('SELECT * FROM kv WHERE user_id=? AND app=?',
                            [user.id, app?.uid ?? DynamoKVStore.LEGACY_GLOBAL_APP_KEY]);
            oldEntries.forEach(oldEntry => {
                if ( normalizedPattern && !oldEntry.kkey?.startsWith(normalizedPattern) ) {
                    return;
                }
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

        let items: string[] | unknown[] | { key: string; value: unknown; }[] = entries;
        if ( as === 'keys' ) items = entries.map(entry => entry.key);
        else if ( as === 'values' ) items = entries.map(entry => entry.value);

        if ( paginated ) {
            const nextCursor = this.#encodeCursor(entriesRes.LastEvaluatedKey as Record<string, unknown> | undefined);
            if ( nextCursor ) {
                return { items, cursor: nextCursor };
            }
            return { items };
        }

        return items;
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

        const nestedMapValue = (() => {
            const valueRoot: Record<string, unknown> = {};
            let hasPaths = false;
            pathList.forEach((valPath) => {
                if ( ! valPath ) return;
                hasPaths = true;
                const chunks = valPath.split('.').filter(Boolean);
                let cursor: Record<string, unknown> = valueRoot;
                for ( let i = 0; i < chunks.length - 1; i++ ) {
                    const chunk = chunks[i];
                    const existing = cursor[chunk];
                    if ( !existing || typeof existing !== 'object' || Array.isArray(existing) ) {
                        cursor[chunk] = {};
                    }
                    cursor = cursor[chunk] as Record<string, unknown>;
                }
            });
            return hasPaths ? valueRoot : null;
        })();

        if ( ! nestedMapValue ) {
            return 0;
        }

        const isPlainObject = (value: unknown): value is Record<string, unknown> => {
            return !!value && typeof value === 'object' && !Array.isArray(value);
        };

        const objectsEqual = (left: unknown, right: unknown): boolean => {
            if ( left === right ) return true;
            if ( !isPlainObject(left) || !isPlainObject(right) ) return false;
            const leftKeys = Object.keys(left);
            const rightKeys = Object.keys(right);
            if ( leftKeys.length !== rightKeys.length ) return false;
            for ( const key of leftKeys ) {
                if ( ! rightKeys.includes(key) ) return false;
                if ( ! objectsEqual(left[key], right[key]) ) return false;
            }
            return true;
        };

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

        let writeUnits = 0;
        // Ensure each intermediate map layer exists by issuing a separate DynamoDB update for each
        const orderedPaths = [...allIntermediatePaths]
            .sort((left, right) => left.split('.').length - right.split('.').length);
        for ( const layerPath of orderedPaths ) {
            // Build attribute names for the layer
            const chunks = layerPath.split('.');
            const attrName = chunks.map((chunk) => `#${chunk}`.replaceAll(this.#pathCleanerRegex, '')).join('.');
            const expressionNames: Record<string, string> = {};
            chunks.forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                expressionNames[`#${cleanedChunk}`.replaceAll(this.#pathCleanerRegex, '')] = cleanedChunk;
            });
            const isRootLayer = layerPath === 'value';
            const expressionValues = isRootLayer
                ? { ':nestedMap': nestedMapValue }
                : { ':emptyMap': {} };
            const valueToken = isRootLayer ? ':nestedMap' : ':emptyMap';
            // Issue update to set layer to {} if not exists
            const layerUpsertRes = await this.#ddbClient.update(this.#tableName,
                            { key, namespace },
                            `SET ${attrName} = if_not_exists(${attrName}, ${valueToken})`,
                            expressionValues,
                            expressionNames);
            writeUnits += layerUpsertRes.ConsumedCapacity?.CapacityUnits ?? 0;
            if ( isRootLayer && objectsEqual(layerUpsertRes.Attributes?.value, nestedMapValue) ) {
                return writeUnits;
            }
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

    async add ({ key, pathAndValueMap }: { key: string; pathAndValueMap: Record<string, unknown>; }): Promise<unknown> {
        if ( !pathAndValueMap || Object.keys(pathAndValueMap).length === 0 ) {
            throw new Error('invalid use of #add: no pathAndValueMap');
        }
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
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

        let writeUnits = await this.#createPaths(namespace, key, Object.keys(pathAndValueMap));

        const setStatements = Object.entries(pathAndValueMap).map(([valPath, _val], idx) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            const attrName = path.split('.').map((chunk) => `#${chunk}`.replaceAll(cleanerRegex, '')).join('.');
            return `${attrName} = list_append(if_not_exists(${attrName}, :emptyList${idx}), :append${idx})`;
        });
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce((acc, [_path, val], idx) => {
            acc[`:append${idx}`] = Array.isArray(val) ? val : [val];
            acc[`:emptyList${idx}`] = [];
            return acc;
        }, {} as Record<string, unknown>);
        const valueAttributeNames = Object.entries(pathAndValueMap).reduce((acc, [valPath, _val]) => {
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

    async remove ({ key, paths }: { key: string; paths: string[]; }): Promise<unknown> {
        if ( !paths || paths.length === 0 ) {
            throw new Error('invalid use of #remove: no paths');
        }
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
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

        const removeStatements = paths.map((valPath) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            return path.split('.').map((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                const indexSuffix = chunk.slice(cleanedChunk.length);
                return `${`#${cleanedChunk}`.replaceAll(cleanerRegex, '')}${indexSuffix}`;
            }).join('.');
        });

        const valueAttributeNames = paths.reduce((acc, valPath) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            path.split('.').forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                acc[`#${cleanedChunk}`.replaceAll(cleanerRegex, '')] = cleanedChunk;
            });
            return acc;
        }, {} as Record<string, string>);

        try {
            const res = await this.#ddbClient.update(this.#tableName,
                            { key, namespace },
                            `REMOVE ${removeStatements.join(', ')}`,
                            undefined,
                            { ...valueAttributeNames, '#value': 'value' });

            this.#meteringService.incrementUsage(actor, 'kv:write', res?.ConsumedCapacity?.CapacityUnits ?? 1);
            return res.Attributes?.value;
        } catch ( e ) {
            const message = (e as Error)?.message ?? '';
            if ( (e as Error)?.name === 'ValidationException' && /document path|invalid updateexpression/i.test(message) ) {
                this.#meteringService.incrementUsage(actor, 'kv:write', 1);
                return await this.get({ key });
            }
            throw e;
        }
    }

    async update ({ key, pathAndValueMap, ttl }: { key: string; pathAndValueMap: Record<string, unknown>; ttl?: number; }): Promise<unknown> {
        if ( !pathAndValueMap || Object.keys(pathAndValueMap).length === 0 ) {
            throw new Error('invalid use of #update: no pathAndValueMap');
        }
        if ( key === '' ) {
            throw APIError.create('field_empty', null, {
                key: 'key',
            });
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

        let writeUnits = await this.#createPaths(namespace, key, Object.keys(pathAndValueMap));

        const setStatements = Object.entries(pathAndValueMap).map(([valPath, _val], idx) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            const attrName = path.split('.').map((chunk) => `#${chunk}`.replaceAll(cleanerRegex, '')).join('.');
            return `${attrName} = :value${idx}`;
        });
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce((acc, [_path, val], idx) => {
            acc[`:value${idx}`] = val;
            return acc;
        }, {} as Record<string, unknown>);
        const valueAttributeNames = Object.entries(pathAndValueMap).reduce((acc, [valPath, _val]) => {
            const path = ['value', ...valPath.split('.')].filter(Boolean).join('.');
            path.split('.').forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                acc[`#${cleanedChunk}`.replaceAll(cleanerRegex, '')] = cleanedChunk;
            });
            return acc;
        }, {} as Record<string, string>);

        if ( ttl !== undefined ) {
            const ttlSeconds = Number(ttl);
            if ( Number.isNaN(ttlSeconds) ) {
                throw new Error('ttl must be a number');
            }
            const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
            setStatements.push('#ttl = :ttl');
            valueAttributeValues[':ttl'] = timestamp;
            valueAttributeNames['#ttl'] = 'ttl';
        }

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
