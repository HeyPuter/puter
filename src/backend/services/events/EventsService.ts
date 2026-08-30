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

import { randomUUID } from 'node:crypto';
import type { EventKey, KvOp } from '../../clients/event/types.js';
import {
    EVENTS_ACK_LIMIT,
    EVENTS_BROADCAST_DELIVERY_LIMIT,
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_HANDLER_PUBLISH_BATCH,
    EVENTS_HANDLER_PUBLISH_LIMIT,
    EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT,
    EVENTS_SUBSCRIBE_LIMIT,
    SUSPENDED_ROW_TTL_DAYS,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import type {
    ReanchorInput,
    SuspendedReason,
} from '../../stores/events/DurableSubscriptionStore.js';
import {
    HANDLER_SETTLE_BATCH,
    isSuspendedReason,
} from '../../stores/events/DurableSubscriptionStore.js';
import {
    HANDLER_NAME_MAX_LENGTH,
    hashContent,
    type EventHandlerSummary,
    type PublishOutcome,
} from '../../stores/events/EventHandlerStore.js';
import {
    SESSION_SUBSCRIPTION_TTL_SECONDS,
    type DispatchSubscription,
    type DurableSubscription,
    type GenerationBump,
    type SessionSubscription,
} from '../../stores/events/EventSubscriptionStore.js';
import type {
    ClaimedDelivery,
    PendingShed,
} from '../../stores/events/PendingDeliveryStore.js';
import {
    DEFAULT_DURABLE_TARGETS,
    SESSION_TARGETS,
    isSubscriptionTarget,
    targetsAllowedForDelivery,
    type SubscriptionTarget,
} from '../../stores/events/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { parseKvNamespace } from '../../stores/systemKv/SystemKVStore.js';
import type { PageResult } from '../../util/pagination.js';
import type { AclMode, ResourceDescriptor } from '../acl/ACLService.js';
import { resolveNode } from '../fs/resolveNode.js';
import {
    appSocketRoom,
    type SocketSpecifier,
} from '../socket/SocketService.js';
import { PuterService } from '../types.js';
import {
    resolveFsAnchor,
    resolveKvAnchor,
    type FsAnchorDeps,
} from './anchors.js';
import {
    assertCrossAppKvAuthorized,
    assertSubscribeAuthorized,
    checkDeliveryAuthorized,
    crossAppKvDenial,
    crossAppKvPermissions,
    deliveryGenerationTag,
    nodeDescriptor,
    resolveGrantActor,
    rowInActorScope,
    SUBSCRIBE_MODE,
    type CrossAppKvDeps,
    type EventAclDeps,
    type SubscriptionGrant,
} from './authorization.js';
import { DeliveryCoalescer } from './coalescer.js';
import { DeliveryAuthCache } from './deliveryAuthCache.js';
import {
    FILTER_EVALUATIONS_PER_EVENT,
    compileMatch,
    evaluateWithCap,
    relativeTo,
    type CompiledMatch,
} from './matcher.js';
import {
    lookupFsSubject,
    lookupKvSubject,
    type DeliverableEvent,
    type DeliveryClass,
    type DeliveryFields,
    type EventContextBase,
    type FsEventContext,
    type GapMarker,
    type GapReason,
    type KvEventContext,
    type MatchSpec,
    type ProjectedEvent,
    type SubjectSpec,
} from './registry.js';
import { SubscriptionCache } from './subscriptionCache.js';
import {
    KV_MATCH_SEPARATOR,
    fsAnchorToken,
    isKvToken,
    parseSubject,
    type FsOp,
    type ParsedSubject,
    type SubjectOp,
} from './subjects.js';
import { backlogPolicyFor, isResumable } from './suspension.js';
import {
    RecordingWorkerInvoker,
    type WorkerInvocation,
    type WorkerInvokerSeam,
} from './workerSeam.js';

/**
 * Subscribe, unsubscribe, and the dispatch hot path.
 *
 * The write path is the constraint everything here is shaped by. Almost every
 * write in the product belongs to a user with no subscriptions at all, and that
 * write must not pay for the ones that do — so dispatch is three gates in
 * increasing order of cost:
 *
 * 1. The feature switch: a boolean.
 * 2. "Does this user have anything at all": in-process, invalidated by a broadcast
 *    rather than a timer, so it costs nothing once warm.
 * 3. One Redis command against the user's watched tokens.
 *
 * Only past all three does anything read a subscription or walk the tree, and
 * only a row that survived op and filter matching pays for the ACL re-check
 * that decides whether its holder may still be told. Everything is keyed by the
 * owner of the resource, because that is all a write knows about itself.
 *
 * Nothing here reaches the caller: an event that could not be dispatched is an
 * event nobody hears, and the write that produced it still succeeded.
 */

// -- Wire shapes ------------------------------------------------------

export interface SubscribeRequest {
    subject?: unknown;
    targets?: unknown;
}

export interface UnsubscribeRequest {
    subId?: unknown;
}

/** Body of the `events.ack` verb: which subscription, and which delivery. */
export interface AckRequest {
    subId?: unknown;
    id?: unknown;
}

/** Body of `POST /events/subscribe`. */
export interface DurableSubscribeRequest extends SubscribeRequest {
    delivery?: unknown;
    targets?: unknown;
    handlerName?: unknown;
    /**
     * Hash of the source the caller believes `handlerName` is published with.
     * Sent when the subscribe passed an inline handler; the row binds only if
     * it matches what the app actually published.
     */
    handlerHash?: unknown;
    context?: unknown;
    expiresAt?: unknown;
}

/** Body of `POST /events/handlers/publish`. */
export interface PublishHandlerRequest {
    appUid?: unknown;
    name?: unknown;
    source?: unknown;
    /** The published hash this publish is an update to. */
    ifHash?: unknown;
    replace?: unknown;
}

/** Body of `POST /events/handlers/publishAll`. */
export interface PublishHandlersRequest {
    appUid?: unknown;
    handlers?: unknown;
}

/** Body of `POST /events/handlers/remove`, and the shape `list` is scoped by. */
export interface HandlerNameRequest {
    appUid?: unknown;
    name?: unknown;
}

export interface HandlerScopeRequest {
    appUid?: unknown;
}

/** What one publish reports back. Never carries source. */
export interface PublishedHandlerView {
    name: string;
    hash: string;
    updatedAt: number;
    outcome: PublishOutcome;
    /** Suspended subscriptions this publish brought back into service. */
    resumed: number;
}

/** What a removal did to the name and to whatever was bound to it. */
export interface RemovedHandlerView {
    name: string;
    removed: boolean;
    suspended: number;
}

export interface DurableListRequest {
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}

/** What a client gets back for a subscription it just made. */
export interface SubscriptionView {
    subId: string;
    subject: string;
    anchor: { uid: string; path: string };
    match: string | null;
    op: FsOp | null;
    targets: SubscriptionTarget[];
}

/**
 * A durable row as its holder sees it. `context` **values** are deliberately
 * absent: the column holds whatever secret the handler needs, it is read on the
 * delivery path and nowhere else, and a listing is the one surface an app can
 * call repeatedly. What is safe to return is the shape — which keys are set,
 * and a hash that changes when any value does, which is what lets a caller tell
 * two subscriptions apart without being handed either one's secrets.
 */
export interface DurableSubscriptionView extends SubscriptionView {
    delivery: DeliveryClass;
    handlerName: string | null;
    appUid: string | null;
    /** Key names of the stored context, or `null` for a row without one. */
    contextKeys: string[] | null;
    /** Hash of the stored context, so a change is visible without the values. */
    contextHash: string | null;
    createdAt: number;
    expiresAt: number | null;
    suspendedAt: number | null;
    suspendedReason: string | null;
}

export type VerbAck<T extends object> =
    | ({ ok: true } & T)
    | { ok: false; error: { code: string; message: string } };

export type { GapMarker, GapReason } from './registry.js';

/** One delivery, as the client receives it. */
export interface DeliveryEnvelope {
    subId: string;
    event: DeliverableEvent;
    /** Set on a `single`: nothing else takes this until `events.ack` settles it. */
    ackRequired?: true;
    /** The handle `events.ack` names — the delivery, not the event. */
    ackId?: string;
}

/**
 * The envelope plus where it goes. The address is not part of the wire, and
 * neither is the handler a durable row may want run alongside the socket copy.
 */
interface AddressedDelivery {
    target: SocketSpecifier;
    envelope: DeliveryEnvelope;
    /** False for a row that asked for its handler and no socket copy. */
    socket: boolean;
    worker?: WorkerInvocation;
}

/**
 * Why a subscription ended without its holder unsubscribing. Both are terminal:
 * the grant is gone, or the node is, and neither comes back by itself.
 */
export type SubscriptionEndReason = 'permission_revoked' | 'anchor_deleted';

/** Who a stored row acts as, and what its cached decisions hang on. */
interface GrantIdentity {
    actor: Actor;
    generation: string;
}

/**
 * One authorized subject, as a row stores it. `uid`/`path` are family-scoped:
 * an FS row names a node and its path, a KV row names the app whose namespace
 * it watches and the key prefix it anchors at.
 */
interface ResolvedAnchor {
    token: string;
    uid: string;
    path: string;
    match: string | null;
    op: FsOp | null;
    ownerUserId: number;
    permission: AclMode;
    /** Fully-qualified wire form, which is what the row records. */
    subject: string;
}

/** A withdrawn grant, as the settle pass reads it off the bus. */
export interface RevokedGrant {
    holderUserId: number;
    /** The app the grant was to, or `null` for a user-to-user grant. */
    appUid: string | null;
    /** The grant string, or `null` when every grant to the app went. */
    permission: string | null;
}

/** What a dispatch call site can supply that the event itself does not carry. */
export interface FsDispatchOptions {
    /**
     * Resolved lazily and only past the second gate — walking the tree for a
     * user nobody subscribed on behalf of is the cost this exists to avoid.
     * Paths as well as uids: the same walk answers the token lookup and the
     * per-delivery ACL re-check.
     */
    ancestors?: () => Promise<ReadonlyArray<{ uid: string; path: string }>>;
    /** Who performed the write, for the `self` flag. */
    actingUserId?: number;
}

/** One committed KV mutation, as the bus reports it. */
export interface KvDispatchInput {
    /** Owner of the namespace: the keyspace subscriptions on it are indexed in. */
    userId: number;
    /** `v1:<userUuid>:<appUid>`. */
    namespace: string;
    keys: readonly string[];
    op: KvOp;
}

// -- Socket wire names ------------------------------------------------

export const EVENTS_SUBSCRIBE_VERB = 'events.subscribe';
export const EVENTS_UNSUBSCRIBE_VERB = 'events.unsubscribe';
export const EVENTS_ACK_VERB = 'events.ack';
export const EVENTS_DELIVERY_CHANNEL = 'events.delivery';

// -- Expiry sweep -----------------------------------------------------

/** An expiry is a date, not a deadline, so hourly is close enough. */
const EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// The first pass lands within this long of boot, so a fleet that redeploys more
// often than the interval still sweeps.
const EXPIRY_SWEEP_INITIAL_DELAY_MS = 5 * 60 * 1000;
/** Rows one delete takes. Small enough not to hold a lock anyone waits on. */
const EXPIRY_BATCH_SIZE = 500;
/** Batches one sweep takes, so a large backlog drains over several passes. */
const EXPIRY_MAX_BATCHES = 50;
/**
 * Subjects one "subscriptions ended" notification names before it stops
 * listing.
 */
const ENDED_SUBJECTS_LISTED = 20;

// -- Owed deliveries --------------------------------------------------

/**
 * Socket attempts one `single` delivery gets before its handler takes it. Two,
 * because the second is what a client that reconnected — or a second connection
 * of the same account — is worth trying; a third is just a slower hand-off.
 */
const SINGLE_SOCKET_ATTEMPTS = 2;

/** How often expired leases are reclaimed and owed deliveries retried. */
const PENDING_SWEEP_INTERVAL_MS = 10_000;

/** Subscriptions one sweep pass looks at, taken from the oldest end. */
const PENDING_SWEEP_SUBSCRIPTIONS = 100;

/**
 * Deliveries one subscription may be handed in a row. A consumer that settles
 * inline would otherwise drain a whole backlog inside one ack.
 */
const PENDING_DRAIN_BATCH = 25;

/** The part of a socket this service uses, so tests need not build one. */
export interface EventSocket {
    id: string;
    on(event: string, listener: (...args: never[]) => void): unknown;
    once(event: string, listener: (...args: never[]) => void): unknown;
}

// -- Errors -----------------------------------------------------------

const disabled = (): HttpError =>
    new HttpError(503, 'Events are not enabled on this server', {
        legacyCode: 'events_disabled',
    });

const unknownSubscription = (): HttpError =>
    new HttpError(404, 'No such subscription', {
        legacyCode: 'subscription_does_not_exist',
    });

const tooManyCalls = (): HttpError =>
    new HttpError(429, 'Too many subscription changes', {
        legacyCode: 'too_many_requests',
    });

const handlerRequired = (): HttpError =>
    new HttpError(400, 'A `single` subscription needs a handlerName', {
        legacyCode: 'events_handler_required',
    });

const handlerNotFound = (name: string): HttpError =>
    new HttpError(404, `No handler named \`${name}\` is published`, {
        legacyCode: 'events_handler_not_found',
    });

/**
 * The inline body the caller sent is not what is published. Refused rather than
 * bound: the point of sending a hash is to find out, and binding the published
 * source anyway would run code the caller never saw.
 */
const handlerHashMismatch = (name: string): HttpError =>
    new HttpError(
        409,
        `The handler published as \`${name}\` is not the source this subscription was written against`,
        { legacyCode: 'events_handler_hash_mismatch' },
    );

/**
 * Handlers belong to an app, so a caller has to be acting for one — an app
 * token names its own, and a user session names one in the request.
 */
const handlerAppRequired = (): HttpError =>
    new HttpError(400, 'Publishing a handler requires an app', {
        legacyCode: 'events_handler_app_required',
    });

/**
 * Deploying an app's code is the developer's, and an app token cannot borrow
 * its user's ownership of some other app. Same answer for an app that is not
 * there: which apps exist is not this surface's to disclose.
 */
const handlerAppForbidden = (): HttpError =>
    new HttpError(403, 'Only the app owner may publish its handlers', {
        legacyCode: 'events_handler_forbidden',
    });

const badRequest = (message: string, code: string): HttpError =>
    new HttpError(400, message, { legacyCode: code });

const errorAck = (err: unknown): VerbAck<never> => {
    if (err instanceof HttpError)
        return {
            ok: false,
            error: {
                code: String(err.legacyCode ?? err.code ?? 'events_failed'),
                message: err.message,
            },
        };
    return {
        ok: false,
        error: { code: 'events_failed', message: 'Subscription failed' },
    };
};

const toView = (sub: DispatchSubscription): SubscriptionView => ({
    subId: sub.subId,
    subject: sub.subject,
    anchor: { uid: sub.anchorUid, path: sub.anchorPath },
    match: sub.match,
    op: sub.op,
    targets: sub.targets ?? SESSION_TARGETS,
});

/**
 * The context as a listing may describe it: which keys it sets, and a hash of
 * the whole blob. Never the values — the column is where an API key lives.
 */
const projectContext = (
    context: string | null,
): Pick<DurableSubscriptionView, 'contextKeys' | 'contextHash'> => {
    if (context === null) return { contextKeys: null, contextHash: null };
    let keys: string[] = [];
    try {
        const parsed: unknown = JSON.parse(context);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            keys = Object.keys(parsed).sort();
    } catch {
        // Stored by this service as JSON, so this cannot normally happen; an
        // unreadable blob still reports its hash rather than failing the list.
    }
    return { contextKeys: keys, contextHash: hashContent(context) };
};

const toDurableView = (sub: DurableSubscription): DurableSubscriptionView => ({
    ...toView(sub),
    delivery: sub.delivery,
    handlerName: sub.handlerName,
    appUid: sub.appUid,
    ...projectContext(sub.context),
    createdAt: sub.createdAt,
    expiresAt: sub.expiresAt,
    suspendedAt: sub.suspendedAt,
    suspendedReason: sub.suspendedReason,
});

/** Coalescing is per (subscription, subject), which is what the key says. */
const coalesceKey = (subId: string, subject: string): string =>
    `${subId}|${subject}`;

/**
 * Where one row's deliveries go. A session row is addressed at the connection
 * that made it. A durable row has no connection to name, so it is addressed at
 * a room: the app's own room for a row an app created, and the holder's user
 * room for one their session created — which is every desktop tab they have
 * open, and the only handle that reaches an account rather than a connection.
 */
const deliveryTarget = (row: DispatchSubscription): SocketSpecifier => {
    if (row.socketId !== undefined) return { socket: row.socketId };
    return {
        room: row.appUid
            ? appSocketRoom(row.holderUserId, row.appUid)
            : String(row.holderUserId),
    };
};

/** Transports a row is asking for, whichever store it came from. */
const targetsOf = (row: DispatchSubscription): SubscriptionTarget[] =>
    row.durable === true
        ? (row.targets ?? DEFAULT_DURABLE_TARGETS)
        : SESSION_TARGETS;

/**
 * Whether this pass has anywhere to put the row. A `single` is queued whether
 * or not anything is listening right now — that is what it is for — while a
 * `broadcast` whose only transport is one this build cannot carry has no
 * target, and an event with no target is dropped rather than held.
 */
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Past `expiresAt` a durable row is finished, sweep or no sweep. */
const unexpired = (row: DispatchSubscription): boolean => {
    if (row.durable !== true) return true;
    const { expiresAt } = row as DurableSubscription;
    return expiresAt === null || expiresAt > nowSeconds();
};

const deliverable = (row: DispatchSubscription): boolean => {
    if (row.durable !== true) return true;
    if (!unexpired(row)) return false;
    if (row.delivery === 'single') return true;
    const targets = targetsOf(row);
    return targets.includes('socket') || targets.includes('worker');
};

const isSingle = (row: DispatchSubscription): boolean =>
    row.durable === true && row.delivery === 'single';

/**
 * Whether a KV row reaches past its own namespace. Read off the app the row was
 * created by — which is the actor's `effectiveApp` at subscribe time, so an
 * access token an app issued counts as that app rather than as no app. A row
 * with no app is its user acting on their own data, which the KV surface has
 * never gated.
 */
const isCrossAppKvRow = (
    rowAppUid: string | null,
    targetAppUid: string,
): boolean => rowAppUid !== null && rowAppUid !== targetAppUid;

// -- Durable request parsing ------------------------------------------

const parseDelivery = (value: unknown): DeliveryClass => {
    if (value === undefined || value === null || value === 'broadcast')
        return 'broadcast';
    if (value === 'single') return 'single';
    throw badRequest(`Unknown delivery class: ${String(value)}`, 'bad_request');
};

/**
 * There is exactly one events worker per app, so a row with no app has no
 * worker to invoke — `targets` for one may only ever carry `socket`. Omitted
 * targets default there quietly; an explicit ask for `worker` is refused rather
 * than silently dropped, since that is the caller telling us it expected
 * background delivery to exist.
 */
const parseTargets = (
    value: unknown,
    delivery: DeliveryClass,
    appUid: string | null,
): SubscriptionTarget[] => {
    if (value === undefined || value === null)
        return appUid === null ? SESSION_TARGETS : DEFAULT_DURABLE_TARGETS;
    if (!Array.isArray(value) || value.length === 0)
        throw badRequest(
            'targets must be a non-empty array',
            'invalid_targets',
        );
    if (!value.every(isSubscriptionTarget))
        throw badRequest('Unknown delivery target', 'invalid_targets');

    const targets = [...new Set(value)];
    if (!targetsAllowedForDelivery(delivery, targets))
        throw badRequest(
            'A `single` subscription needs a `worker` target and may not target `push`',
            'invalid_targets',
        );
    if (appUid === null && targets.includes('worker'))
        throw badRequest(
            'A subscription with no app has no events worker to target',
            'invalid_targets',
        );
    return targets;
};

/**
 * A session row is one connection, so the socket is the only transport it can
 * have: a handler runs long after the connection is gone, and a device
 * notification is not addressed to a connection at all.
 */
const parseSessionTargets = (value: unknown): SubscriptionTarget[] => {
    if (value === undefined || value === null) return SESSION_TARGETS;
    if (!Array.isArray(value) || value.length === 0)
        throw badRequest(
            'targets must be a non-empty array',
            'invalid_targets',
        );
    if (!value.every((target) => target === 'socket'))
        throw badRequest(
            'A session subscription may only target `socket`',
            'invalid_targets',
        );
    return SESSION_TARGETS;
};

const parseHandlerName = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.length === 0)
        throw badRequest('handlerName must be a string', 'bad_request');
    if (value.length > HANDLER_NAME_MAX_LENGTH)
        throw badRequest(
            `handlerName may not exceed ${HANDLER_NAME_MAX_LENGTH} characters`,
            'bad_request',
        );
    return value;
};

