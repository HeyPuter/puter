import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { KVUsage } from '../../stores/systemKv/SystemKVStore.js';

/**
 * KV store driver implementing the `puter-kvstore` interface.
 *
 * Thin wrapper around `stores.kv` (SystemKVStore): it validates/coerces
 * request inputs into HTTP-friendly errors, passes the request actor through
 * so the store scopes data to the correct namespace, and meters the
 * DynamoDB capacity the store reports back.
 */
export class KVStoreDriver extends PuterDriver {
    readonly driverInterface = 'puter-kvstore';
    readonly driverName = 'puter-kvstore';
    readonly isDefault = true;

    #coerceKey(key: unknown): string {
        if (key === null || key === undefined) {
            throw new HttpError(400, 'Missing `key`');
        }
        const str = typeof key === 'string' ? key : String(key);
        if (str === '') throw new HttpError(400, 'Missing `key`');
        return str;
    }

    #opts(appUuid?: string): { actor: Actor | undefined; appUuid?: string } {
        return { actor: Context.get('actor') as Actor | undefined, appUuid };
    }

    #meter(actor: Actor | undefined, usage: KVUsage): void {
        if (!actor) return;
        const metering = this.services.metering;
        if (usage.read > 0) {
            void metering
                .incrementUsage(actor, 'kv:read', usage.read)
                .catch((e) =>
                    console.warn(
                        '[kv] metering kv:read failed:',
                        (e as Error).message,
                    ),
                );
        }
        if (usage.write > 0) {
            void metering
                .incrementUsage(actor, 'kv:write', usage.write)
                .catch((e) =>
                    console.warn(
                        '[kv] metering kv:write failed:',
                        (e as Error).message,
                    ),
                );
        }
    }

    async get(args: {
        key: unknown;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const { key, optConfig } = args;
        if (key === undefined || key === null) {
            throw new HttpError(400, 'Missing `key`');
        }

        const opts = this.#opts(optConfig?.appUuid);

        if (Array.isArray(key)) {
            if (key.length === 0) return [];
            const coerced = key.map((k) => this.#coerceKey(k));
            const { res, usage } = await this.stores.kv.get(
                { key: coerced },
                opts,
            );
            this.#meter(opts.actor, usage);
            return res;
        }

        const { res, usage } = await this.stores.kv.get(
            { key: this.#coerceKey(key) },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
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

        const opts = this.#opts(optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.set(
            { key: coerced, value, expireAt },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async batchPut(args: {
        items: Array<{ key: string; value: unknown; expireAt?: number }>;
        optConfig?: { appUuid?: string };
    }): Promise<boolean> {
        const { items, optConfig } = args;
        if (!Array.isArray(items) || items.length === 0) {
            throw new HttpError(400, 'Missing or empty `items`');
        }

        const coerced = items.map((item) => ({
            key: this.#coerceKey(item.key),
            value: item.value,
            expireAt: item.expireAt,
        }));

        const opts = this.#opts(optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.batchPut(
            { items: coerced },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async del(args: {
        key: unknown;
        optConfig?: { appUuid?: string };
    }): Promise<boolean> {
        const coerced = this.#coerceKey(args.key);
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.del({ key: coerced }, opts);
        this.#meter(opts.actor, usage);
        return res;
    }

    async list(args: {
        as?: 'entries' | 'keys' | 'values';
        limit?: number;
        cursor?: string | Record<string, unknown>;
        pattern?: string;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.list(
            {
                as: args.as,
                limit: args.limit,
                cursor: args.cursor,
                pattern: args.pattern,
            },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async flush(args: { optConfig?: { appUuid?: string } }): Promise<boolean> {
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.flush(opts);
        this.#meter(opts.actor, usage);
        return res;
    }

    async incr(args: {
        key: unknown;
        pathAndAmountMap: Record<string, number>;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key);
        if (
            !args.pathAndAmountMap ||
            typeof args.pathAndAmountMap !== 'object'
        ) {
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`');
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.incr(
            { key: coerced, pathAndAmountMap: args.pathAndAmountMap },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async decr(args: {
        key: unknown;
        pathAndAmountMap: Record<string, number>;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key);
        if (
            !args.pathAndAmountMap ||
            typeof args.pathAndAmountMap !== 'object'
        ) {
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`');
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.decr(
            { key: coerced, pathAndAmountMap: args.pathAndAmountMap },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async expireAt(args: {
        key: unknown;
        timestamp: number;
        optConfig?: { appUuid?: string };
    }): Promise<void> {
        const coerced = this.#coerceKey(args.key);
        if (typeof args.timestamp !== 'number') {
            throw new HttpError(400, '`timestamp` must be a number');
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { usage } = await this.stores.kv.expireAt(
            { key: coerced, timestamp: args.timestamp },
            opts,
        );
        this.#meter(opts.actor, usage);
    }

    async expire(args: {
        key: unknown;
        ttl: number;
        optConfig?: { appUuid?: string };
    }): Promise<void> {
        const coerced = this.#coerceKey(args.key);
        if (typeof args.ttl !== 'number') {
            throw new HttpError(400, '`ttl` must be a number (seconds)');
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { usage } = await this.stores.kv.expire(
            { key: coerced, ttl: args.ttl },
            opts,
        );
        this.#meter(opts.actor, usage);
    }
}
