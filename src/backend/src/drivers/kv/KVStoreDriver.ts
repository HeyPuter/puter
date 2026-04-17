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

    // ── Namespace helpers ────────────────────────────────────────────

    #namespace (actor: Actor | undefined, appUuid?: string): string {
        if ( !actor || !actor.user?.id ) {
            return 'v1:system';
        }
        const app = appUuid ?? actor.app?.uid ?? 'global';
        return `v1:${actor.user.id}:${app}`;
    }

    #key (namespace: string, key: string): Record<string, unknown> {
        return { namespace, key };
    }


    // ── Interface methods ───────────────────────────────────────────

    async get (
        args: { key: string | string[]; optConfig?: { appUuid?: string } },
    ): Promise<unknown> {
        const { key, optConfig } = args;
        if ( ! key ) throw new HttpError(400, 'Missing `key`');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);

        if ( Array.isArray(key) ) {
            if ( key.length === 0 ) return [];
            const items = key.map(k => ({ table: KV_TABLE, items: this.#key(ns, k) }));
            const result = await this.clients.dynamo.batchGet(items);
            const responses = result?.Responses?.[KV_TABLE] ?? [];
            return key.map(k => {
                const row = responses.find((r: Record<string, unknown>) => r.key === k);
                return row?.value ?? null;
            });
        }

        const result = await this.clients.dynamo.get(KV_TABLE, this.#key(ns, key));
        return result?.Item?.value ?? null;
    }

    async set (
        args: { key: string; value: unknown; expireAt?: number; optConfig?: { appUuid?: string } },
    ): Promise<boolean> {
        const { key, value, expireAt, optConfig } = args;
        if ( !key || typeof key !== 'string' ) throw new HttpError(400, 'Missing or invalid `key`');
        if ( value === undefined ) throw new HttpError(400, 'Missing `value`');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        const item: Record<string, unknown> = { namespace: ns, key, value };
        if ( expireAt !== undefined ) item.ttl = expireAt;

        await this.clients.dynamo.put(KV_TABLE, item);
        return true;
    }

    async batchPut (
        args: { items: Array<{ key: string; value: unknown; expireAt?: number }>; optConfig?: { appUuid?: string } },
    ): Promise<boolean> {
        const { items, optConfig } = args;
        if ( !Array.isArray(items) || items.length === 0 ) throw new HttpError(400, 'Missing or empty `items`');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        const puts = items.map(item => {
            if ( !item.key || typeof item.key !== 'string' ) throw new HttpError(400, 'Each item must have a string `key`');
            const row: Record<string, unknown> = { namespace: ns, key: item.key, value: item.value };
            if ( item.expireAt !== undefined ) row.ttl = item.expireAt;
            return { table: KV_TABLE, item: row };
        });

        await this.clients.dynamo.batchPut(puts);
        return true;
    }

    async del (
        args: { key: string; optConfig?: { appUuid?: string } },
    ): Promise<boolean> {
        const { key, optConfig } = args;
        if ( !key || typeof key !== 'string' ) throw new HttpError(400, 'Missing or invalid `key`');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        await this.clients.dynamo.del(KV_TABLE, this.#key(ns, key));
        return true;
    }

    async list (
        args: {
            as?: 'entries' | 'keys' | 'values';
            limit?: number;
            cursor?: string | Record<string, unknown>;
            pattern?: string;
            optConfig?: { appUuid?: string };
        },
    ): Promise<unknown> {
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

        switch ( as ) {
            case 'keys':
                return items.map(r => r.key);
            case 'values':
                return items.map(r => r.value);
            case 'entries':
            default:
                return items.map(r => ({ key: r.key, value: r.value }));
        }
    }

    async flush (
        args: { optConfig?: { appUuid?: string } },
    ): Promise<boolean> {
        const actor = Context.get('actor');
        const ns = this.#namespace(actor, args.optConfig?.appUuid);
        const result = await this.clients.dynamo.query(KV_TABLE, { namespace: ns }, 0);
        const items = (result?.Items ?? []) as Array<Record<string, unknown>>;

        for ( const item of items ) {
            await this.clients.dynamo.del(KV_TABLE, { namespace: ns, key: item.key });
        }
        return true;
    }

    async incr (
        args: { key: string; pathAndAmountMap: Record<string, number>; optConfig?: { appUuid?: string } },
    ): Promise<unknown> {
        const { key, pathAndAmountMap, optConfig } = args;
        if ( !key || typeof key !== 'string' ) throw new HttpError(400, 'Missing or invalid `key`');
        if ( !pathAndAmountMap || typeof pathAndAmountMap !== 'object' ) {
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`');
        }

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);

        // Build DynamoDB SET expression for atomic add
        const setParts: string[] = [];
        const exprValues: Record<string, unknown> = {};
        const exprNames: Record<string, string> = {};
        let i = 0;
        for ( const [path, amount] of Object.entries(pathAndAmountMap) ) {
            if ( typeof amount !== 'number' ) throw new HttpError(400, `Amount for '${path}' must be a number`);
            const valKey = `:amt${i}`;
            const nameKey = `#f${i}`;
            setParts.push(`${nameKey} = if_not_exists(${nameKey}, :zero) + ${valKey}`);
            exprValues[valKey] = amount;
            exprNames[nameKey] = path;
            i++;
        }
        exprValues[':zero'] = 0;

        const result = await this.clients.dynamo.update(
            KV_TABLE,
            this.#key(ns, key),
            `SET ${setParts.join(', ')}`,
            exprValues,
            exprNames,
        );
        return result?.Attributes ?? {};
    }

    async expireAt (
        args: { key: string; timestamp: number; optConfig?: { appUuid?: string } },
    ): Promise<void> {
        const { key, timestamp, optConfig } = args;
        if ( !key || typeof key !== 'string' ) throw new HttpError(400, 'Missing or invalid `key`');
        if ( typeof timestamp !== 'number' ) throw new HttpError(400, '`timestamp` must be a number');

        const actor = Context.get('actor');
        const ns = this.#namespace(actor, optConfig?.appUuid);
        await this.clients.dynamo.update(
            KV_TABLE,
            this.#key(ns, key),
            'SET #ttl = :ttl',
            { ':ttl': timestamp },
            { '#ttl': 'ttl' },
        );
    }

    async expire (
        args: { key: string; ttl: number; optConfig?: { appUuid?: string } },
    ): Promise<void> {
        const { key, ttl, optConfig } = args;
        if ( !key || typeof key !== 'string' ) throw new HttpError(400, 'Missing or invalid `key`');
        if ( typeof ttl !== 'number' ) throw new HttpError(400, '`ttl` must be a number (seconds)');

        const timestamp = Math.floor(Date.now() / 1000) + ttl;
        await this.expireAt({ key, timestamp, optConfig });
    }
}