/** Hex digest of the inline source a subscribe claims it is binding. */
const parseHandlerHash = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
        throw badRequest(
            'handlerHash must be a sha-256 hex digest',
            'bad_request',
        );
    return value;
};

/** An app uid a user session names, for a surface with no app of its own. */
const parseAppUid = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string')
        throw badRequest('appUid must be a string', 'bad_request');
    return value;
};

/** Stored as JSON text; the byte cap is the store's to enforce. */
const parseContext = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        throw badRequest('context must be JSON-serializable', 'bad_request');
    }
};

/** Unix seconds or an ISO-8601 string, and it has to be in the future. */
const parseExpiresAt = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    const seconds =
        typeof value === 'number'
            ? Math.floor(value)
            : Math.floor(Date.parse(String(value)) / 1000);
    if (!Number.isFinite(seconds) || seconds <= Math.floor(Date.now() / 1000))
        throw badRequest(
            'expiresAt must be a future time',
            'invalid_expires_at',
        );
    return seconds;
};

export class EventsService extends PuterService {
    readonly #cache = new SubscriptionCache();
    readonly #deliveryAuth = new DeliveryAuthCache();
    readonly #compiled = new Map<string, CompiledMatch>();
    readonly #lookups = new Map<string, Promise<boolean>>();
    readonly #refreshTimers = new Map<string, ReturnType<typeof setInterval>>();
    #coalescer: DeliveryCoalescer<AddressedDelivery> | null = null;
    #expirySweep: ReturnType<typeof setInterval> | null = null;
    #expiryKick: ReturnType<typeof setTimeout> | null = null;
    #pendingSweep: ReturnType<typeof setInterval> | null = null;

