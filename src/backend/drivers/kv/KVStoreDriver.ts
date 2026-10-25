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
import {
    KV_GLOBAL_APP_KEY,
    kvNamespace,
    type KVOpts,
    type KVUsage,
} from '../../stores/systemKv/SystemKVStore.js';
import { KV_SHARE_HANDLE_WIDTHS } from '../../stores/events/columnWidths.js';
import { assertActorHasCredits } from '../../services/metering/enforcement.js';
import { isKvHandleId } from '../../services/events/subjects.js';
import {
    KV_HANDLE_KEY_MAX_BYTES,
    KV_SHARE_PREFIX_MAX_BYTES,
    kvHandlesDisabled,
    kvShareLevelForMethod,
    kvSharePermission,
} from '../../services/kvShare/kvShares.js';
import {
    decodeCursor,
    normalizeLimit,
    openCursor,
    sealCursor,
} from '../../util/pagination.js';
import { KV_COSTS } from './costs.js';
import {
    KV_MAX_BATCH_PUT_ITEMS,
    KV_MAX_GET_KEYS,
    KV_MAX_LIST_LIMIT,
} from './limits.js';

/** `optConfig` as every KV method takes it. */
interface KvOptConfig {
    /** Another app's namespace, which the user let this app reach. */
    appUuid?: string;
    /** Writes the entry private to the app that wrote it. */
    disableSharing?: boolean;
    /**
     * A share handle: the call reaches that region of its owner's data, with
     * keys relative to it.
     */
    handle?: string;
    /** `set` only: write only when no live entry holds the key. */
    onlyIfAbsent?: boolean;
}

/**
 * Every KV method's argument object, as far as option resolution cares: the
 * namespace override, plus the expiry parameters that can delete an entry.
 */
type KvCallArgs = {
    optConfig?: KvOptConfig;
    expireAt?: unknown;
    ttl?: unknown;
};

/**
 * Store options plus, for a call through a share handle, the region's prefix:
 * keys go in under it and come back out relative to it.
 */
type DriverKvOpts = KVOpts & { handlePrefix?: string };

type KvListResult =
    | unknown[]
    | { items: unknown[]; cursor?: string; total?: number };

// -- Share-handle errors ----------------------------------------------

/**
 * Unknown, retired, not the caller's, owner gone or suspended, or namespace app
 * deleted: one body for all of them, so no call can tell them apart.
 */
const handleNotFound = (): HttpError =>
    new HttpError(404, 'kv: no such share handle', {
        legacyCode: 'kv_handle_not_found',
    });

/** Only ever told to the handle's holder. */
const handleAccessDenied = (): HttpError =>
    new HttpError(403, 'kv: this share handle does not allow this call', {
        legacyCode: 'kv_handle_access_denied',
    });

const handleOptionInvalid = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'kv_handle_option_invalid' });

const handleKeyInvalid = (): HttpError =>
    new HttpError(
        400,
        `kv: a key used with a share handle must be a non-empty string of at most ${KV_HANDLE_KEY_MAX_BYTES} bytes`,
        { legacyCode: 'kv_handle_key_invalid' },
    );

/** The key limit, so no pattern length can tell how long the prefix is. */
const handlePatternInvalid = (): HttpError =>
    new HttpError(
        400,
        `kv: a pattern used with a share handle may be at most ${KV_HANDLE_KEY_MAX_BYTES} bytes`,
        { legacyCode: 'kv_handle_key_invalid' },
    );

const invalidCursor = (): HttpError =>
    new HttpError(400, 'invalid kv: cursor', { legacyCode: 'bad_request' });

/** A stored key outside the handle's region, which a scan can't return. */
const outsideRegion = (): HttpError =>
    new HttpError(500, 'kv: internal error', { legacyCode: 'internal_error' });

const viaHandle = (args?: KvCallArgs): boolean =>
    args?.optConfig?.handle !== undefined && args.optConfig.handle !== null;

/** `onlyIfAbsent` as a boolean, refusing anything else a raw body sends. */
const parseOnlyIfAbsent = (value: unknown): boolean => {
    if (value === undefined || value === null || value === false) return false;
    if (value === true) return true;
    throw new HttpError(400, 'kv: onlyIfAbsent must be a boolean', {
        legacyCode: 'bad_request',
    });
};

/**
 * A store error with every stored key it names put back the way the caller
 * named it, so the handle's prefix never leaves in a message.
 */
