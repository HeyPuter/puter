import { PuterStore } from '../types';
import type { Actor } from '../../core/actor';
import { isSystemActor, SYSTEM_ACTOR } from '../../core/actor';
import { PUTER_KV_STORE_TABLE_DEFINITION } from './tableDefinition';

// ── Types ────────────────────────────────────────────────────────────

/** DynamoDB consumed-capacity units split by operation kind. */
export interface KVUsage {
    read: number;
    write: number;
}

/** Standard return envelope: `res` is the operation result, `usage` is the
 *  DynamoDB consumed capacity so callers can meter if they choose to. */
export interface KVResult<T> {
    res: T;
    usage: KVUsage;
}

export interface KVOpts {
    /** Optional actor — defaults to the system actor. */
    actor?: Actor;
    /** Optional app uuid override for non-app-scoped actors. */
    appUuid?: string;
}

export interface RecursiveRecord<T> {
    [k: string]: T | RecursiveRecord<T>;
}

// ── Helpers ──────────────────────────────────────────────────────────

const GLOBAL_APP_KEY = 'os-global';
const SYSTEM_NAMESPACE = 'v1:system';
const MAX_KEY_BYTES = 1024;
const BATCH_GET_CHUNK = 100;
const PATH_CLEANER_REGEX = /[:\-+/*]/g;

const emptyUsage = (): KVUsage => ({ read: 0, write: 0 });

const readUsage = (units: number | undefined): KVUsage => ({
    read: Number(units ?? 0),
    write: 0,
});

const writeUsage = (units: number | undefined): KVUsage => ({
    read: 0,
    write: Number(units ?? 0),
});

const addUsage = (a: KVUsage, b: KVUsage): KVUsage => ({
    read: a.read + b.read,
    write: a.write + b.write,
});

const ensureActor = (opts?: KVOpts): Actor => opts?.actor ?? SYSTEM_ACTOR;

const getNamespace = (actor: Actor, appUuidOverride?: string): string => {
    if (isSystemActor(actor)) return SYSTEM_NAMESPACE;
    const appUuid = actor.app?.uid ?? appUuidOverride ?? GLOBAL_APP_KEY;
    return `v1:${actor.user.uuid}:${appUuid}`;
};

const assertKey = (key: string): void => {
    if (key === '') throw new Error('kv: key is empty');
    if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
        throw new Error(`kv: key exceeds ${MAX_KEY_BYTES} byte limit`);
    }
};

const encodeCursor = (
    pageKey?: Record<string, unknown>,
): string | undefined => {
    if (!pageKey || Object.keys(pageKey).length === 0) return undefined;
    return Buffer.from(JSON.stringify(pageKey)).toString('base64');
};

const decodeCursor = (
    cursor?: string | Record<string, unknown>,
): Record<string, unknown> | undefined => {
    if (!cursor) return undefined;
    if (typeof cursor === 'object') return cursor;
    const trimmed = cursor.trim();
    if (trimmed === '') return undefined;
    try {
        return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
        try {
            return JSON.parse(trimmed);
        } catch {
            throw new Error('kv: invalid cursor');
        }
    }
};

const normalizeLimit = (limit?: number): number | undefined => {
    if (limit === undefined || limit === null) return undefined;
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('kv: limit must be a positive number');
    }
    return Math.floor(parsed);
};

const normalizePattern = (pattern?: string): string | undefined => {
    if (pattern === undefined || pattern === null) return undefined;
    if (typeof pattern !== 'string')
        throw new Error('kv: pattern must be a string');
    const trimmed = pattern.trim();
    if (trimmed === '') return undefined;
    if (trimmed.endsWith('*')) {
        const prefix = trimmed.slice(0, -1);
        return prefix === '' ? undefined : prefix;
    }
    return trimmed;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const objectsEqual = (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (!rightKeys.includes(key)) return false;
        if (!objectsEqual(left[key], right[key])) return false;
    }
    return true;
};

const cleanAttrName = (chunk: string): string =>
    `#${chunk}`.replaceAll(PATH_CLEANER_REGEX, '');

// ── SystemKVStore ────────────────────────────────────────────────────

/**
 * Underlying key-value store. Housed at the store layer so both services
 * (permissions, metering) and drivers (`puter-kvstore`) can share it.
 *
 * Every method returns `{ res, usage }` — `res` is the operation result,
 * `usage` is the DynamoDB consumed capacity split into read/write units so
 * callers can meter at the driver level when needed. No metering happens
 * inside the store itself.
 *
 * If `opts.actor` is omitted, operations are scoped to the system namespace.
 */
export class SystemKVStore extends PuterStore {
    private tableName = 'store-kv-v1';
    private initialized: Promise<void> | null = null;

    override async onServerStart(): Promise<void> {
        // For local/dynalite runs we need to create the table up front.
        // For real AWS we assume the table already exists.
        const ddbConfig = this.config.dynamo ?? {};
        if (ddbConfig.aws) return;

        this.initialized = this.clients.dynamo.createTableIfNotExists(
            { ...PUTER_KV_STORE_TABLE_DEFINITION, TableName: this.tableName },
            'ttl',
        );
        await this.initialized;
    }

    // ── Public API ───────────────────────────────────────────────────

    async get(
        { key }: { key: string | string[] },
        opts?: KVOpts,
    ): Promise<KVResult<unknown | null | (unknown | null)[]>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);
        const multi = Array.isArray(key);
        const keys = multi ? key : [key];

        for (const k of keys) assertKey(k);

        let kvEntries: Array<{ key: string; value?: unknown; ttl?: number }> =
            [];
        let usage = emptyUsage();

        if (multi) {
            const { entries, usage: u } = await this.getBatches(
                namespace,
                keys,
            );
            kvEntries = entries;
            usage = u;
        } else {
            const response = await this.clients.dynamo.get(this.tableName, {
                namespace,
                key,
            });
            kvEntries = response.Item
                ? [response.Item as (typeof kvEntries)[number]]
                : [];
            usage = readUsage(
                response.ConsumedCapacity?.CapacityUnits as number | undefined,
            );
        }

        const now = Date.now() / 1000;
        const values = keys.map((k) => {
            const entry = kvEntries.find((e) => e.key === k);
            if (!entry) return null;
            if (entry.ttl && entry.ttl <= now) return null;
            return entry.value ?? null;
        });

        return { res: multi ? values : values[0], usage };
    }

    async set(
        {
            key,
            value,
            expireAt,
        }: { key: string; value: unknown; expireAt?: number },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        assertKey(key);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const response = await this.clients.dynamo.put(this.tableName, {
            namespace,
            key,
            value,
            ttl: expireAt,
        });

        return {
            res: true,
            usage: writeUsage(
                response.ConsumedCapacity?.CapacityUnits as number | undefined,
            ),
        };
    }

    async batchPut(
        {
            items,
        }: { items: Array<{ key: string; value: unknown; expireAt?: number }> },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        if (!Array.isArray(items) || items.length === 0) {
            return { res: true, usage: emptyUsage() };
        }

        const byKey = new Map<
            string,
            { key: string; value: unknown; expireAt?: number }
        >();
        for (const item of items) {
            const k = String(item.key);
            assertKey(k);
            byKey.set(k, {
                key: k,
                value: item.value,
                expireAt: item.expireAt,
            });
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const putParams = Array.from(byKey.values()).map((item) => ({
            table: this.tableName,
            item: {
                namespace,
                key: item.key,
                value: item.value,
                ttl: item.expireAt,
            },
        }));

        const response = await this.clients.dynamo.batchPut(putParams);
        const units =
            response.ConsumedCapacity?.reduce(
                (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                0,
            ) ?? byKey.size;

        return { res: true, usage: writeUsage(units || byKey.size) };
    }

    async del(
        { key }: { key: string },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const response = await this.clients.dynamo.del(this.tableName, {
            namespace,
            key,
        });
        return {
            res: true,
            usage: writeUsage(
                (response.ConsumedCapacity?.CapacityUnits as
                    | number
                    | undefined) ?? 1,
            ),
        };
    }

    async list(
        {
            as,
            limit,
            cursor,
            pattern,
        }: {
            as?: 'keys' | 'values' | 'entries';
            limit?: number;
            cursor?: string | Record<string, unknown>;
            pattern?: string;
        },
        opts?: KVOpts,
    ): Promise<
        KVResult<
            | string[]
            | unknown[]
            | { key: string; value: unknown }[]
            | { items: string[]; cursor?: string }
            | { items: unknown[]; cursor?: string }
            | { items: { key: string; value: unknown }[]; cursor?: string }
        >
    > {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const normalizedLimit = normalizeLimit(limit);
        const pageKey = decodeCursor(cursor);
        const normalizedPattern = normalizePattern(pattern);
        const paginated =
            normalizedLimit !== undefined || pageKey !== undefined;

        const response = await this.clients.dynamo.query(
            this.tableName,
            { namespace },
            normalizedLimit ?? 0,
            pageKey,
            '',
            false,
            normalizedPattern
                ? { beginsWith: { key: 'key', value: normalizedPattern } }
                : undefined,
        );

        const usage = readUsage(
            (response.ConsumedCapacity?.CapacityUnits as number | undefined) ??
                1,
        );

        const now = Date.now() / 1000;
        const entries = (response.Items ?? [])
            .filter((e) => e && (!e.ttl || e.ttl > now))
            .map((e) => ({ key: e!.key as string, value: e!.value }));

        const kind = as ?? 'entries';
        if (!['keys', 'values', 'entries'].includes(kind)) {
            throw new Error('kv: list "as" must be keys, values, or entries');
        }

        let items: string[] | unknown[] | { key: string; value: unknown }[] =
            entries;
        if (kind === 'keys') items = entries.map((e) => e.key);
        else if (kind === 'values') items = entries.map((e) => e.value);

        if (paginated) {
            const nextCursor = encodeCursor(
                response.LastEvaluatedKey as
                    | Record<string, unknown>
                    | undefined,
            );
            return {
                res: nextCursor ? { items, cursor: nextCursor } : { items },
                usage,
            };
        }

        return { res: items, usage };
    }

    async flush(opts?: KVOpts): Promise<KVResult<boolean>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const response = await this.clients.dynamo.query(this.tableName, {
            namespace,
        });
        let usage = readUsage(
            response.ConsumedCapacity?.CapacityUnits as number | undefined,
        );

        const entries = response.Items ?? [];
        const results = (
            await Promise.all(
                entries.map(async (entry) => {
                    try {
                        return await this.clients.dynamo.del(this.tableName, {
                            namespace,
                            key: entry.key,
                        });
                    } catch (e) {
                        console.error('[kv] flush delete failed', entry.key, e);
                        return null;
                    }
                }),
            )
        ).filter(Boolean);

        const deleteUnits = results.reduce(
            (acc, r) => acc + Number(r?.ConsumedCapacity?.CapacityUnits ?? 0),
            0,
        );
        usage = addUsage(usage, writeUsage(deleteUnits));

        return { res: true, usage };
    }

    async expireAt(
        { key, timestamp }: { key: string; timestamp: number },
        opts?: KVOpts,
    ): Promise<KVResult<void>> {
        assertKey(key);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);
        const usage = await this.rawExpireAt(namespace, key, Number(timestamp));
        return { res: undefined, usage };
    }

    async expire(
        { key, ttl }: { key: string; ttl: number },
        opts?: KVOpts,
    ): Promise<KVResult<void>> {
        assertKey(key);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);
        const timestamp = Math.floor(Date.now() / 1000) + Number(ttl);
        const usage = await this.rawExpireAt(namespace, key, timestamp);
        return { res: undefined, usage };
    }

    async incr<T extends Record<string, number>>(
        { key, pathAndAmountMap }: { key: string; pathAndAmountMap: T },
        opts?: KVOpts,
    ): Promise<
        KVResult<T extends { '': number } ? number : RecursiveRecord<number>>
    > {
        assertKey(key);
        if (!pathAndAmountMap)
            throw new Error('kv: incr requires pathAndAmountMap');
        if (
            Object.values(pathAndAmountMap).some((v) => typeof v !== 'number')
        ) {
            throw new Error(
                'kv: all values in pathAndAmountMap must be numbers',
            );
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const createPathsUsage = await this.createPaths(
            namespace,
            key,
            Object.keys(pathAndAmountMap),
        );

        const setStatements = Object.entries(pathAndAmountMap).map(
            ([valPath, _amt], idx) => {
                const attrName = ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .map(cleanAttrName)
                    .join('.');
                return `${attrName} = if_not_exists(${attrName}, :start${idx}) + :incr${idx}`;
            },
        );
        const valueAttributeValues = Object.entries(pathAndAmountMap).reduce(
            (acc, [_path, amt], idx) => {
                acc[`:incr${idx}`] = amt;
                acc[`:start${idx}`] = 0;
                return acc;
            },
            {} as Record<string, number>,
        );
        const valueAttributeNames = Object.entries(pathAndAmountMap).reduce(
            (acc, [valPath]) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            `SET ${setStatements.join(', ')}`,
            valueAttributeValues,
            { ...valueAttributeNames, '#value': 'value' },
        );

        const usage = writeUsage(
            Number(response.ConsumedCapacity?.CapacityUnits ?? 0) +
                createPathsUsage,
        );

        return { res: response.Attributes?.value, usage };
    }

    async decr<T extends Record<string, number>>(
        { key, pathAndAmountMap }: { key: string; pathAndAmountMap: T },
        opts?: KVOpts,
    ): Promise<
        KVResult<T extends { '': number } ? number : RecursiveRecord<number>>
    > {
        const negated = Object.fromEntries(
            Object.entries(pathAndAmountMap).map(([k, v]) => [k, -v]),
        ) as T;
        return this.incr({ key, pathAndAmountMap: negated }, opts);
    }

    async add(
        {
            key,
            pathAndValueMap,
        }: { key: string; pathAndValueMap: Record<string, unknown> },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!pathAndValueMap || Object.keys(pathAndValueMap).length === 0) {
            throw new Error('kv: add requires pathAndValueMap');
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const createPathsUsage = await this.createPaths(
            namespace,
            key,
            Object.keys(pathAndValueMap),
        );

        const setStatements = Object.entries(pathAndValueMap).map(
            ([valPath], idx) => {
                const attrName = ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .map(cleanAttrName)
                    .join('.');
                return `${attrName} = list_append(if_not_exists(${attrName}, :emptyList${idx}), :append${idx})`;
            },
        );
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce(
            (acc, [_path, val], idx) => {
                acc[`:append${idx}`] = Array.isArray(val) ? val : [val];
                acc[`:emptyList${idx}`] = [];
                return acc;
            },
            {} as Record<string, unknown>,
        );
        const valueAttributeNames = Object.entries(pathAndValueMap).reduce(
            (acc, [valPath]) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            `SET ${setStatements.join(', ')}`,
            valueAttributeValues,
            { ...valueAttributeNames, '#value': 'value' },
        );

        const usage = writeUsage(
            Number(response.ConsumedCapacity?.CapacityUnits ?? 0) +
                createPathsUsage,
        );

        return { res: response.Attributes?.value, usage };
    }

    async remove(
        { key, paths }: { key: string; paths: string[] },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!paths || paths.length === 0) {
            throw new Error('kv: remove requires paths');
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const removeStatements = paths.map((valPath) => {
            return ['value', ...valPath.split('.')]
                .filter(Boolean)
                .map((chunk) => {
                    const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                    const indexSuffix = chunk.slice(cleanedChunk.length);
                    return `${cleanAttrName(cleanedChunk)}${indexSuffix}`;
                })
                .join('.');
        });
        const valueAttributeNames = paths.reduce(
            (acc, valPath) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        try {
            const response = await this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                `REMOVE ${removeStatements.join(', ')}`,
                undefined,
                { ...valueAttributeNames, '#value': 'value' },
            );
            return {
                res: response.Attributes?.value,
                usage: writeUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined) ?? 1,
                ),
            };
        } catch (e) {
            const err = e as Error;
            if (
                err?.name === 'ValidationException' &&
                /document path|invalid updateexpression/i.test(err.message)
            ) {
                // Path didn't exist — treat as no-op, return current value
                const fallback = await this.get({ key }, opts);
                return {
                    res: fallback.res,
                    usage: addUsage(fallback.usage, writeUsage(1)),
                };
            }
            throw e;
        }
    }

    async update(
        {
            key,
            pathAndValueMap,
            ttl,
        }: {
            key: string;
            pathAndValueMap: Record<string, unknown>;
            ttl?: number;
        },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!pathAndValueMap || Object.keys(pathAndValueMap).length === 0) {
            throw new Error('kv: update requires pathAndValueMap');
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts?.appUuid);

        const createPathsUsage = await this.createPaths(
            namespace,
            key,
            Object.keys(pathAndValueMap),
        );

        const setStatements = Object.entries(pathAndValueMap).map(
            ([valPath], idx) => {
                const attrName = ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .map(cleanAttrName)
                    .join('.');
                return `${attrName} = :value${idx}`;
            },
        );
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce(
            (acc, [_path, val], idx) => {
                acc[`:value${idx}`] = val;
                return acc;
            },
            {} as Record<string, unknown>,
        );
        const valueAttributeNames = Object.entries(pathAndValueMap).reduce(
            (acc, [valPath]) => {
                ['value', ...valPath.split('.')]
                    .filter(Boolean)
                    .forEach((chunk) => {
                        const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                        acc[cleanAttrName(cleanedChunk)] = cleanedChunk;
                    });
                return acc;
            },
            {} as Record<string, string>,
        );

        if (ttl !== undefined) {
            const ttlSeconds = Number(ttl);
            if (Number.isNaN(ttlSeconds))
                throw new Error('kv: ttl must be a number');
            const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
            setStatements.push('#ttl = :ttl');
            valueAttributeValues[':ttl'] = timestamp;
            valueAttributeNames['#ttl'] = 'ttl';
        }

        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            `SET ${setStatements.join(', ')}`,
            valueAttributeValues,
            { ...valueAttributeNames, '#value': 'value' },
        );

        const usage = writeUsage(
            Number(response.ConsumedCapacity?.CapacityUnits ?? 0) +
                createPathsUsage,
        );

        return { res: response.Attributes?.value, usage };
    }

    // ── Internals ────────────────────────────────────────────────────

    private async getBatches(
        namespace: string,
        allKeys: string[],
    ): Promise<{
        entries: Array<{ key: string; value?: unknown; ttl?: number }>;
        usage: KVUsage;
    }> {
        const batches: string[][] = [];
        for (let i = 0; i < allKeys.length; i += BATCH_GET_CHUNK) {
            batches.push(allKeys.slice(i, i + BATCH_GET_CHUNK));
        }

        const results = await Promise.all(
            batches.map(async (keys) => {
                const requests = [...new Set(keys)].map((k) => ({
                    table: this.tableName,
                    items: { namespace, key: k },
                }));
                const response = await this.clients.dynamo.batchGet(requests);
                const entries = (response.Responses?.[this.tableName] ??
                    []) as Array<{
                    key: string;
                    value?: unknown;
                    ttl?: number;
                }>;
                const units =
                    response.ConsumedCapacity?.reduce(
                        (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                        0,
                    ) ?? 0;
                return { entries, units };
            }),
        );

        return results.reduce(
            (acc, curr) => {
                acc.entries.push(...curr.entries);
                acc.usage.read += curr.units;
                return acc;
            },
            {
                entries: [] as Array<{
                    key: string;
                    value?: unknown;
                    ttl?: number;
                }>,
                usage: emptyUsage(),
            },
        );
    }

    private async rawExpireAt(
        namespace: string,
        key: string,
        timestamp: number,
    ): Promise<KVUsage> {
        const response = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            'SET #ttl = :ttl, #value = if_not_exists(#value, :defaultValue)',
            { ':ttl': timestamp, ':defaultValue': null },
            { '#ttl': 'ttl', '#value': 'value' },
        );
        return writeUsage(
            (response.ConsumedCapacity?.CapacityUnits as number | undefined) ??
                1,
        );
    }

    /**
     * Ensure each intermediate map layer exists for a set of nested paths.
     * Returns write units consumed. DDB can't set nested paths on missing
     * parents in one expression, so we walk the layers and
     * `SET ... if_not_exists(..., {})` each one.
     */
    private async createPaths(
        namespace: string,
        key: string,
        pathList: string[],
    ): Promise<number> {
        const nestedMapValue = (() => {
            const valueRoot: Record<string, unknown> = {};
            let hasPaths = false;
            pathList.forEach((valPath) => {
                if (!valPath) return;
                hasPaths = true;
                const chunks = valPath.split('.').filter(Boolean);
                let cursor: Record<string, unknown> = valueRoot;
                for (let i = 0; i < chunks.length - 1; i++) {
                    const chunk = chunks[i];
                    const existing = cursor[chunk];
                    if (
                        !existing ||
                        typeof existing !== 'object' ||
                        Array.isArray(existing)
                    ) {
                        cursor[chunk] = {};
                    }
                    cursor = cursor[chunk] as Record<string, unknown>;
                }
            });
            return hasPaths ? valueRoot : null;
        })();

        if (!nestedMapValue) return 0;

        const allIntermediatePaths = new Set<string>();
        pathList.forEach((valPath) => {
            const chunks = ['value', ...valPath.split('.')].filter(Boolean);
            for (let i = 1; i < chunks.length; i++) {
                allIntermediatePaths.add(chunks.slice(0, i).join('.'));
            }
        });

        let writeUnits = 0;
        const orderedPaths = [...allIntermediatePaths].sort(
            (left, right) => left.split('.').length - right.split('.').length,
        );

        for (const layerPath of orderedPaths) {
            const chunks = layerPath.split('.');
            const attrName = chunks.map(cleanAttrName).join('.');
            const expressionNames: Record<string, string> = {};
            chunks.forEach((chunk) => {
                const cleanedChunk = chunk.split(/\[\d*\]/g)[0];
                expressionNames[cleanAttrName(cleanedChunk)] = cleanedChunk;
            });
            const isRootLayer = layerPath === 'value';
            const expressionValues = isRootLayer
                ? { ':nestedMap': nestedMapValue }
                : { ':emptyMap': {} };
            const valueToken = isRootLayer ? ':nestedMap' : ':emptyMap';

            const response = await this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                `SET ${attrName} = if_not_exists(${attrName}, ${valueToken})`,
                expressionValues,
                expressionNames,
            );
            writeUnits += Number(response.ConsumedCapacity?.CapacityUnits ?? 0);

            if (
                isRootLayer &&
                objectsEqual(response.Attributes?.value, nestedMapValue)
            ) {
                return writeUnits;
            }
        }
        return writeUnits;
    }
}
