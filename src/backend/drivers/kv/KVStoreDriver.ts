/*
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
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { DriverConcurrentConfig, DriverRateLimitConfig } from '../meta.js';
import {
    APP_DATA_KV_METHOD_OPS,
    APP_DATA_KV_TTL_PARAMS,
    appDataPermission,
    appDataSharingAllowed,
} from '../../services/permission/appDataScopes.js';
import type { KVOpts, KVUsage } from '../../stores/systemKv/SystemKVStore.js';
import { assertActorHasCredits } from '../../services/metering/enforcement.js';
import { KV_COSTS } from './costs.js';

/**
 * Every KV method's argument object, as far as option resolution cares: the
 * namespace override, plus the expiry parameters that can delete an entry.
 */
type KvCallArgs = {
    optConfig?: { appUuid?: string; disableSharing?: boolean };
    expireAt?: unknown;
    ttl?: unknown;
};

/**
 * Methods that stay available to an account with nothing left of its budget.
 * Each one only ever reduces what the account is storing, and turning those
 * away would leave no way to stop spending other than paying.
 *
 * `list` is here for the step before that: deleting a key means knowing it
 * exists, and `flush` — the only alternative — takes everything. It is gated
 * again inside the method for the forms that return values, which are a read
 * like any other.
 */
const CREDIT_UNGATED_KV_METHODS = new Set(['del', 'remove', 'flush', 'list']);

/**
 * KV store driver implementing the `puter-kvstore` interface.
 *
 * Thin wrapper around `stores.kv` (SystemKVStore): it validates/coerces request
 * inputs into HTTP-friendly errors, passes the request actor through so the
 * store scopes data to the correct namespace, and meters the DynamoDB capacity
 * the store reports back.
 */
export class KVStoreDriver extends PuterDriver {
    readonly driverInterface = 'puter-kvstore';
    readonly driverName = 'puter-kvstore';
    readonly isDefault = true;

