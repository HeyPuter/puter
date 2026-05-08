/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { KVUsage } from '../../stores/systemKv/SystemKVStore.js';
import { KV_COSTS } from './costs.js';

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

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(KV_COSTS).map(([usageType, ucentsPerUnit]) => ({
            usageType,
            ucentsPerUnit,
            unit: 'capacity-unit',
            source: 'driver:kvStore',
        }));
    }

    #coerceKey(key: unknown): string {
        if (key === null || key === undefined) {
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        }
        const str = typeof key === 'string' ? key : String(key);
        if (str === '')
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        return str;
    }

    #opts(appUuid?: string): { actor: Actor | undefined; appUuid?: string } {
        const actor = Context.get('actor') as Actor | undefined;
        if (actor?.app?.uid) {
            // force appUuid to be the one from the actor if it exists, only root tokens allowed to override appUuid
            appUuid = undefined;
        }
        return { actor: Context.get('actor') as Actor | undefined, appUuid };
    }

    #meter(actor: Actor | undefined, usage: KVUsage): void {
        if (!actor) return;
        const metering = this.services.metering;
        if (usage.read > 0) {
            void metering
                .incrementUsage(
                    actor,
                    'kv:read',
                    usage.read,
                    KV_COSTS['kv:read'] * usage.read,
                )
                .catch((e) =>
                    console.warn(
                        '[kv] metering kv:read failed:',
                        (e as Error).message,
                    ),
                );
        }
        if (usage.write > 0) {
            void metering
                .incrementUsage(
                    actor,
                    'kv:write',
                    usage.write,
                    KV_COSTS['kv:write'] * usage.write,
                )
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
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
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
        if (value === undefined)
            throw new HttpError(400, 'Missing `value`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers

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
            throw new HttpError(400, 'Missing or empty `items`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
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
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`', {
                legacyCode: 'bad_request',
            });
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
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`', {
                legacyCode: 'bad_request',
            });
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
            throw new HttpError(400, '`timestamp` must be a number', {
                legacyCode: 'bad_request',
            });
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
            throw new HttpError(400, '`ttl` must be a number (seconds)', {
                legacyCode: 'bad_request',
            });
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { usage } = await this.stores.kv.expire(
            { key: coerced, ttl: args.ttl },
            opts,
        );
        this.#meter(opts.actor, usage);
    }

    async update(args: {
        key: unknown;
        pathAndValueMap: Record<string, unknown>;
        ttl?: number;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key);
        if (!args.pathAndValueMap || typeof args.pathAndValueMap !== 'object') {
            throw new HttpError(400, 'Missing or invalid `pathAndValueMap`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.update(
            {
                key: coerced,
                pathAndValueMap: args.pathAndValueMap,
                ttl: args.ttl,
            },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async add(args: {
        key: unknown;
        pathAndValueMap: Record<string, unknown>;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key);
        if (!args.pathAndValueMap || typeof args.pathAndValueMap !== 'object') {
            throw new HttpError(400, 'Missing or invalid `pathAndValueMap`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.add(
            { key: coerced, pathAndValueMap: args.pathAndValueMap },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async remove(args: {
        key: unknown;
        paths: string[];
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key);
        if (!Array.isArray(args.paths) || args.paths.length === 0) {
            throw new HttpError(400, 'Missing or invalid `paths`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = this.#opts(args.optConfig?.appUuid);
        const { res, usage } = await this.stores.kv.remove(
            { key: coerced, paths: args.paths },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }
}