    /**
     * What runs an app's handler. The default records the intent and settles
     * nothing, so a delivery handed to it stays owed until there is a real
     * invoker to take it.
     */
    worker: WorkerInvokerSeam = new RecordingWorkerInvoker();

    // -- Lifecycle ---------------------------------------------------

    override onServerStart(): void {
        this.clients.event.on(
            'outer.events.generationBumped',
            (_key, data, meta) => {
                // Our own emit reaches local listeners too, and that half has
                // already been applied.
                if (!(meta as { from_outside?: boolean })?.from_outside) return;
                const { userId, durable } = (data ?? {}) as {
                    userId?: number;
                    durable?: boolean;
                };
                if (typeof userId !== 'number') return;
                this.invalidateUser(userId, { rebuild: durable === true });
            },
        );

        // The delivery re-check would already deny these, but a row nobody can
        // deliver to still holds an anchor slot, still bills, and still costs a
        // filter evaluation on every event under it.
        this.clients.event.on('permission.revoked', (_key, data) => {
            void this.settleRevokedGrant(data as RevokedGrant).catch((err) => {
                console.warn('[events] revocation settle failed', err);
            });
        });

        // The KV store is a store, so the bus is the only seam it has to reach
        // a service. Same posture as the FS hook: post-commit, and nothing here
        // can fail the write that produced it.
        this.clients.event.on('kv.mutated', (_key, data) => {
            void this.dispatchKv(data as KvDispatchInput).catch((err) => {
                console.warn('[events] kv dispatch failed', err);
            });
        });

        this.#armExpirySweep();
        this.#armPendingSweep();
    }

    override onServerPrepareShutdown(): void {
        if (this.#expiryKick) clearTimeout(this.#expiryKick);
        this.#expiryKick = null;
        if (this.#expirySweep) clearInterval(this.#expirySweep);
        this.#expirySweep = null;
        if (this.#pendingSweep) clearInterval(this.#pendingSweep);
        this.#pendingSweep = null;
    }

    override onServerShutdown(): void {
        for (const timer of this.#refreshTimers.values()) clearInterval(timer);
        this.#refreshTimers.clear();
    }

    /** The master switch. Read on every write, so it stays a field lookup. */
    get enabled(): boolean {
        return this.config.events?.enabled === true;
    }

    /**
     * Whether a subscription may name another app's KV namespace. Off by
     * default; the gate below runs either way, so turning it on adds no
     * unchecked path.
     */
    get crossAppKvEnabled(): boolean {
        return this.config.events?.crossAppKv === true;
    }

    // -- Socket surface ----------------------------------------------

    /**
     * Install the subscription verbs on one connection. Session subscriptions
     * are per-socket by construction: they are addressed to this socket's id,
     * and they leave when it does.
     */
    attachSocket(socket: EventSocket, actor: Actor): void {
        const userId = actor.user?.id;
        if (userId === undefined) return;

        socket.on(EVENTS_SUBSCRIBE_VERB, ((
            payload: SubscribeRequest,
            ack: unknown,
        ) => {
            void this.#answer(ack, () =>
                this.subscribe(actor, socket.id, payload),
            );
        }) as (...args: never[]) => void);

        socket.on(EVENTS_UNSUBSCRIBE_VERB, ((
            payload: UnsubscribeRequest,
            ack: unknown,
        ) => {
            void this.#answer(ack, async () => {
                await this.unsubscribe(actor, socket.id, payload);
                return {};
            });
        }) as (...args: never[]) => void);

        socket.on(EVENTS_ACK_VERB, ((payload: AckRequest, ack: unknown) => {
            void this.#answer(ack, async () => {
                await this.ackDelivery(actor, payload);
                return {};
            });
        }) as (...args: never[]) => void);