    // Pre-v2 these limits lived on the kv permission policy in
    // `hardcoded-permissions.js` and were keyed by user-group membership
    // (registered vs anonymous). The v2 metering service expresses the
    // same distinction as subscription tier (`user_free` vs `temp_free`),
    // so the policy moves to the driver and keys off `getActorSubscription`.
    // The base `limit` matches the registered tier so anonymous traffic
    // (no subscription resolution) is not given the tighter cap.
    readonly rateLimit: DriverRateLimitConfig = {
        default: {
            limit: 400,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 400,
                [DEFAULT_TEMP_SUBSCRIPTION]: 200,
            },
        },
        methods: {
            // `list` is a prefix scan, not a point read — it does not
            // belong on the same budget as `get`/`set`. It is still a
            // foreground call an app makes to render a view, though, so the
            // window has to clear a session's worth of those; the in-flight
            // cap below is what keeps the scans from piling up.
            list: {
                limit: 240,
                window: 60_000,
                bySubscription: {
                    [DEFAULT_FREE_SUBSCRIPTION]: 120,
                    [DEFAULT_TEMP_SUBSCRIPTION]: 60,
                },
            },
        },
    };

    // The rate window above is well-tuned; what was missing is an in-flight
    // bound. This is the driver most likely to be called from a tight loop
    // inside a worker, where the caller never waits for a response.
    readonly concurrent: DriverConcurrentConfig = {
        default: {
            limit: 30,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 15,
                [DEFAULT_TEMP_SUBSCRIPTION]: 8,
            },
        },
        methods: {
            list: {
                limit: 5,
                bySubscription: {
                    [DEFAULT_FREE_SUBSCRIPTION]: 3,
                    [DEFAULT_TEMP_SUBSCRIPTION]: 2,
                },
            },
        },
    };

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

    async #opts(method: string, args: KvCallArgs): Promise<KVOpts> {
        const actor = Context.get('actor') as Actor | undefined;

        // Every method resolves its options here first, so this is the one
        // place the budget gate has to go. `CREDIT_UNGATED_KV_METHODS` is what
        // stays reachable after it: an account that has run out still has to be
        // able to get its data out of the way of the next thing it stores.
        if (!CREDIT_UNGATED_KV_METHODS.has(method)) {
            await assertActorHasCredits(
                this.services.metering,
                actor,
                this.config,
            );
        }

        const appUuid = args.optConfig?.appUuid;
        // Through the issuer chain, not `actor.app`: an access-token actor
        // carries no app of its own, so keying off `app` would read a token an
        // app minted as a bare user token and hand it the ungated branch below
        // — no permission check, and no private-entry filtering either, since
        // the store keys that off `namespaceAppUuid`.
        const ownAppUid = actor?.effectiveApp?.uid;

        // A user or API token acting on its own data: ungated, as before.
        if (!ownAppUid) return { actor, appUuid };

        // Self-access is implicit, so it never reaches a permission lookup.
        if (!appUuid || appUuid === ownAppUid) return { actor };

        // Only an entry's owner may mark it private; otherwise one app could
        // hide data inside another's namespace.
        if (args.optConfig?.disableSharing) {
            throw new HttpError(
                400,
                "kv: `disableSharing` cannot be set on another app's data",
                { legacyCode: 'bad_request' },
            );
        }

        await this.#assertCrossAppKvAccess(actor!, appUuid, method, args);
        return { actor, namespaceAppUuid: appUuid };
    }

    async #assertCrossAppKvAccess(
        actor: Actor,
        targetAppUid: string,
        method: string,
        args: KvCallArgs,
    ): Promise<void> {
        // `null` = no scope reaches it (`flush` is namespace-wide, not an
        // entry op); `undefined` = unmapped method. Both fail closed.
        const op = APP_DATA_KV_METHOD_OPS[method];
        if (!op) {
            throw new HttpError(
                403,
                `kv: \`${method}\` is not available on another app's data`,
                { legacyCode: 'forbidden' },
            );
        }

        const target = await this.stores.app.getByUid(targetAppUid);
        if (!target) {
            throw new HttpError(404, `entity_not_found: app:${targetAppUid}`, {
                legacyCode: 'subject_does_not_exist',
            });
        }
        if (!appDataSharingAllowed(target)) {
            throw new HttpError(
                403,
                'kv: this app does not share its data with other apps',
                { legacyCode: 'forbidden' },
            );
        }

        if (
            !(await this.services.permission.check(
                actor,
                appDataPermission(targetAppUid, 'kv', op),
            ))
        ) {
            throw new HttpError(403, 'Permission denied', {
                legacyCode: 'forbidden',
            });
        }

        const raw = args as Record<string, unknown>;
        if (
            APP_DATA_KV_TTL_PARAMS.some(
                (p) => raw[p] !== undefined && raw[p] !== null,
            )
        ) {
            await this.#assertCrossAppExpiry(actor, targetAppUid);
        }
    }

    /**
     * An expiry destroys the entry once it lapses, so carrying one needs the
     * delete class on top of the write. The class, not an op: `kv:del` alone
     * means "may remove keys", not "may attach expiries".
     */
    async #assertCrossAppExpiry(
        actor: Actor,
        targetAppUid: string,
    ): Promise<void> {
        const granted = await this.services.permission.check(
            actor,
            appDataPermission(targetAppUid, 'kv', 'delete'),
        );
        if (!granted) {
            throw new HttpError(403, 'Permission denied', {
                legacyCode: 'forbidden',
            });
        }
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
        if (usage.cachedRead > 0) {
            // A tenth of a read's rate is small enough that a metering write per
            // call would cost more than the call records, which would undo the
            // saving the cache exists for. Buffered in with the actor's other
            // sub-microcent usage and written once for all of it.
            metering.bufferIncrementUsages(actor, [
                {
                    usageType: 'kv:read:cached',
                    usageAmount: usage.cachedRead,
                    costOverride: KV_COSTS['kv:read:cached'] * usage.cachedRead,
                },
            ]);
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
        const { key } = args;
        if (key === undefined || key === null) {
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        }

        const opts = await this.#opts('get', args);

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
        optConfig?: { appUuid?: string; disableSharing?: boolean };
    }): Promise<boolean> {
        const { key, value, expireAt } = args;
        const coerced = this.#coerceKey(key);
        if (value === undefined)
            throw new HttpError(400, 'Missing `value`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers

        const opts = await this.#opts('set', args);
        const { res, usage } = await this.stores.kv.set(
            {
                key: coerced,
                value,
                expireAt,
                disableSharing: args.optConfig?.disableSharing,
            },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async batchPut(args: {
        items: Array<{ key: string; value: unknown; expireAt?: number }>;
        optConfig?: { appUuid?: string; disableSharing?: boolean };
    }): Promise<boolean> {
        const { items } = args;
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

        const opts = await this.#opts('batchPut', args);
        // Per-item expiry, which the top-level scan in `#opts` cannot see.
        if (
            opts.namespaceAppUuid &&
            coerced.some(
                (item) => item.expireAt !== undefined && item.expireAt !== null,
            )
        ) {
            await this.#assertCrossAppExpiry(
                opts.actor!,
                opts.namespaceAppUuid,
            );
        }
        const { res, usage } = await this.stores.kv.batchPut(
            {
                items: coerced,
                disableSharing: args.optConfig?.disableSharing,
            },
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
        const opts = await this.#opts('del', args);
        const { res, usage } = await this.stores.kv.del({ key: coerced }, opts);
        this.#meter(opts.actor, usage);
        return res;
    }

    async list(args: {
        as?: 'entries' | 'keys' | 'values';
        limit?: number;
        cursor?: string | Record<string, unknown>;
        pattern?: string;
        offset?: number;
        includeTotal?: boolean;
        fetchUntilFull?: boolean;
        optConfig?: { appUuid?: string };
    }): Promise<unknown> {
        const opts = await this.#opts('list', args);
        // Naming what it holds is how an account with nothing left decides what
        // to delete, so the keys stay readable. Reading the values back out is
        // the same egress every other read is turned away for.
        if (args.as !== 'keys') {
            await assertActorHasCredits(
                this.services.metering,
                opts.actor,
                this.config,
            );
        }
        const { res, usage } = await this.stores.kv.list(
            {
                as: args.as,
                limit: args.limit,
                cursor: args.cursor,
                pattern: args.pattern,
                offset: args.offset,
                includeTotal: args.includeTotal,
                fetchUntilFull: args.fetchUntilFull,
            },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async flush(args: { optConfig?: { appUuid?: string } }): Promise<boolean> {
        const opts = await this.#opts('flush', args);
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
        const opts = await this.#opts('incr', args);
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
        const opts = await this.#opts('decr', args);
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
        const opts = await this.#opts('expireAt', args);
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
        const opts = await this.#opts('expire', args);
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
        const opts = await this.#opts('update', args);
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
        const opts = await this.#opts('add', args);
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
        const opts = await this.#opts('remove', args);
        const { res, usage } = await this.stores.kv.remove(
            { key: coerced, paths: args.paths },
            opts,
        );
        this.#meter(opts.actor, usage);
        return res;
    }
}
