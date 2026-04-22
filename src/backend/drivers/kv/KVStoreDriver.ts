import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';

/**
 * KV store driver implementing the `puter-kvstore` interface.
 *
 * Provides per-user, per-app key-value storage backed by DynamoDB. Keys are
 * namespaced as `v1:{userId}:{appUuid}` (app-scoped) or `v1:{userId}:global`
 * (user-scoped) to prevent cross-user/app data leakage.
 *
 * Actor/context is read from the ALS-backed Context API — no drilled params.
 * Input validation is done imperatively in each method.
 */

const KV_TABLE = 'store-kv-v1';

export class KVStoreDriver extends PuterDriver {
    readonly driverInterface = 'puter-kvstore';
    readonly driverName = 'puter-kvstore';
    readonly isDefault = true;

    #namespace(actor: Actor | undefined, appUuidOverride?: string): string {
        if (!actor || actor.system || !actor.user?.uuid) {
            return 'v1:system';
        }
        const app = appUuidOverride ?? actor.app?.uid ?? 'global';
        return `v1:${actor.user.uuid}:${app}`;
    }

    #coerceKey(key: unknown): string {
        if (key === null || key === undefined) {
            throw new HttpError(400, 'Missing `key`');
        }
        const str = typeof key === 'string' ? key : String(key);
        if (str === '') {
            throw new HttpError(400, 'Missing `key`');
        }
        return str;
    }

    #key(namespace: string, key: string): Record<string, unknown> {
        return { namespace, key };
    }

    #meter(
        actor: Actor | undefined,
        kind: 'kv:read' | 'kv:write',
        n = 1,
    ): void {
        if (!actor || !n) return;
        void this.services.metering
            .incrementUsage(actor, kind, n)
            .catch((e) => {
                console.warn(
                    `[kv] metering ${kind} failed:`,
                    (e as Error).message,
                );
            });
    }

    async get(args: {
        key: unknown;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const { key, optConfig } = args;
        if (key === undefined || key === null) {
            throw new HttpError(400, 'Missing `key`');
        }

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);

        if (Array.isArray(key)) {
            if (key.length === 0) return [];
            const coerced = key.map((k) => this.#coerceKey(k));
            const items = coerced.map((k) => ({
                table: KV_TABLE,
                items: this.#key(ns, k),
            }));
            const result = await this.clients.dynamo.batchGet(items);
            this.#meter(actor, 'kv:read', coerced.length);
            const responses = result?.Responses?.[KV_TABLE] ?? [];
            return coerced.map((k) => {
                const row = responses.find(
                    (r: Record<string, unknown>) => r.key === k,
                );
                return row?.value ?? null;
            });
        }

        const coerced = this.#coerceKey(key);
        const result = await this.clients.dynamo.get(
            KV_TABLE,
            this.#key(ns, coerced),
        );
        this.#meter(actor, 'kv:read');
        return result?.Item?.value ?? null;
    }

    async set(args: {
        key: unknown;
        value: unknown;
        expireAt?: number;
        optConfig?: { appUuid?: string };
    }): Promise<boolean> {
        const { key, value, expireAt, optConfig } = args;
        const coerced = this.#coerceKey(key);
        if (value === undefined) throw new HttpError(400, 'Missing `value`');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        const item: Record<string, unknown> = {
            namespace: ns,
            key: coerced,
            value,
        };
        if (expireAt !== undefined) item.ttl = expireAt;

        await this.clients.dynamo.put(KV_TABLE, item);
        this.#meter(actor, 'kv:write');
        return true;
    }

    async batchPut(args: {
        items: Array<{ key: string; value: unknown; expireAt?: number }>;
        optConfig?: { appUuid?: string };
    }): Promise<boolean> {
        const { items, optConfig } = args;
        if (!Array.isArray(items) || items.length === 0)
            throw new HttpError(400, 'Missing or empty `items`');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        const puts = items.map((item) => {
            const coerced = this.#coerceKey(item.key);
            const row: Record<string, unknown> = {
                namespace: ns,
                key: coerced,
                value: item.value,
            };
            if (item.expireAt !== undefined) row.ttl = item.expireAt;
            return { table: KV_TABLE, item: row };
        });

        await this.clients.dynamo.batchPut(puts);
        this.#meter(actor, 'kv:write', items.length);
        return true;
    }

    async del(args: {
        key: unknown;
        optConfig?: { appUuid?: string };
    }): Promise<boolean> {
        const { key, optConfig } = args;
        const coerced = this.#coerceKey(key);

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        await this.clients.dynamo.del(KV_TABLE, this.#key(ns, coerced));
        this.#meter(actor, 'kv:write');
        return true;
    }

    async list(args: {
        as?: 'entries' | 'keys' | 'values';
        limit?: number;
        cursor?: string | Record<string, unknown>;
        pattern?: string;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const { as = 'entries', limit = 0, cursor, pattern, optConfig } = args;
        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);

        const opts = pattern
            ? { beginsWith: { key: 'key', value: pattern } }
            : undefined;

        const result = await this.clients.dynamo.query(
            KV_TABLE,
            { namespace: ns },
            limit,
            cursor as Record<string, unknown> | undefined,
            '', // index
            false, // consistentRead
            opts,
        );
        const items = (result?.Items ?? []) as Array<Record<string, unknown>>;
        this.#meter(actor, 'kv:read', Math.max(1, items.length));

        switch (as) {
            case 'keys':
                return items.map((r) => r.key);
            case 'values':
                return items.map((r) => r.value);
            case 'entries':
            default:
                return items.map((r) => ({ key: r.key, value: r.value }));
        }
    }

    async flush(args: { optConfig?: { appUuid?: string } }): Promise<boolean> {
        const actor = Context.get('actor');
        const ns = this.#namespace(actor, args.optConfig?.appUuid);
        const result = await this.clients.dynamo.query(
            KV_TABLE,
            { namespace: ns },
            0,
        );
        const items = (result?.Items ?? []) as Array<Record<string, unknown>>;

        for (const item of items) {
            await this.clients.dynamo.del(KV_TABLE, {
                namespace: ns,
                key: item.key,
            });
        }
        this.#meter(actor, 'kv:write', items.length);
        return true;
    }

    async #applyDelta(
        args: {
            key: unknown;
            pathAndAmountMap: Record<string, number>;
            optConfig?: { appUuid?: string };
        },
        sign: 1 | -1,
    ): Promise<unknown> {
        const { key, pathAndAmountMap, optConfig } = args;
        const coerced = this.#coerceKey(key);
        if (!pathAndAmountMap || typeof pathAndAmountMap !== 'object') {
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`');
        }

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);

        const hasNestedPath = Object.keys(pathAndAmountMap).some(
            (p) => p.length > 0,
        );
        if (hasNestedPath) {
            try {
                await this.clients.dynamo.update(
                    KV_TABLE,
                    this.#key(ns, coerced),
                    'SET #value = if_not_exists(#value, :empty)',
                    { ':empty': {} },
                    { '#value': 'value' },
                );
            } catch {
                // A ConditionalCheckFailed or similar is fine — the
                // subsequent SET will surface the real error if there
                // genuinely is one.
            }
        }

        const cleanerRegex = /[:\-+/*]/g;
        const setParts: string[] = [];
        const exprValues: Record<string, unknown> = {};
        const exprNames: Record<string, string> = { '#value': 'value' };
        let i = 0;
        for (const [valPath, amount] of Object.entries(pathAndAmountMap)) {
            if (typeof amount !== 'number') {
                throw new HttpError(
                    400,
                    `Amount for '${valPath}' must be a number`,
                );
            }
            const chunks = ['value', ...valPath.split('.')].filter(Boolean);
            const refSegments = chunks.map((chunk) => {
                const cleaned = chunk.split(/\[\d*\]/g)[0];
                const token = `#${cleaned.replace(cleanerRegex, '')}`;
                exprNames[token] = cleaned;
                return token;
            });
            const attrRef = refSegments.join('.');
            setParts.push(
                `${attrRef} = if_not_exists(${attrRef}, :start${i}) + :incr${i}`,
            );
            exprValues[`:incr${i}`] = amount * sign;
            exprValues[`:start${i}`] = 0;
            i++;
        }

        const result = await this.clients.dynamo.update(
            KV_TABLE,
            this.#key(ns, coerced),
            `SET ${setParts.join(', ')}`,
            exprValues,
            exprNames,
        );
        this.#meter(actor, 'kv:write');

        const attrs = (result?.Attributes ?? {}) as Record<string, unknown>;
        return attrs.value ?? 0;
    }

    async incr(args: {
        key: unknown;
        pathAndAmountMap: Record<string, number>;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        return this.#applyDelta(args, 1);
    }

    async decr(args: {
        key: unknown;
        pathAndAmountMap: Record<string, number>;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        return this.#applyDelta(args, -1);
    }

    async expireAt(args: {
        key: unknown;
        timestamp: number;
        optConfig?: { appUuid?: string };
    }): Promise<void> {
        const { key, timestamp, optConfig } = args;
        const coerced = this.#coerceKey(key);
        if (typeof timestamp !== 'number')
            throw new HttpError(400, '`timestamp` must be a number');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        await this.clients.dynamo.update(
            KV_TABLE,
            this.#key(ns, coerced),
            'SET #ttl = :ttl',
            { ':ttl': timestamp },
            { '#ttl': 'ttl' },
        );
        this.#meter(actor, 'kv:write');
    }

    async expire(args: {
        key: unknown;
        ttl: number;
        optConfig?: { appUuid?: string };
    }): Promise<void> {
        const { key, ttl, optConfig } = args;
        this.#coerceKey(key);
        if (typeof ttl !== 'number')
            throw new HttpError(400, '`ttl` must be a number (seconds)');

        const timestamp = Math.floor(Date.now() / 1000) + ttl;
        await this.expireAt({ key, timestamp, optConfig });
    }
}