const relativizeError = (
    err: unknown,
    prefix: string,
    keys: readonly string[],
): unknown => {
    if (!(err instanceof Error) || typeof err.message !== 'string') return err;
    let message = err.message;
    for (const key of keys)
        message = message.split(`${prefix}${key}`).join(key);
    if (message !== err.message) err.message = message;
    return err;
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

    /**
     * A key as the caller sent it. Through a handle it is relative to the
     * region, and held to the handle's own fixed limit.
     */
    #coerceKey(key: unknown, args?: KvCallArgs): string {
        if (key === null || key === undefined) {
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        }
        const str = typeof key === 'string' ? key : String(key);
        if (viaHandle(args)) {
            if (
                str === '' ||
                Buffer.byteLength(str, 'utf8') > KV_HANDLE_KEY_MAX_BYTES
            )
                throw handleKeyInvalid();
            return str;
        }
        if (str === '')
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        return str;
    }

    /** The key as stored: through a handle, placed under its prefix. */
    #storeKey(key: string, opts: DriverKvOpts): string {
        return opts.handlePrefix === undefined
            ? key
            : `${opts.handlePrefix}${key}`;
    }

    /** A stored key as a handle's caller names it; fails closed outside it. */
    #relativeKey(key: unknown, prefix: string): string {
        if (typeof key !== 'string' || !key.startsWith(prefix))
            throw outsideRegion();
        return key.slice(prefix.length);
    }

    /**
     * Run one store call. Through a handle, an error naming a stored key names
     * the caller's relative key instead.
     */
    async #inRegion<T>(
        opts: DriverKvOpts,
        keys: readonly string[],
        call: () => Promise<T>,
    ): Promise<T> {
        if (opts.handlePrefix === undefined) return call();
        try {
            return await call();
        } catch (err) {
            throw relativizeError(err, opts.handlePrefix, keys);
        }
    }

    async #opts(method: string, args: KvCallArgs): Promise<DriverKvOpts> {
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

        if (viaHandle(args)) return this.#handleOpts(actor, method, args);

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

    /**
     * A call through a share handle, resolved to the owner's namespace. The
     * handle row only names the region and whose it is; the grant, checked here
     * on every call, is the authority. One check covers every key of the call,
     * since they all sit under the handle's prefix.
     */
    async #handleOpts(
        actor: Actor | undefined,
        method: string,
        args: KvCallArgs,
    ): Promise<DriverKvOpts> {
        if (this.config.kv?.shareHandles !== true) throw kvHandlesDisabled();

        const optConfig = args.optConfig ?? {};
        const level = kvShareLevelForMethod(method);
        if (optConfig.appUuid || optConfig.disableSharing)
            throw handleOptionInvalid(
                'kv: `handle` cannot be combined with `appUuid` or `disableSharing`',
            );
        if (level === null)
            throw handleOptionInvalid(
                `kv: \`${method}\` is not available through a share handle`,
            );

        const handle: unknown = optConfig.handle;
        if (typeof handle !== 'string')
            throw handleOptionInvalid('kv: `handle` must be a string');
        const userId = actor?.user?.id;
        if (
            !actor ||
            typeof userId !== 'number' ||
            handle.length > KV_SHARE_HANDLE_WIDTHS.handle.max ||
            !isKvHandleId(handle)
        )
            throw handleNotFound();

        const live = await this.stores.kvShareHandle.getLive(handle);
        if (!live || live.ownerSuspended) throw handleNotFound();
        const { row, ownerUuid } = live;
        // Bound to its grantee: a handle id is an address, not a bearer
        // credential, so another holder's overlapping grant doesn't reach it.
        if (userId !== row.granteeUserId && userId !== row.ownerUserId)
            throw handleNotFound();

        // Side by side, so the app lookup costs no round trip of its own.
        const [appGone, allowed] = await Promise.all([
            row.appUid === KV_GLOBAL_APP_KEY
                ? false
                : this.stores.app.getByUid(row.appUid).then((app) => !app),
            this.services.permission.check(
                actor,
                kvSharePermission(ownerUuid, row.appUid, row.keyPrefix, level),
            ),
        ]);
        if (appGone) throw handleNotFound();
        if (!allowed) {
            // Asked only on the way out: whoever can still watch the region
            // is its holder, and only they may learn the level is too low.
            const holds = await this.services.permission.check(
                actor,
                kvSharePermission(
                    ownerUuid,
                    row.appUid,
                    row.keyPrefix,
                    'watch',
                ),
            );
            throw holds ? handleAccessDenied() : handleNotFound();
        }
        // Past the cap only a watch handle can be, reached through a wider
        // grant; the fixed key limit holders are shown assumes the cap.
        if (
            Buffer.byteLength(row.keyPrefix, 'utf8') > KV_SHARE_PREFIX_MAX_BYTES
        )
            throw handleAccessDenied();

        return {
            actor,
            namespaceUser: { uuid: ownerUuid, id: row.ownerUserId },
            namespaceAppUuid: row.appUid,
            handlePrefix: row.keyPrefix,
        };
    }

    /**
     * A handle listing's cursor names a key relative to the handle. The store
     * position is rebuilt from the handle's own namespace, so nothing the
     * caller sends can name a namespace or a key outside the region.
     */
    #cursorIn(
        cursor: unknown,
        opts: DriverKvOpts,
    ): Record<string, unknown> | undefined {
        if (cursor === undefined || cursor === null) return undefined;
        if (typeof cursor !== 'string' && typeof cursor !== 'object')
            throw invalidCursor();
        const decoded: unknown = openCursor(
            cursor as string | Record<string, unknown>,
            this.config.jwt_secret_v2,
            'kv: cursor',
        );
        if (decoded === undefined) return undefined;
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
            throw invalidCursor();
        const { k, r, ...rest } = decoded as Record<string, unknown>;
        if (
            typeof k !== 'string' ||
            Buffer.byteLength(k, 'utf8') > KV_HANDLE_KEY_MAX_BYTES ||
            (r !== undefined && r !== true) ||
            Object.keys(rest).length > 0
        )
            throw invalidCursor();
        const position = {
            namespace: kvNamespace(
                opts.namespaceUser!.uuid,
                opts.namespaceAppUuid!,
            ),
            key: `${opts.handlePrefix}${k}`,
        };
        return r === true ? { reverse: true, key: position } : position;
    }

    /**
     * The store's next-page position, as a key relative to the handle. Sealed:
     * the scan can stop on a private entry it filtered out.
     */
    #cursorOut(cursor: string, opts: DriverKvOpts): string | undefined {
        const decoded = decodeCursor(cursor);
        const reverse = decoded?.reverse === true;
        const position = (reverse ? decoded?.key : decoded) as
            | { namespace?: unknown; key?: unknown }
            | undefined;
        if (
            position?.namespace !==
            kvNamespace(opts.namespaceUser!.uuid, opts.namespaceAppUuid!)
        )
            throw outsideRegion();
        return sealCursor(
            {
                k: this.#relativeKey(position.key, opts.handlePrefix!),
                ...(reverse ? { r: true } : {}),
            },
            this.config.jwt_secret_v2,
        );
    }

    /** A listing with every key in it relative to the handle. */
    #relativeListing(
        res: KvListResult,
        as: string | undefined,
        opts: DriverKvOpts,
    ): KvListResult {
        const prefix = opts.handlePrefix!;
        const relative = (items: unknown[]): unknown[] => {
            if (as === 'values') return items;
            if (as === 'keys')
                return items.map((key) => this.#relativeKey(key, prefix));
            return items.map((entry) => {
                const { key, value } = entry as {
                    key: unknown;
                    value: unknown;
                };
                return { key: this.#relativeKey(key, prefix), value };
            });
        };
        if (Array.isArray(res)) return relative(res);
        const cursor = res.cursor
            ? this.#cursorOut(res.cursor, opts)
            : undefined;
        return {
            items: relative(res.items),
            ...(cursor ? { cursor } : {}),
            ...(res.total !== undefined ? { total: res.total } : {}),
        };
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

        // `expire` takes its TTL as `ttl`, and its own op is already a deletion.
        const raw = args as Record<string, unknown>;
        if (
            op !== 'expire' &&
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
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const { key } = args;
        if (key === undefined || key === null) {
            throw new HttpError(400, 'Missing `key`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        }

        if (Array.isArray(key) && key.length > KV_MAX_GET_KEYS) {
            throw new HttpError(
                400,
                `kv: get accepts at most ${KV_MAX_GET_KEYS} keys per call`,
                { legacyCode: 'bad_request' },
            );
        }

        const opts = await this.#opts('get', args);

        if (Array.isArray(key)) {
            if (key.length === 0) return [];
            const coerced = key.map((k) => this.#coerceKey(k, args));
            const { res, usage } = await this.#inRegion(opts, coerced, () =>
                this.stores.kv.get(
                    { key: coerced.map((k) => this.#storeKey(k, opts)) },
                    opts,
                ),
            );
            this.#meter(opts.actor, usage);
            return res;
        }

        const coerced = this.#coerceKey(key, args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.get({ key: this.#storeKey(coerced, opts) }, opts),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    /**
     * `false` only for an `onlyIfAbsent` write that found a live entry, which
     * is left as it was.
     */
    async set(args: {
        key: unknown;
        value: unknown;
        expireAt?: number | null;
        optConfig?: KvOptConfig;
    }): Promise<boolean> {
        const { key, value, expireAt } = args;
        const coerced = this.#coerceKey(key, args);
        if (value === undefined)
            throw new HttpError(400, 'Missing `value`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        const onlyIfAbsent = parseOnlyIfAbsent(args.optConfig?.onlyIfAbsent);

        const opts = await this.#opts('set', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.set(
                {
                    key: this.#storeKey(coerced, opts),
                    value,
                    expireAt,
                    disableSharing: args.optConfig?.disableSharing,
                    onlyIfAbsent,
                },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async batchPut(args: {
        items: Array<{ key: string; value: unknown; expireAt?: number | null }>;
        optConfig?: KvOptConfig;
    }): Promise<boolean> {
        const { items } = args;
        if (!Array.isArray(items) || items.length === 0) {
            throw new HttpError(400, 'Missing or empty `items`', {
                legacyCode: 'bad_request',
            }); // legacyCode for backward compatibility with old error handling in controllers
        }
        if (items.length > KV_MAX_BATCH_PUT_ITEMS) {
            throw new HttpError(
                400,
                `kv: a batch write accepts at most ${KV_MAX_BATCH_PUT_ITEMS} items per call`,
                { legacyCode: 'bad_request' },
            );
        }
        // A batch write takes no condition, so it can't promise this per item.
        if (parseOnlyIfAbsent(args.optConfig?.onlyIfAbsent)) {
            throw new HttpError(
                400,
                'kv: onlyIfAbsent is not available on a batch write',
                { legacyCode: 'invalid_request' },
            );
        }

        const coerced = items.map((item) => ({
            key: this.#coerceKey(item.key, args),
            value: item.value,
            expireAt: item.expireAt,
        }));

        const opts = await this.#opts('batchPut', args);
        // Per-item expiry, which the top-level scan in `#opts` cannot see. A
        // handle's `write` level already carries expiries.
        if (
            opts.namespaceAppUuid &&
            opts.handlePrefix === undefined &&
            coerced.some(
                (item) => item.expireAt !== undefined && item.expireAt !== null,
            )
        ) {
            await this.#assertCrossAppExpiry(
                opts.actor!,
                opts.namespaceAppUuid,
            );
        }
        const { res, usage } = await this.#inRegion(
            opts,
            coerced.map((item) => item.key),
            () =>
                this.stores.kv.batchPut(
                    {
                        items: coerced.map((item) => ({
                            ...item,
                            key: this.#storeKey(item.key, opts),
                        })),
                        disableSharing: args.optConfig?.disableSharing,
                    },
                    opts,
                ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async del(args: {
        key: unknown;
        optConfig?: KvOptConfig;
    }): Promise<boolean> {
        const coerced = this.#coerceKey(args.key, args);
        const opts = await this.#opts('del', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.del({ key: this.#storeKey(coerced, opts) }, opts),
        );
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
        reverse?: boolean;
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const opts = await this.#opts('list', args);
        // Naming what it holds is how an account with nothing left decides what
        // to delete, so the keys stay readable. Reading the values back out is
        // the same egress every other read is turned away for, and a total is
        // a count over the whole namespace that naming keys doesn't need.
        if (args.as !== 'keys' || args.includeTotal) {
            await assertActorHasCredits(
                this.services.metering,
                opts.actor,
                this.config,
            );
        }
        const handlePrefix = opts.handlePrefix;
        if (
            handlePrefix !== undefined &&
            typeof args.pattern === 'string' &&
            Buffer.byteLength(args.pattern, 'utf8') > KV_HANDLE_KEY_MAX_BYTES
        )
            throw handlePatternInvalid();
        const { res, usage } = await this.stores.kv.list(
            {
                as: args.as,
                limit: normalizeLimit(args.limit, {
                    cap: KV_MAX_LIST_LIMIT,
                    label: 'kv: limit',
                }),
                cursor:
                    handlePrefix === undefined
                        ? args.cursor
                        : this.#cursorIn(args.cursor, opts),
                pattern: args.pattern,
                offset: args.offset,
                includeTotal: args.includeTotal,
                fetchUntilFull: args.fetchUntilFull,
                reverse: args.reverse,
                ...(handlePrefix === undefined
                    ? {}
                    : { keyPrefix: handlePrefix }),
            },
            opts,
        );
        this.#meter(opts.actor, usage);
        if (handlePrefix === undefined) return res;
        return this.#relativeListing(res as KvListResult, args.as, opts);
    }

    async flush(args: { optConfig?: KvOptConfig }): Promise<boolean> {
        const opts = await this.#opts('flush', args);
        const { res, usage } = await this.stores.kv.flush(opts);
        this.#meter(opts.actor, usage);
        return res;
    }

    async incr(args: {
        key: unknown;
        pathAndAmountMap: Record<string, number>;
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key, args);
        if (
            !args.pathAndAmountMap ||
            typeof args.pathAndAmountMap !== 'object'
        ) {
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('incr', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.incr(
                {
                    key: this.#storeKey(coerced, opts),
                    pathAndAmountMap: args.pathAndAmountMap,
                },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async decr(args: {
        key: unknown;
        pathAndAmountMap: Record<string, number>;
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key, args);
        if (
            !args.pathAndAmountMap ||
            typeof args.pathAndAmountMap !== 'object'
        ) {
            throw new HttpError(400, 'Missing or invalid `pathAndAmountMap`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('decr', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.decr(
                {
                    key: this.#storeKey(coerced, opts),
                    pathAndAmountMap: args.pathAndAmountMap,
                },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async expireAt(args: {
        key: unknown;
        timestamp: number;
        optConfig?: KvOptConfig;
    }): Promise<boolean> {
        const coerced = this.#coerceKey(args.key, args);
        if (typeof args.timestamp !== 'number') {
            throw new HttpError(400, '`timestamp` must be a number', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('expireAt', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.expireAt(
                {
                    key: this.#storeKey(coerced, opts),
                    timestamp: args.timestamp,
                },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async expire(args: {
        key: unknown;
        ttl: number;
        optConfig?: KvOptConfig;
    }): Promise<boolean> {
        const coerced = this.#coerceKey(args.key, args);
        if (typeof args.ttl !== 'number') {
            throw new HttpError(400, '`ttl` must be a number (seconds)', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('expire', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.expire(
                { key: this.#storeKey(coerced, opts), ttl: args.ttl },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async update(args: {
        key: unknown;
        pathAndValueMap: Record<string, unknown>;
        ttl?: number | null;
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key, args);
        if (!args.pathAndValueMap || typeof args.pathAndValueMap !== 'object') {
            throw new HttpError(400, 'Missing or invalid `pathAndValueMap`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('update', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.update(
                {
                    key: this.#storeKey(coerced, opts),
                    pathAndValueMap: args.pathAndValueMap,
                    ttl: args.ttl,
                },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async add(args: {
        key: unknown;
        pathAndValueMap: Record<string, unknown>;
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key, args);
        if (!args.pathAndValueMap || typeof args.pathAndValueMap !== 'object') {
            throw new HttpError(400, 'Missing or invalid `pathAndValueMap`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('add', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.add(
                {
                    key: this.#storeKey(coerced, opts),
                    pathAndValueMap: args.pathAndValueMap,
                },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        return res;
    }

    async remove(args: {
        key: unknown;
        paths: string[];
        optConfig?: KvOptConfig;
    }): Promise<unknown> {
        const coerced = this.#coerceKey(args.key, args);
        if (!Array.isArray(args.paths) || args.paths.length === 0) {
            throw new HttpError(400, 'Missing or invalid `paths`', {
                legacyCode: 'bad_request',
            });
        }
        const opts = await this.#opts('remove', args);
        const { res, usage } = await this.#inRegion(opts, [coerced], () =>
            this.stores.kv.remove(
                { key: this.#storeKey(coerced, opts), paths: args.paths },
                opts,
            ),
        );
        this.#meter(opts.actor, usage);
        // The result is the entry's value, so a delete-only grant gets none. A
        // handle's `write` level reads too.
        if (
            opts.namespaceAppUuid &&
            opts.handlePrefix === undefined &&
            !(await this.services.permission.check(
                opts.actor!,
                appDataPermission(opts.namespaceAppUuid, 'kv', 'get'),
            ))
        ) {
            return null;
        }
        return res;
    }
}