        socket.once('disconnect', (() => {
            void this.reapSocket(userId, socket.id);
        }) as (...args: never[]) => void);
    }

    async #answer<T extends object>(
        ack: unknown,
        run: () => Promise<T>,
    ): Promise<void> {
        const respond =
            typeof ack === 'function'
                ? (ack as (response: unknown) => void)
                : undefined;
        try {
            const result = await run();
            respond?.({ ok: true, ...result });
        } catch (err) {
            if (!respond) {
                console.warn('[events] subscription verb failed', err);
                return;
            }
            respond(errorAck(err));
        }
    }

    // -- Subscribe / unsubscribe -------------------------------------

    async subscribe(
        actor: Actor,
        socketId: string,
        request: SubscribeRequest,
    ): Promise<{ sub: SubscriptionView }> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        await this.#spendCallBudget(holderUserId);

        const targets = parseSessionTargets(request?.targets);
        const rawSubject = String(request?.subject ?? '');
        const anchor = await this.#resolveSubscribeAnchor(actor, rawSubject);

        const sub: SessionSubscription = {
            subId: randomUUID(),
            socketId,
            holderUserId,
            ownerUserId: anchor.ownerUserId,
            subject: anchor.subject,
            token: anchor.token,
            anchorUid: anchor.uid,
            anchorPath: anchor.path,
            match: anchor.match,
            op: anchor.op,
            appUid: actor.effectiveApp?.uid ?? null,
            permission: anchor.permission,
            targets,
        };

        const bump = await this.stores.eventSubscription.add(sub);
        this.#publishGeneration(bump, false);
        this.#startRefresh(holderUserId, socketId);

        return { sub: toView(sub) };
    }

    async unsubscribe(
        actor: Actor,
        socketId: string,
        request: UnsubscribeRequest,
    ): Promise<void> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        await this.#spendCallBudget(holderUserId);

        const subId = String(request?.subId ?? '');
        if (!subId) throw unknownSubscription();

        const sub = await this.stores.eventSubscription.getForSocket(
            holderUserId,
            socketId,
            subId,
        );
        // An id this socket never held — or one another app created — reads as
        // absent rather than refused: a 403 here is an oracle for subIds.
        if (!sub || !rowInActorScope(actor, sub)) throw unknownSubscription();

        const bump = await this.stores.eventSubscription.remove(sub);
        this.#forget(subId);
        this.#publishGeneration(bump, false);
    }

    /** What this actor holds on one connection, scoped to what it may see. */
    async listSubscriptions(
        actor: Actor,
        socketId: string,
    ): Promise<SubscriptionView[]> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        const held = await this.stores.eventSubscription.listForSocket(
            holderUserId,
            socketId,
        );
        return held.filter((sub) => rowInActorScope(actor, sub)).map(toView);
    }

    // -- Durable subscriptions ---------------------------------------

    /**
     * Register a subscription that outlives the connection that made it. Same
     * subject resolution and same ACL check as the session verb — what differs
     * is where the row lands and who it is later addressed as.
     */
    async subscribeDurable(
        actor: Actor,
        request: DurableSubscribeRequest,
    ): Promise<{ sub: DurableSubscriptionView }> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        await this.#spendCallBudget(holderUserId);

        const delivery = parseDelivery(request?.delivery);
        const appUid = actor.effectiveApp?.uid ?? null;
        const targets = parseTargets(request?.targets, delivery, appUid);
        const handlerName = parseHandlerName(request?.handlerName);
        const handlerHash = parseHandlerHash(request?.handlerHash);
        const context = parseContext(request?.context);
        const expiresAt = parseExpiresAt(request?.expiresAt);

        // A `single` is owed to exactly one consumer, and the handler is the
        // only one that is always there to take it.
        if (delivery === 'single' && !handlerName) throw handlerRequired();

        if (handlerName)
            await this.#assertHandlerBinding(appUid, handlerName, handlerHash);

        const rawSubject = String(request?.subject ?? '');
        const anchor = await this.#resolveSubscribeAnchor(actor, rawSubject);

        const { row, bump } = await this.stores.durableSubscription.create({
            holderUserId,
            ownerUserId: anchor.ownerUserId,
            appUid,
            subject: anchor.subject,
            token: anchor.token,
            anchorUid: anchor.uid,
            anchorPath: anchor.path,
            match: anchor.match,
            op: anchor.op,
            delivery,
            targets,
            handlerName,
            context,
            permission: anchor.permission,
            expiresAt,
        });
        this.#publishGeneration(bump, true);

        return { sub: toDurableView(row) };
    }

    /**
     * What this actor holds durably. An app-context actor is confined to its
     * own rows by the index the query runs on; an account-context one sees
     * across apps, which is what makes the account the revoke surface for a row
     * whose app is long gone.
     */
    async listDurable(
        actor: Actor,
        request: DurableListRequest = {},
    ): Promise<PageResult<DurableSubscriptionView>> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        const app = actor.effectiveApp;
        // Unresolved is not "no app" — reading it that way is what would hand
        // an app the account-wide view.
        if (app === undefined) return { items: [] };

        const page = await this.stores.durableSubscription.listForHolder(
            holderUserId,
            {
                appUid: app?.uid ?? null,
                limit: request.limit,
                cursor: request.cursor,
                includeTotal: request.includeTotal,
            },
        );
        return {
            items: page.items.map(toDurableView),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        };
    }

    async unsubscribeDurable(
        actor: Actor,
        request: UnsubscribeRequest,
    ): Promise<void> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        await this.#spendCallBudget(holderUserId);

        const subId = String(request?.subId ?? '');
        if (!subId) throw unknownSubscription();

        const row = await this.stores.durableSubscription.getBySubId(subId);
        // Someone else's id — or one another app created — reads as absent
        // rather than refused: a 403 here is an oracle for subIds.
        if (
            !row ||
            row.holderUserId !== holderUserId ||
            !rowInActorScope(actor, row)
        )
            throw unknownSubscription();

        const bump = await this.stores.durableSubscription.remove(row);
        // Whatever it was still owed goes with it: a backlog held for a
        // subscription nobody can consume is memory, and the paths it names are
        // ones its holder just gave up asking about.
        await this.stores.pendingDelivery.purge(subId);
        this.#forget(subId);
        this.#publishGeneration(bump, true);
    }

    /**
     * Settle a `single` delivery the client took. An id this subscription is
     * not holding — one already settled, or one reclaimed and handed on — is
     * not an error: at-least-once makes a duplicate ack routine.
     */
    async ackDelivery(actor: Actor, request: AckRequest): Promise<void> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();

        const subId = String(request?.subId ?? '');
        const entryId = String(request?.id ?? '');
        if (!subId || !entryId) throw unknownSubscription();

        const ok = await checkRateLimit(
            `${EVENTS_ACK_LIMIT.scope}:${holderUserId}`,
            EVENTS_ACK_LIMIT.limit,
            EVENTS_ACK_LIMIT.window,
        );
        if (!ok) throw tooManyCalls();

        const row = await this.stores.durableSubscription.getBySubId(subId);
        if (
            !row ||
            row.holderUserId !== holderUserId ||
            !rowInActorScope(actor, row)
        )
            throw unknownSubscription();

        await this.stores.pendingDelivery.settle(subId, entryId);
        await this.#drain(row);
    }

    // -- Handlers ----------------------------------------------------

    /**
     * Publish one named handler for an app.
     *
     * The name is the identity and the hash is only a change detector, so
     * re-publishing the same source is a no-op and re-publishing a name that is
     * suspending subscriptions brings them back. A publish whose base has moved
     * under it — two build steps racing — is refused rather than resolved.
     */
    async publishHandler(
        actor: Actor,
        request: PublishHandlerRequest,
    ): Promise<PublishedHandlerView> {
        await this.#spendHandlerBudget(actor);
        const appUid = await this.#handlerApp(actor, request?.appUid);
        return this.#publishOne(appUid, request);
    }

    /**
     * Publish a set of handlers, which is what a build step has. Each item is
     * the same operation under the same rules; one that is refused stops the
     * pass, so a deploy either lands its set or reports which name it stopped
     * at rather than leaving half a build published under a success.
     */
    async publishHandlers(
        actor: Actor,
        request: PublishHandlersRequest,
    ): Promise<PublishedHandlerView[]> {
        await this.#spendHandlerBudget(actor);
        const appUid = await this.#handlerApp(actor, request?.appUid);
        const handlers = request?.handlers;
        if (!Array.isArray(handlers) || handlers.length === 0)
            throw badRequest(
                'handlers must be a non-empty array',
                'bad_request',
            );
        if (handlers.length > EVENTS_HANDLER_PUBLISH_BATCH)
            throw badRequest(
                `handlers may not exceed ${EVENTS_HANDLER_PUBLISH_BATCH} entries`,
                'bad_request',
            );

        const published: PublishedHandlerView[] = [];
        for (const item of handlers) {
            if (!item || typeof item !== 'object' || Array.isArray(item))
                throw badRequest(
                    'each handler must be an object',
                    'bad_request',
                );
            published.push(
                await this.#publishOne(appUid, item as PublishHandlerRequest),
            );
        }
        return published;
    }

    /**
     * What an app has published, and how many subscriptions each name carries.
     * Never the source: a listing is the one handler surface that can be called
     * repeatedly, and the source is the app's own code.
     */
    async listHandlers(
        actor: Actor,
        request: HandlerScopeRequest = {},
    ): Promise<EventHandlerSummary[]> {
        return this.stores.eventHandler.listForApp(
            await this.#handlerApp(actor, request?.appUid),
        );
    }

    /**
     * Take a name out of service. With nothing bound to it the row simply goes;
     * with dependents it goes too, and they suspend with `handler_not_found`
     * rather than being deleted — republishing the name is what brings them
     * back, so a bad deploy is recoverable and a rename is deliberately not.
     */
    async removeHandler(
        actor: Actor,
        request: HandlerNameRequest,
    ): Promise<RemovedHandlerView> {
        await this.#spendHandlerBudget(actor);
        const appUid = await this.#handlerApp(actor, request?.appUid);
        const name = parseHandlerName(request?.name);
        if (!name) throw badRequest('name is required', 'bad_request');

        const removed = await this.stores.eventHandler.remove(appUid, name);
        const suspended = await this.#suspendHandlerDependents(appUid, name);
        return { name, removed: removed !== null, suspended };
    }

    // -- Suspension --------------------------------------------------

    /**
     * Take rows out of service without deleting them, and do to their backlogs
     * whatever the reason says. Every suspension goes through here so the
     * backlog policy cannot be forgotten at one call site: a suspended
     * subscription stops being metered, and one that stops being metered while
     * holding a full backlog is a hold nobody pays for.
     */
    async suspendSubscriptions(
        rows: readonly DurableSubscription[],
        reason: SuspendedReason,
    ): Promise<number> {
        return (await this.#suspend(rows, reason)).length;
    }

    /**
     * The rows this pass was the one to suspend. An unshare withdraws several
     * grant strings in a row and every one of them settles, so a row another
     * pass already took is not this pass's to purge or announce.
     */
    async #suspend(
        rows: readonly DurableSubscription[],
        reason: SuspendedReason,
    ): Promise<DurableSubscription[]> {
        if (rows.length === 0) return [];

        const { suspended, bumps } =
            await this.stores.durableSubscription.suspend(rows, reason);
        const policy = backlogPolicyFor(reason);
        for (const row of suspended) {
            try {
                if (policy.cap === 0)
                    await this.stores.pendingDelivery.purge(row.subId);
                else {
                    const shed = await this.stores.pendingDelivery.hold(
                        row.subId,
                        policy.cap,
                        policy.ttlMs,
                    );
                    if (shed) this.#reportShed([shed]);
                }
            } catch (err) {
                console.warn(
                    '[events] could not settle the backlog of a suspended subscription',
                    row.subId,
                    err,
                );
            }
            // Takes any coalesced delivery with it: one still in flight is for
            // a subscription that has stopped.
            this.#forget(row.subId);
        }
        for (const bump of bumps) this.#publishGeneration(bump, true);
        return suspended;
    }

    /**
     * Put rows back in service, and hand over what survived their hold. Rows
     * suspended for a reason that never lifts are skipped: consent to watch is
     * re-established by subscribing again, never by resuming.
     */
    async resumeSubscriptions(
        rows: readonly DurableSubscription[],
    ): Promise<number> {
        const resuming = rows.filter(
            (row) =>
                row.suspendedAt !== null &&
                isSuspendedReason(row.suspendedReason) &&
                isResumable(row.suspendedReason),
        );
        if (resuming.length === 0) return 0;

        const bumps = await this.stores.durableSubscription.resume(resuming);
        for (const row of resuming) {
            try {
                await this.stores.pendingDelivery.releaseHold(row.subId);
                await this.#drain(row);
            } catch (err) {
                console.warn(
                    '[events] could not hand over the backlog of a resumed subscription',
                    row.subId,
                    err,
                );
            }
        }
        for (const bump of bumps) this.#publishGeneration(bump, true);
        return resuming.length;
    }

    /**
     * Stop one subscription after its handler kept failing. The counting is the
     * retry path's; this is the state it drives, and the developer is told
     * because it is their code that stopped working.
     */
    async suspendForFailures(subId: string): Promise<boolean> {
        return this.#suspendOne(subId, 'failures', { notifyDeveloper: true });
    }

    /**
     * Stop one subscription whose holder cannot pay for it. The 402 is the
     * metering path's to raise; the backlog is held on the short window,
     * because the resume condition is usually a top-up minutes away.
     */
    async suspendForNoCredit(subId: string): Promise<boolean> {
        return this.#suspendOne(subId, 'no_credit', { notifyDeveloper: false });
    }

    /**
     * Put back what a restored balance releases. The seam credit restoration
     * calls: one holder's rows, one pass, and nothing else has to know how a
     * suspension is spelled.
     */
    async resumeForCredit(holderUserId: number): Promise<number> {
        if (!this.enabled) return 0;
        return this.resumeSubscriptions(
            await this.stores.durableSubscription.listSuspendedForHolder(
                holderUserId,
                'no_credit',
            ),
        );
    }

    /**
     * Drop rows past their expiry, in batches, and report how many went. Every
     * node sweeps; the delete is idempotent, so two overlapping costs a few
     * empty batches rather than correctness.
     */
    async sweepExpired(): Promise<number> {
        if (!this.enabled) return 0;
        return this.#sweepInBatches((batchSize) =>
            this.stores.durableSubscription.sweepExpired(batchSize),
        );
    }

    /**
     * Drop rows that have been suspended longer than they are worth keeping. A
     * revoked subscription never resumes, so the row survives only as the
     * answer its holder gets from `list` when they ask why it stopped.
     */
    async sweepSuspended(): Promise<number> {
        if (!this.enabled) return 0;
        const cutoff =
            Math.floor(Date.now() / 1000) -
            SUSPENDED_ROW_TTL_DAYS * 24 * 60 * 60;
        return this.#sweepInBatches((batchSize) =>
            this.stores.durableSubscription.sweepSuspended(cutoff, batchSize),
        );
    }

    async #sweepInBatches(
        pass: (batchSize: number) => Promise<number>,
    ): Promise<number> {
        let removed = 0;
        for (let i = 0; i < EXPIRY_MAX_BATCHES; i++) {
            const batch = await pass(EXPIRY_BATCH_SIZE);
            removed += batch;
            if (batch < EXPIRY_BATCH_SIZE) break;
        }
        return removed;
    }

    /**
     * Retry what nobody took. Reads the pending index from its oldest end — the
     * subscriptions that have waited longest — so finding the work costs one
     * ordered read rather than a walk of the keyspace, which is exactly the
     * thing that gets expensive when there is a backlog to find.
     *
     * A lease that lapsed is what makes a delivery claimable again, so this
     * needs no notion of failure: it retries whatever is not currently held.
     */
    async sweepPending(): Promise<number> {
        if (!this.enabled) return 0;

        // A partial write can move a pending set without its share of the
        // region counter going with it, in either direction. This is what
        // keeps that drift from being permanent.
        await this.stores.pendingDelivery
            .reconcileRegionDepth()
            .catch((err) => {
                console.warn('[events] pending counter reconcile failed', err);
            });

        let attempted = 0;
        for (const { subId } of await this.stores.pendingDelivery.head(
            PENDING_SWEEP_SUBSCRIPTIONS,
        )) {
            try {
                const row =
                    await this.stores.durableSubscription.getBySubId(subId);
                // Nothing left to deliver to, so nothing left to hold.
                if (!row || this.#isOver(row)) {
                    await this.stores.pendingDelivery.purge(subId);
                    continue;
                }
                // A suspended row is not delivered to, but the backlog its
                // suspension put a deadline on is this pass's to enforce: past
                // it the events go and a gap marker says so, which is the half
                // that keeps a suspension from being a free memory hold.
                if (row.suspendedAt !== null) {
                    // Except a revoked row's, which names paths its holder may
                    // no longer see: anything a dispatch in flight queued after
                    // the settle's own purge goes now, not at a deadline.
                    if (row.suspendedReason === 'permission_revoked')
                        await this.stores.pendingDelivery.purge(subId);
                    else await this.stores.pendingDelivery.expireHold(subId);
                    continue;
                }
                attempted += await this.#drain(row);
            } catch (err) {
                console.warn('[events] pending sweep failed', subId, err);
            }
        }
        return attempted;
    }

    /** Past its expiry, so the daily reaper is only a matter of time. */
    #isOver(row: DurableSubscription): boolean {
        return row.expiresAt !== null && row.expiresAt <= Date.now() / 1000;
    }

    // -- Handler internals -------------------------------------------

    /**
     * Which app's handlers this call is about, and whether the caller may
     * deploy them. Publishing is a developer operation: the app token's own app
     * or the one a user session named, and in both cases an app that user
     * owns.
     *
     * An app that is not there answers the same as one the caller does not own
     * — which apps exist is not this surface's to disclose.
     */
    async #handlerApp(actor: Actor, requested: unknown): Promise<string> {
        if (!this.enabled) throw disabled();
        const userId = actor.user?.id;
        if (userId === undefined) throw disabled();

        const acting = actor.effectiveApp;
        // Unresolved is not "no app": reading it that way is what would let an
        // app token publish into a namespace it never named.
        if (acting === undefined) throw handlerAppForbidden();

        const named = parseAppUid(requested);
        if (acting && named !== null && named !== acting.uid)
            throw handlerAppForbidden();

        const appUid = acting?.uid ?? named;
        if (!appUid) throw handlerAppRequired();

        const app = await this.stores.app.getByUid(appUid);
        if (!app) throw handlerAppForbidden();
        if (
            Number((app as { owner_user_id?: unknown }).owner_user_id) !==
            Number(userId)
        )
            throw handlerAppForbidden();
        return appUid;
    }

    async #spendHandlerBudget(actor: Actor): Promise<void> {
        const userId = actor.user?.id;
        if (userId === undefined) throw disabled();
        const ok = await checkRateLimit(
            `${EVENTS_HANDLER_PUBLISH_LIMIT.scope}:${userId}`,
            EVENTS_HANDLER_PUBLISH_LIMIT.limit,
            EVENTS_HANDLER_PUBLISH_LIMIT.window,
        );
        if (!ok) throw tooManyCalls();
    }

    /** One publish, and whatever it releases. */
    async #publishOne(
        appUid: string,
        item: PublishHandlerRequest,
    ): Promise<PublishedHandlerView> {
        const { handler, outcome } = await this.stores.eventHandler.publish({
            appUid,
            name: String(item?.name ?? ''),
            source: typeof item?.source === 'string' ? item.source : '',
            ifHash: typeof item?.ifHash === 'string' ? item.ifHash : null,
            replace: item?.replace === true,
        });

        return {
            name: handler.name,
            hash: handler.sourceHash,
            updatedAt: handler.updatedAt,
            outcome,
            resumed: await this.#resumeHandlerDependents(appUid, handler.name),
        };
    }

    /**
     * Suspend everything bound to a name that is no longer published, in
     * batches so a widely-used handler cannot make one call hold the whole
     * set.
     */
    async #suspendHandlerDependents(
        appUid: string,
        name: string,
    ): Promise<number> {
        let suspended = 0;
        for (;;) {
            const batch = await this.stores.durableSubscription.listByHandler(
                appUid,
                name,
            );
            if (batch.length === 0) break;
            suspended += await this.suspendSubscriptions(
                batch,
                'handler_not_found',
            );
            if (batch.length < HANDLER_SETTLE_BATCH) break;
        }
        if (suspended > 0) await this.#notifySuspended(appUid, name, suspended);
        return suspended;
    }

    /** Bring back what was waiting on this name. The other half of a removal. */
    async #resumeHandlerDependents(
        appUid: string,
        name: string,
    ): Promise<number> {
        let resumed = 0;
        for (;;) {
            const batch = await this.stores.durableSubscription.listByHandler(
                appUid,
                name,
                { suspendedReason: 'handler_not_found' },
            );
            if (batch.length === 0) break;
            resumed += await this.resumeSubscriptions(batch);
            if (batch.length < HANDLER_SETTLE_BATCH) break;
        }
        return resumed;
    }

    /** One row into a suspended state, for the reasons a single row reaches. */
    async #suspendOne(
        subId: string,
        reason: SuspendedReason,
        options: { notifyDeveloper: boolean },
    ): Promise<boolean> {
        if (!this.enabled) return false;
        const row = await this.stores.durableSubscription.getBySubId(subId);
        if (!row || row.suspendedAt !== null) return false;

        await this.suspendSubscriptions([row], reason);
        if (options.notifyDeveloper && row.appUid && row.handlerName)
            await this.#notifySuspended(row.appUid, row.handlerName, 1);
        return true;
    }

    /**
     * Tell an app's developer that subscriptions on one of their handlers have
     * stopped. Theirs rather than the holder's: the handler is the developer's
     * code, and the fix is a publish only they can make.
     */
    async #notifySuspended(
        appUid: string,
        handlerName: string,
        subscriptions: number,
    ): Promise<void> {
        try {
            const app = await this.stores.app.getByUid(appUid);
            const ownerUserId = Number(
                (app as { owner_user_id?: unknown } | null)?.owner_user_id,
            );
            if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) return;

            await this.services.notification.notify(
                [ownerUserId],
                {
                    title: 'Event subscriptions were suspended',
                    handler: handlerName,
                    subscriptions,
                },
                { type: 'app.events.suspended', appUid },
            );
        } catch (err) {
            console.warn(
                '[events] could not report a suspended handler',
                handlerName,
                err,
            );
        }
    }

    /**
     * Whether a subscription may bind the handler name it asked for.
     *
     * Handlers are published per app, so an account-scoped row has no namespace
     * to bind in — the name is stored and binds nothing. An inline body is
     * different: sending a hash _is_ the binding claim, and there is nothing
     * for it to match.
     */
    async #assertHandlerBinding(
        appUid: string | null,
        name: string,
        hash: string | null,
    ): Promise<void> {
        if (appUid === null) {
            if (hash !== null) throw handlerNotFound(name);
            return;
        }

        const published = await this.stores.eventHandler.getByName(
            appUid,
            name,
        );
        if (!published) throw handlerNotFound(name);
        if (hash !== null && hash !== published.sourceHash)
            throw handlerHashMismatch(name);
    }

    /**
     * Resolve, authorize and compile one subscribe request. Shared so a durable
     * row cannot be created under a weaker check than a session one.
     */
    async #resolveSubscribeAnchor(
        actor: Actor,
        rawSubject: string,
    ): Promise<ResolvedAnchor> {
        const parsed = parseSubject(rawSubject);
        if (parsed.family === 'kv')
            return this.#resolveKvSubscribe(actor, parsed);
        if (parsed.family !== 'fs')
            throw new HttpError(
                400,
                `Subject family not subscribable yet: ${parsed.family}`,
                { legacyCode: 'invalid_subject' },
            );

        const anchor = await resolveFsAnchor(parsed, this.#anchorDeps(), {
            username: actor.user?.username,
        });

        // The resolver answers where a subscription keys, not whose it is, so
        // the owner comes from the anchor node itself — and that is the
        // keyspace the row is indexed in, because dispatch only ever knows
        // whose resource changed.
        const entry = await resolveNode(this.stores.fsEntry, {
            uid: anchor.uid,
        });
        if (!entry)
            throw new HttpError(404, `No such entry: ${anchor.path}`, {
                legacyCode: 'subject_does_not_exist',
            });

        const permission = await assertSubscribeAuthorized(
            actor,
            { uid: anchor.uid, path: anchor.path },
            rawSubject,
            this.#aclDeps(),
        );

        // Compile now so an unusable pattern fails this call rather than every
        // event under the anchor.
        if (anchor.match) compileMatch(anchor.match);

        return {
            ...anchor,
            ownerUserId: entry.userId,
            permission,
            subject: rawSubject,
        };
    }

    /**
     * Resolve and authorize a `kv:` subject.
     *
     * Nothing is looked up: the namespace comes from the actor, so a key that
     * does not exist yet is an ordinary subscription rather than a missing
     * anchor. The keyspace is the namespace's user — which is the subscriber,
     * because a KV namespace is one user's data for one app, cross-app
     * included.
     */
    async #resolveKvSubscribe(
        actor: Actor,
        parsed: ParsedSubject,
    ): Promise<ResolvedAnchor> {
        const user = actor.user;
        if (!user) throw disabled();

        const anchor = resolveKvAnchor(parsed, {
            userUuid: user.uuid,
            appUid: actor.effectiveApp?.uid ?? null,
        });

        // Own namespace never reaches a permission lookup — the same
        // self-access shortcut a cross-app KV read takes.
        if (anchor.crossApp)
            await assertCrossAppKvAuthorized(
                actor,
                anchor.appUid,
                this.#kvDeps(),
            );

        if (anchor.match)
            compileMatch(anchor.match, { separator: KV_MATCH_SEPARATOR });

        return {
            token: anchor.token,
            uid: anchor.appUid,
            path: anchor.prefix,
            match: anchor.match,
            op: null,
            ownerUserId: user.id,
            // The column wants a mode; a KV row's re-check is the cross-app
            // gate rather than an ACL reading, so nothing reads this back.
            permission: SUBSCRIBE_MODE,
            subject: anchor.subject,
        };
    }

    /** Disconnect handler; also covers a socket the server dropped. */
    async reapSocket(holderUserId: number, socketId: string): Promise<void> {
        // Nothing could have been registered, so nothing has to be looked up.
        // A switch flipped off under live subscriptions leaves them to the TTL.
        if (!this.enabled) return;
        this.#stopRefresh(holderUserId, socketId);
        try {
            const held = await this.stores.eventSubscription.listForSocket(
                holderUserId,
                socketId,
            );
            for (const sub of held) this.#forget(sub.subId);

            const bumps = await this.stores.eventSubscription.reapSocket(
                holderUserId,
                socketId,
            );
            for (const bump of bumps) this.#publishGeneration(bump, false);
        } catch (err) {
            // The TTL backstop exists for exactly this.
            console.warn('[events] failed to reap socket subscriptions', err);
        }
    }

    // -- Dispatch ----------------------------------------------------

    /**
     * Publish one committed filesystem change. Never throws, and no write ever
     * waits on it.
     */
    async dispatchFs(
        key: EventKey,
        entry: FSEntry,
        options: FsDispatchOptions = {},
    ): Promise<void> {
        if (!this.enabled) return;

        const subject = lookupFsSubject(key);
        if (!subject) return;

        const ownerUserId = entry?.userId;
        if (typeof ownerUserId !== 'number') return;

        if (!(await this.#userHasAny(ownerUserId))) return;

        const ancestors = options.ancestors ? await options.ancestors() : [];
        const context: FsEventContext = {
            key,
            entry,
            ancestors,
            id: randomUUID(),
            ts: Date.now(),
        };

        const watched = await this.stores.eventSubscription.watchedTokens(
            ownerUserId,
            subject.tokens(context),
        );
        if (watched.length === 0) return;

        const rows = await this.stores.eventSubscription.getForTokens(
            ownerUserId,
            watched,
        );
        if (rows.length === 0) return;

        await this.#route(
            subject,
            context,
            rows,
            options.actingUserId,
            (matched) => this.#stillAuthorized(matched, context),
        );

        // Only a removal can invalidate an anchor, so nothing else pays for
        // this — and this pass is already holding the rows that key on the uid
        // now gone.
        if (key === 'fs.remove.node')
            await this.#settleDeletedAnchor(context, rows);
    }

    /**
     * Publish one committed key-value change. Same three gates as an FS write,
     * keyed on the same thing: the owner of the namespace, which for KV is the
     * user whose data it is — cross-app subscriptions included, because an app
     * reaching another app's namespace still reaches it under its own user.
     *
     * A batch is one bus event over many keys, so the watched-set check is one
     * command for the whole batch rather than one per key.
     */
    async dispatchKv(input: KvDispatchInput): Promise<void> {
        if (!this.enabled) return;

        const subject = lookupKvSubject('kv.mutated');
        if (!subject) return;

        const ownerUserId = input?.userId;
        if (typeof ownerUserId !== 'number') return;
        if (!input.keys?.length) return;

        if (!(await this.#userHasAny(ownerUserId))) return;

        const namespace = parseKvNamespace(input.namespace);
        if (!namespace) return;

        const ts = Date.now();
        const contexts: KvEventContext[] = input.keys.map((kvKey) => ({
            key: 'kv.mutated',
            userUuid: namespace.userUuid,
            appUid: namespace.appUid,
            kvKey,
            op: input.op,
            id: randomUUID(),
            ts,
        }));

        const tokensPerKey = contexts.map((context) => subject.tokens(context));
        const watched = new Set(
            await this.stores.eventSubscription.watchedTokens(ownerUserId, [
                ...new Set(tokensPerKey.flat()),
            ]),
        );
        if (watched.size === 0) return;

        const rows = await this.stores.eventSubscription.getForTokens(
            ownerUserId,
            [...watched],
        );
        if (rows.length === 0) return;

        // Indexed once: a row holds one token, so a key's candidates are the
        // rows under the tokens it enumerated.
        const byToken = new Map<string, DispatchSubscription[]>();
        for (const row of rows)
            byToken.set(row.token, [...(byToken.get(row.token) ?? []), row]);

        for (const [i, context] of contexts.entries()) {
            const forKey = tokensPerKey[i].flatMap(
                (token) => byToken.get(token) ?? [],
            );
            if (forKey.length === 0) continue;

            await this.#route(
                subject,
                context,
                forKey,
                ownerUserId,
                (matched) => this.#kvStillAuthorized(matched, namespace.appUid),
            );
        }
    }

    async #route<C extends EventContextBase, P extends ProjectedEvent>(
        subject: SubjectSpec<C, P>,
        context: C,
        candidates: DispatchSubscription[],
        actingUserId: number | undefined,
        authorize: (
            rows: DispatchSubscription[],
        ) => Promise<DispatchSubscription[]>,
    ): Promise<void> {
        const rows = candidates.filter(deliverable);
        if (rows.length === 0) return;

        // One throwaway projection reads the op off the registry entry rather
        // than re-deriving it from the subject string.
        const delivery: C & DeliveryFields = {
            ...context,
            self: false,
            seq: 0,
        };
        const { op } = subject.project(delivery);
        const matchOn = subject.matchOn(context);

        const evaluated = evaluateWithCap(
            rows,
            (row) => this.#passes(row, subject, op, matchOn),
            FILTER_EVALUATIONS_PER_EVENT,
        );

        const matched = await authorize(
            evaluated.matched.slice(0, EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT),
        );

        let seq = 0;
        for (const row of matched) {
            const event = subject.project({
                ...context,
                self:
                    actingUserId === undefined ||
                    actingUserId === row.holderUserId,
                seq: seq++,
            });

            // A `single` is owed rather than sent: it is queued, and never
            // coalesced or broadcast — collapsing two of them would drop one
            // the subscription was promised.
            if (isSingle(row)) {
                await this.#owe(row, event);
                continue;
            }

            const targets = targetsOf(row);
            this.#coalesce().push(coalesceKey(row.subId, event.subject), {
                target: deliveryTarget(row),
                envelope: { subId: row.subId, event },
                socket: targets.includes('socket'),
                worker: this.#workerInvocation(row, event),
            });
        }

        // The marker goes to whoever lost the event, not to whoever received
        // it: rows a cap cut before they were delivered, and rows the
        // evaluation cap never reached — those may or may not have matched, and
        // over-reporting is the only safe direction when we cannot know. It is
        // itself capped, or a fan-out ceiling would be a fan-out of markers.
        const missed = [
            ...evaluated.matched.slice(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT),
            ...rows.slice(evaluated.evaluated),
        ].slice(0, EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT);
        if (missed.length === 0) return;

        this.#gap(
            missed,
            subject,
            context,
            evaluated.stoppedEarly
                ? 'filter_evaluation_limit'
                : 'matched_subscription_limit',
        );
    }

    /** Op filter first — a comparison, where the glob is not. */
    #passes(
        row: DispatchSubscription,
        subject: MatchSpec,
        op: SubjectOp,
        matchOn: string,
    ): boolean {
        if (row.op !== null && row.op !== op) return false;
        if (!row.match) return true;

        const scoped = subject.matchScope(row.anchorPath, matchOn);
        if (scoped === null) return false;
        return this.#matcherFor(row, subject.matchSeparator).test(scoped);
    }

    /**
     * Re-run each surviving row's access against the node the event is about,
     * not against its anchor: a filter that reaches into something the holder
     * cannot list must not deliver from it, and a share revoked after the
     * subscription was made must stop delivering at once rather than when the
     * row is next touched.
     *
     * Last of the filters, because it is the only one that can cost a lookup.
     * Two layers keep that lookup rare: the cross-event cache, keyed by the
     * permission cache's own generation, answers a subscription being written
     * to repeatedly without asking anything; and within one event, rows sharing
     * an identity and a grant share one decision — which is what a fan-out over
     * one folder is.
     */
    async #stillAuthorized(
        rows: DispatchSubscription[],
        context: FsEventContext,
    ): Promise<DispatchSubscription[]> {
        if (rows.length === 0) return rows;

        const node = this.#eventDescriptor(context);
        const identities = new Map<string, Promise<GrantIdentity | null>>();
        const decisions = new Map<string, Promise<boolean>>();
        const allowed = await Promise.all(
            rows.map((row) =>
                this.#recheck(row, node, context.entry.uid, {
                    identities,
                    decisions,
                }),
            ),
        );
        return rows.filter((_row, i) => allowed[i]);
    }

    async #recheck(
        row: DispatchSubscription,
        node: ResourceDescriptor,
        nodeUid: string,
        memo: {
            identities: Map<string, Promise<GrantIdentity | null>>;
            decisions: Map<string, Promise<boolean>>;
        },
    ): Promise<boolean> {
        const identityKey = `${row.holderUserId}|${row.appUid ?? ''}`;
        let identity = memo.identities.get(identityKey);
        if (!identity) {
            identity = this.#grantIdentity(row);
            memo.identities.set(identityKey, identity);
        }
        // An identity that cannot be resolved — a deleted app, a deleted user —
        // is one nothing may be delivered to.
        const resolved = await identity;
        if (!resolved) return false;

        const key = {
            subId: row.subId,
            generation: resolved.generation,
            nodeUid,
        };
        const cached = this.#deliveryAuth.read(key);
        if (cached !== null) return cached;

        const decisionKey = `${identityKey}|${row.permission}`;
        let decision = memo.decisions.get(decisionKey);
        if (!decision) {
            decision = checkDeliveryAuthorized(
                resolved.actor,
                row.permission,
                node,
                this.#aclDeps(),
            );
            memo.decisions.set(decisionKey, decision);
        }

        const allowed = await decision;
        this.#deliveryAuth.write(key, allowed);
        return allowed;
    }

    /**
     * The KV counterpart of the FS re-check. Own-namespace rows — which is
     * every row until cross-app is turned on — are decided by a string
     * comparison and cost nothing; only a row watching another app's namespace
     * asks anything, and rows sharing an identity and a target share the
     * answer.
     *
     * Deliberately not held in the cross-event cache: that cache keys on the
     * permission generation, and an app switching its data sharing off does not
     * move it. Asking each time is what makes that flip stop deliveries at
     * once.
     */
    async #kvStillAuthorized(
        rows: DispatchSubscription[],
        targetAppUid: string,
    ): Promise<DispatchSubscription[]> {
        if (rows.length === 0) return rows;

        const decisions = new Map<string, Promise<boolean>>();
        const allowed = await Promise.all(
            rows.map((row) => {
                if (!isCrossAppKvRow(row.appUid, targetAppUid))
                    return Promise.resolve(true);
                const key = `${row.holderUserId}|${row.appUid ?? ''}`;
                let decision = decisions.get(key);
                if (!decision) {
                    decision = this.#kvGrantHolds(row, targetAppUid);
                    decisions.set(key, decision);
                }
                return decision;
            }),
        );
        return rows.filter((_row, i) => allowed[i]);
    }

    /** Whether one row's holder may still be told about `targetAppUid`'s data. */
    async #kvGrantHolds(
        row: SubscriptionGrant,
        targetAppUid: string,
    ): Promise<boolean> {
        try {
            const actor = await resolveGrantActor(row, this.#aclDeps());
            if (!actor) return false;
            return (
                (await crossAppKvDenial(
                    actor,
                    targetAppUid,
                    this.#kvDeps(),
                )) === null
            );
        } catch {
            return false;
        }
    }

    /** Who a row acts as, and the counter its answers are keyed by. */
    async #grantIdentity(
        row: DispatchSubscription,
    ): Promise<GrantIdentity | null> {
        try {
            const deps = this.#aclDeps();
            const actor = await resolveGrantActor(row, deps);
            if (!actor) return null;
            return {
                actor,
                generation: await deliveryGenerationTag(actor, deps),
            };
        } catch {
            return null;
        }
    }

    /** The event's node as ACL wants it, reusing the walk dispatch already did. */
    #eventDescriptor(context: FsEventContext): ResourceDescriptor {
        return nodeDescriptor(
            { uid: context.entry.uid, path: context.entry.path },
            { getAncestorChain: async () => context.ancestors },
        );
    }

    #matcherFor(
        row: DispatchSubscription,
        separator: string | null,
    ): CompiledMatch {
        const cached = this.#compiled.get(row.subId);
        if (cached && cached.pattern === row.match) return cached;
        const compiled = compileMatch(row.match as string, { separator });
        this.#compiled.set(row.subId, compiled);
        return compiled;
    }

    #gap(
        rows: DispatchSubscription[],
        subject: { subject: string },
        context: EventContextBase,
        reason: GapReason,
    ): void {
        for (const row of rows) {
            const marker: GapMarker = {
                id: context.id,
                subject: subject.subject,
                op: 'gap',
                reason,
                ts: context.ts,
            };
            // A marker is a delivery, so it takes the same route its
            // subscription's events would: queued for a `single`, sent for the
            // rest.
            if (isSingle(row)) {
                void this.#owe(row, marker);
                continue;
            }
            // A marker rides the socket; a row with none has nowhere to hear
            // it, and sending nothing must not count as a delivery.
            if (!targetsOf(row).includes('socket')) continue;
            this.#send({
                target: deliveryTarget(row),
                socket: true,
                envelope: { subId: row.subId, event: marker },
            });
        }
    }

    // -- Settling ----------------------------------------------------

    /**
     * Take out of service every durable subscription a withdrawn grant was
     * holding up. One holder-index read per revocation, not one per row.
     *
     * The delivery re-check already refuses these, so this is not what makes a
     * revocation safe — it is what keeps a revoked subscription from going on
     * costing its holder an anchor slot, a daily line and a filter evaluation
     * per event forever. Re-granting does not bring one back: the consent to
     * watch is re-established by subscribing again.
     *
     * Session rows are left to the re-check: finding them means knowing which
     * connections a holder has, which is a keyspace scan, and one that ends
     * with the connection anyway.
     */
    async settleRevokedGrant(revocation: RevokedGrant): Promise<number> {
        if (!this.enabled) return 0;

        const held = await this.stores.durableSubscription.listActiveForHolder(
            revocation.holderUserId,
            revocation.appUid,
        );
        // Withdrawing an app's access wholesale is the user saying the app is
        // done, so it takes everything the app holds — no per-row question,
        // and none of the standing exemptions an app enjoys over its own data
        // keep a background subscription alive past the consent that made it.
        const settling =
            revocation.permission === null
                ? held
                : await this.#leftUnauthorized(held, revocation.permission);
        if (settling.length === 0) return 0;

        // The `permission_revoked` arm of the shared policy purges the backlog
        // at once: it holds the paths of a resource its holder has just lost
        // the right to see, and keeping it for a resume that by design never
        // comes turns a revocation into a delayed disclosure.
        const suspended = await this.#suspend(settling, 'permission_revoked');
        await this.#notifyEnded(suspended, 'permission_revoked');
        return suspended.length;
    }

    /**
     * Of a holder's rows, the ones a named withdrawn grant has actually left
     * without access.
     *
     * Two steps, and both are needed. The first is implication-aware rather
     * than string equality: a row's anchor and stored mode compose the
     * permission its subscribe check ran against, and `list` is answered by
     * `read`, `write` and `manage`, so withdrawing any of them puts the row in
     * question. That only narrows, though — the second step asks the access
     * question for real, because a share whose mode merely _changed_ is
     * recorded as a grant followed by a revoke, and settling on the revoke
     * alone would end a subscription whose reach just got wider.
     *
     * A grant withdrawn on an _ancestor_ of an anchor is not narrowed to here —
     * the row names its own node, not the chain above it. Those are left to the
     * delivery re-check, which stops them immediately and permanently.
     */
    async #leftUnauthorized(
        rows: readonly DurableSubscription[],
        permission: string,
    ): Promise<DurableSubscription[]> {
        const settling: DurableSubscription[] = [];
        for (const row of rows) {
            const covered = isKvToken(row.token)
                ? crossAppKvPermissions(row.anchorUid).includes(permission)
                : this.services.acl
                      .permissionsFor(row.anchorUid, row.permission)
                      .includes(permission);
            if (covered && !(await this.#anchorStillReachable(row)))
                settling.push(row);
        }
        return settling;
    }

    /** Whether a row's holder can still reach its anchor, asked fresh. */
    async #anchorStillReachable(row: DurableSubscription): Promise<boolean> {
        if (isKvToken(row.token)) {
            if (!isCrossAppKvRow(row.appUid, row.anchorUid)) return true;
            return this.#kvGrantHolds(row, row.anchorUid);
        }
        return this.#reachable(row, row);
    }

    /**
     * Whether a row's holder may watch from `at`, under the mode it subscribed
     * with.
     */
    async #reachable(
        row: DispatchSubscription,
        at: { anchorUid: string; anchorPath: string },
    ): Promise<boolean> {
        const deps = this.#aclDeps();
        const actor = await resolveGrantActor(row, deps);
        if (!actor) return false;
        return checkDeliveryAuthorized(
            actor,
            row.permission,
            nodeDescriptor({ uid: at.anchorUid, path: at.anchorPath }, deps),
            deps,
        );
    }

    /**
     * Move a path-form row up to the nearest surviving ancestor its holder may
     * still watch, or end it. Asked again after each move: a recursive delete
     * works from the leaves up, so the level just moved to may be gone by the
     * time the row is written there — and its own removal pass ran before the
     * row was visible on it.
     */
    async #carryForward(
        row: DispatchSubscription,
        ancestors: ReadonlyArray<{ uid: string; path: string }>,
    ): Promise<void> {
        let current = row;
        for (let hop = 0; hop <= ancestors.length; hop++) {
            const next = await this.#nextAnchor(current, ancestors);
            // Climbing must not land a row where its holder could never have
            // subscribed: the re-check would deny every delivery, but the row
            // would still hold an anchor slot and a filter evaluation there.
            if (!next || !(await this.#reachable(current, next))) {
                await this.#endSubscription(current, 'anchor_deleted');
                return;
            }
            await this.#reanchor(current, next);
            if (await resolveNode(this.stores.fsEntry, { uid: next.anchorUid }))
                return;
            current = {
                ...current,
                token: next.token,
                anchorUid: next.anchorUid,
                anchorPath: next.anchorPath,
                match: next.match,
                ownerUserId: next.ownerUserId,
            };
        }
    }

    /**
     * What the removal of an anchor node does to the rows keyed on it. Runs in
     * the pass that delivered the `remove`, because nothing will ever come
     * looking for them again: the uid they key on is gone.
     *
     * A row carrying a match asked about a _path_, so it follows that path up
     * to whatever still exists, its match rewritten to lead with the segments
     * that went. A row with no match asked about that node, whose uid is never
     * coming back, so it ends.
     */
    async #settleDeletedAnchor(
        context: FsEventContext,
        candidates: readonly DispatchSubscription[],
    ): Promise<void> {
        const onAnchor = candidates.filter(
            (row) => row.anchorUid === context.entry.uid,
        );
        if (onAnchor.length === 0) return;

        for (const row of onAnchor) {
            try {
                if (row.match) await this.#carryForward(row, context.ancestors);
                else await this.#endSubscription(row, 'anchor_deleted');
            } catch (err) {
                console.warn(
                    '[events] could not settle a subscription whose anchor was removed',
                    row.subId,
                    err,
                );
            }
        }
    }

    /**
     * Where a path-form row moves to, or `null` when there is nowhere to move
     * it: nothing left above it, or a rewritten pattern past what may be
     * compiled.
     *
     * The chain holds existing ancestors only, deepest first, so its head is
     * already the nearest survivor however many levels a recursive delete took
     * at once. It is still walked rather than indexed, because a delete works
     * from the leaves up and the level above may have gone since the walk. Root
     * is where climbing stops on its own — its uid never changes.
     */
    async #nextAnchor(
        row: DispatchSubscription,
        ancestors: ReadonlyArray<{ uid: string; path: string }>,
    ): Promise<ReanchorInput | null> {
        for (const survivor of ancestors) {
            const climbed = relativeTo(survivor.path, row.anchorPath);
            if (climbed === null) continue;

            const match = climbed
                ? `${climbed}/${row.match}`
                : String(row.match);
            try {
                compileMatch(match);
            } catch {
                return null;
            }

            // The keyspace a row is indexed in is the anchor owner's, so a
            // climb that crosses an ownership boundary moves with it.
            const entry = await resolveNode(this.stores.fsEntry, {
                uid: survivor.uid,
            });
            if (!entry) continue;

            return {
                token: fsAnchorToken(survivor.uid),
                anchorUid: survivor.uid,
                anchorPath: survivor.path,
                match,
                ownerUserId: entry.userId,
            };
        }
        return null;
    }

    async #reanchor(
        row: DispatchSubscription,
        next: ReanchorInput,
    ): Promise<void> {
        const bumps =
            row.durable === true
                ? (
                      await this.stores.durableSubscription.reanchor(
                          row as DurableSubscription,
                          next,
                      )
                  ).bumps
                : await this.stores.eventSubscription.reanchorSession(
                      row as SessionSubscription,
                      { ...(row as SessionSubscription), ...next },
                  );
        // The matcher cache keys on the pattern it compiled, so it corrects
        // itself; the access decisions were about a node this row no longer
        // watches.
        this.#deliveryAuth.forget(row.subId);
        for (const bump of bumps)
            this.#publishGeneration(bump, row.durable === true);
    }

    /**
     * End one subscription that cannot be carried forward. Anything already
     * coalesced for it is deliberately left alone — the final `remove` is the
     * last thing it is owed, and cancelling it here would be the delivery this
     * whole pass exists to make.
     */
    async #endSubscription(
        row: DispatchSubscription,
        reason: SubscriptionEndReason,
    ): Promise<void> {
        this.#compiled.delete(row.subId);
        this.#deliveryAuth.forget(row.subId);

        if (row.durable !== true) {
            const bump = await this.stores.eventSubscription.remove(
                row as SessionSubscription,
            );
            this.#publishGeneration(bump, false);
            return;
        }

        const durable = row as DurableSubscription;
        const bump = await this.stores.durableSubscription.remove(durable);
        // Nothing can drain a stream whose row is gone, so what is still owed
        // goes with it — the same trade an explicit unsubscribe makes.
        await this.stores.pendingDelivery.purge(durable.subId).catch(() => {});
        this.#publishGeneration(bump, true);
        await this.#notifyEnded([durable], reason);
    }

    /**
     * Tell durable holders their subscriptions are over. They did not ask for
     * this, and silence would read as "still watching" — so it goes to the
     * holder, not the app's developer. One notification per holder and app:
     * withdrawing an app's access ends everything it held at once, and that is
     * one piece of news, not one per row.
     */
    async #notifyEnded(
        rows: readonly DurableSubscription[],
        reason: SubscriptionEndReason,
    ): Promise<void> {
        const groups = new Map<string, DurableSubscription[]>();
        for (const row of rows) {
            const key = `${row.holderUserId}|${row.appUid ?? ''}`;
            groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        for (const group of groups.values()) {
            const [first] = group;
            try {
                await this.services.notification.notify(
                    [first.holderUserId],
                    {
                        title:
                            group.length === 1
                                ? 'A subscription ended'
                                : `${group.length} subscriptions ended`,
                        subject: first.subject,
                        subjects: group
                            .slice(0, ENDED_SUBJECTS_LISTED)
                            .map((row) => row.subject),
                        count: group.length,
                        reason,
                    },
                    { type: 'app.events.ended', appUid: first.appUid },
                );
            } catch (err) {
                console.warn(
                    '[events] could not report a subscription ending',
                    err,
                );
            }
        }
    }

    // -- Owed deliveries ---------------------------------------------

    /**
     * Queue a `single` and try to hand it straight over. The queue comes first:
     * an attempt that fails after it is recorded is a retry, where one that
     * fails before it is a lost event.
     */
    async #owe(
        row: DispatchSubscription,
        event: DeliverableEvent,
    ): Promise<void> {
        try {
            const { shed } = await this.stores.pendingDelivery.enqueue(
                row.subId,
                event,
            );
            this.#reportShed(shed);
            await this.#drain(row);
        } catch (err) {
            this.#enqueueFailed(row, err);
        }
    }

    /**
     * Hand this subscription what it is owed, oldest first, until something
     * takes a lease and holds it. Stops after a batch so one consumer that
     * settles inline cannot drain a whole backlog inside one call.
     */
    async #drain(row: DispatchSubscription): Promise<number> {
        let handed = 0;
        for (let pass = 0; pass < PENDING_DRAIN_BATCH; pass++) {
            const claimed = await this.stores.pendingDelivery.claim(row.subId);
            if (!claimed) return handed;
            handed++;
            // Anything still holding the lease is the next consumer's answer to
            // give, so this pass is over.
            if (!(await this.#handOut(row, claimed))) return handed;
        }
        return handed;
    }

    /**
     * One attempt at one owed delivery. Sockets first and one at a time, the
     * handler once they are spent — a client that is there answers faster than
     * anything else, and one that is not must not stall the delivery forever.
     *
     * Returns whether the delivery settled, which is what says the next one may
     * go out now rather than when this lease lapses.
     */
    async #handOut(
        row: DispatchSubscription,
        claimed: ClaimedDelivery,
    ): Promise<boolean> {
        const targets = targetsOf(row);
        const target = deliveryTarget(row);

        // Only this region's own connections are visible here; the ones other
        // regions hold arrive with presence.
        const overSocket =
            targets.includes('socket') &&
            claimed.socketAttempts < SINGLE_SOCKET_ATTEMPTS &&
            this.services.socket.has(target);

        if (overSocket) {
            await this.stores.pendingDelivery.recordSocketAttempt(
                row.subId,
                claimed.entryId,
            );
            this.#send({
                target,
                socket: true,
                envelope: {
                    subId: row.subId,
                    event: claimed.event,
                    ackRequired: true,
                    ackId: claimed.entryId,
                },
            });
            return false;
        }

        // Nowhere to put it yet: the lease is what paces the next attempt.
        if (!targets.includes('worker')) return false;

        const invocation = this.#workerInvocation(row, claimed.event);
        if (!invocation) return false;

        const outcome = await this.worker.invoke(invocation);
        this.onDelivered({ subId: row.subId, event: claimed.event });
        if (outcome !== 'settled') return false;

        await this.stores.pendingDelivery.settle(row.subId, claimed.entryId);
        return true;
    }

    /** What the handler seam is handed, or null for a row that wants none. */
    #workerInvocation(
        row: DispatchSubscription,
        event: DeliverableEvent,
    ): WorkerInvocation | null {
        if (row.durable !== true) return null;
        if (!targetsOf(row).includes('worker')) return null;
        return {
            subId: row.subId,
            holderUserId: row.holderUserId,
            appUid: row.appUid,
            handlerName: row.handlerName ?? null,
            event,
            context: row.context ?? null,
        };
    }

    /**
     * Say that deliveries were dropped to stay inside a cap. The subscriptions
     * that lost them are told by the gap marker the store queued in their
     * place; this is the half nobody else would see.
     */
    #reportShed(shed: readonly PendingShed[]): void {
        for (const dropped of shed) {
            if (dropped.scope === 'subscription') {
                console.warn(
                    `[events] dropped ${dropped.dropped} undelivered event(s) of ${dropped.subId}: backlog full`,
                );
                continue;
            }
            console.error(
                `[events] dropped ${dropped.dropped} undelivered event(s) of ${dropped.subId}: too many held in this region`,
            );
            this.clients.alarm.create(
                'events_pending_ceiling',
                'Too many undelivered events are being held here — the oldest were dropped',
                { subId: dropped.subId, dropped: dropped.dropped },
                'warning',
                { dedup: true },
            );
        }
    }

    /**
     * A `single` that could not be queued is an event its subscription was
     * promised and will never see, and nothing downstream will notice on its
     * own. The write that produced it still succeeded.
     */
    #enqueueFailed(row: DispatchSubscription, err: unknown): void {
        console.error(
            `[events] could not queue an event for ${row.subId}`,
            err,
        );
        this.clients.alarm.create(
            'events_pending_enqueue_failed',
            'An event owed to a subscription could not be queued and is lost',
            {
                subId: row.subId,
                holderUserId: row.holderUserId,
                error: err instanceof Error ? err : new Error(String(err)),
            },
            'warning',
            { dedup: true },
        );
    }

    // -- Delivery ----------------------------------------------------

    #coalesce(): DeliveryCoalescer<AddressedDelivery> {
        this.#coalescer ??= new DeliveryCoalescer<AddressedDelivery>(
            EVENTS_COALESCE_WINDOW_MS,
            (_key, delivery) => void this.#flush(delivery),
        );
        return this.#coalescer;
    }

    async #flush(delivery: AddressedDelivery): Promise<void> {
        try {
            const allowed = await checkRateLimit(
                `${EVENTS_BROADCAST_DELIVERY_LIMIT.scope}:${delivery.envelope.subId}`,
                EVENTS_BROADCAST_DELIVERY_LIMIT.limit,
                EVENTS_BROADCAST_DELIVERY_LIMIT.window,
            );
            if (allowed) {
                this.#send(delivery);
                return;
            }
            const event = delivery.envelope.event as ProjectedEvent;
            this.#send({
                target: delivery.target,
                socket: delivery.socket,
                envelope: {
                    subId: delivery.envelope.subId,
                    event: {
                        id: event.id,
                        subject: event.subject,
                        op: 'gap',
                        reason: 'delivery_rate_limit',
                        ts: event.ts,
                    },
                },
            });
        } catch (err) {
            console.warn('[events] delivery failed', err);
        }
    }

    /**
     * Addressed at a socket id — which socket.io joins every socket to — or at
     * a room, so either way the adapter carries it to whichever node terminates
     * the connection. A durable row may also want its handler run, which
     * happens alongside the socket copy and at most once per delivery.
     */
    #send(delivery: AddressedDelivery): void {
        if (delivery.socket) {
            try {
                void this.services.socket
                    .send(
                        delivery.target,
                        EVENTS_DELIVERY_CHANNEL,
                        delivery.envelope,
                    )
                    .catch((err: unknown) => {
                        console.warn('[events] socket send failed', err);
                    });
            } catch (err) {
                console.warn('[events] socket send failed', err);
            }
        }

        if (delivery.worker) {
            const invocation = delivery.worker;
            // At-most-once by construction: a `broadcast` invocation is never
            // retried, which is why the docs ask handlers to be idempotent
            // rather than promising them each event exactly once.
            try {
                void this.worker.invoke(invocation).catch((err: unknown) => {
                    console.warn('[events] handler invocation failed', err);
                });
            } catch (err) {
                console.warn('[events] handler invocation failed', err);
            }
        }

        this.onDelivered(delivery.envelope);
    }

    /**
     * Called once per event that actually reached a subscriber, gap markers
     * included. This is the seam metering hangs off — one delivered event is
     * one line, which is why nothing filtered out, coalesced away or rate
     * limited can arrive here.
     */
    onDelivered(_envelope: DeliveryEnvelope): void {
        return;
    }

    // -- Hot-path cache ----------------------------------------------

    /**
     * Whether this user has anything subscribed at all. Warm, a `Map` read;
     * cold, one `EXISTS` — behind, at most once per warm window, the table read
     * that teaches this region about durable rows it has never seen. Without
     * that, an empty watched set is ambiguous: it means "nobody is listening"
     * in a region that has looked, and nothing at all in one that has not.
     *
     * The epoch is captured before the read and is part of the in-flight key,
     * so a bump landing mid-flight — a subscribe discovering the very folder a
     * fire-and-forget dispatch is still warming up against, say — starts its
     * own fresh lookup rather than being handed the answer an older,
     * now-superseded one is about to compute.
     */
    async #userHasAny(userId: number): Promise<boolean> {
        const cached = this.#cache.read(userId);
        if (cached !== null) return cached;

        const epoch = this.#cache.generationOf(userId);
        const key = `${userId}|${epoch}`;

        // Concurrent writes at the same epoch miss together, and each miss
        // can cost a table read. One lookup answers all of them.
        const inFlight = this.#lookups.get(key);
        if (inFlight) return inFlight;

        const lookup = this.#lookUpHasAny(userId, epoch).finally(() => {
            this.#lookups.delete(key);
        });
        this.#lookups.set(key, lookup);
        return lookup;
    }

    async #lookUpHasAny(userId: number, epoch: number): Promise<boolean> {
        try {
            await this.stores.durableSubscription.warmRegion(userId);
            const hasAny =
                await this.stores.eventSubscription.userHasAny(userId);
            this.#cache.write(userId, epoch, hasAny);
            return hasAny;
        } catch {
            // Not being able to tell is the same outcome as no subscribers,
            // and this must not become the writer's problem.
            return false;
        }
    }

    /**
     * Forget what this process, and this region, believe about one user's
     * subscriptions. Where a generation bump from anywhere else lands: the
     * process drops its answer, and the region rebuilds its durable rows from
     * the table on the next dispatch.
     *
     * Bumps unconditionally rather than passing a remote generation through to
     * the cache's own number check: `ev:g` is a region-local counter, so a
     * peer's bump can carry a number this process's own counter has already
     * passed for entirely unrelated reasons, and comparing them would let a
     * real invalidation be silently ignored as "already applied". There is
     * nothing to order a cross-region signal against, so every one just
     * forgets, and `SubscriptionCache`'s read-side TTL is what bounds a process
     * that never received one at all.
     */
    invalidateUser(
        userId: number,
        { rebuild = true }: { rebuild?: boolean } = {},
    ): void {
        this.#cache.bump(userId);
        if (!rebuild) return;
        void this.stores.eventSubscription
            .markRegionCold(userId)
            .catch(() => {});
    }

    /**
     * `durable` says whether the table changed. Session rows live in this
     * region's Redis alone, so a peer hearing about one has nothing to rebuild
     * — only a durable bump is worth a primary read over there.
     */
    #publishGeneration(
        { userId, generation }: GenerationBump,
        durable: boolean,
    ): void {
        this.#cache.bump(userId, generation);
        try {
            this.clients.event.emit(
                'outer.events.generationBumped',
                { userId, generation, durable },
                {},
            );
        } catch {
            // A peer that misses the bump rebuilds on its own next miss.
        }
    }

    // -- Plumbing ----------------------------------------------------

    #forget(subId: string): void {
        this.#compiled.delete(subId);
        this.#deliveryAuth.forget(subId);
        this.#coalesce().cancel((key) => key.startsWith(`${subId}|`));
    }

    #anchorDeps(): FsAnchorDeps {
        return {
            resolveNode: (ref) => resolveNode(this.stores.fsEntry, ref),
            getAncestorChain: (path) => this.services.fs.getAncestorChain(path),
        };
    }

    #kvDeps(): CrossAppKvDeps {
        return {
            enabled: this.crossAppKvEnabled,
            getApp: (uid) => this.stores.app.getByUid(uid),
            checkPermission: (actor, permission) =>
                this.services.permission.check(actor, permission),
        };
    }

    #aclDeps(): EventAclDeps {
        return {
            acl: this.services.acl,
            getAncestorChain: (path) => this.services.fs.getAncestorChain(path),
            getUser: (userId) => this.stores.user.getById(userId),
            getApp: (uid) => this.stores.app.getByUid(uid),
            getCacheGeneration: (uid) =>
                this.stores.permission.getCacheGeneration(uid),
        };
    }

    async #spendCallBudget(userId: number): Promise<void> {
        const ok = await checkRateLimit(
            `${EVENTS_SUBSCRIBE_LIMIT.scope}:${userId}`,
            EVENTS_SUBSCRIBE_LIMIT.limit,
            EVENTS_SUBSCRIBE_LIMIT.window,
        );
        if (!ok) throw tooManyCalls();
    }

    /**
     * Hold a live socket's keys open. Connections routinely outlive the TTL,
     * and renewing is what separates one of those from a node that died without
     * reaping.
     */
    #startRefresh(holderUserId: number, socketId: string): void {
        const key = `${holderUserId}|${socketId}`;
        if (this.#refreshTimers.has(key)) return;
        const timer = setInterval(
            () => {
                void this.stores.eventSubscription
                    .refresh(holderUserId, socketId)
                    .catch(() => {});
            },
            Math.floor((SESSION_SUBSCRIPTION_TTL_SECONDS * 1000) / 3),
        );
        timer.unref?.();
        this.#refreshTimers.set(key, timer);
    }

    #armExpirySweep(): void {
        if (!this.enabled) return;
        const run = () => {
            void this.sweepExpired()
                .then(() => this.sweepSuspended())
                .catch((err) => {
                    console.warn('[events] expiry sweep failed', err);
                });
        };
        // Jittered so a deploy does not have every node sweep at once.
        const kick = setTimeout(
            run,
            EXPIRY_SWEEP_INITIAL_DELAY_MS * (0.5 + Math.random()),
        );
        kick.unref?.();
        this.#expiryKick = kick;
        const sweep = setInterval(run, EXPIRY_SWEEP_INTERVAL_MS);
        sweep.unref?.();
        this.#expirySweep = sweep;
    }

    #armPendingSweep(): void {
        if (!this.enabled) return;
        const sweep = setInterval(() => {
            void this.sweepPending().catch((err) => {
                console.warn('[events] pending sweep failed', err);
            });
        }, PENDING_SWEEP_INTERVAL_MS);
        sweep.unref?.();
        this.#pendingSweep = sweep;
    }

    #stopRefresh(holderUserId: number, socketId: string): void {
        const key = `${holderUserId}|${socketId}`;
        const timer = this.#refreshTimers.get(key);
        if (!timer) return;
        clearInterval(timer);
        this.#refreshTimers.delete(key);
    }
}
