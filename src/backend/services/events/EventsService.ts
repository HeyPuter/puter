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
    EVENTS_CONSECUTIVE_FAILURES,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER,
    EVENTS_FETCH_LIMIT_CAP,
    EVENTS_FETCH_LIMIT_DEFAULT,
    EVENTS_HANDLER_PUBLISH_BATCH,
    EVENTS_HANDLER_PUBLISH_LIMIT,
    EVENTS_KV_HANDLE_LIMIT,
    EVENTS_KV_HANDLES_PER_USER,
    EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT,
    EVENTS_SINGLE_DELIVERY_LIMIT,
    EVENTS_SUBSCRIBE_LIMIT,
    EVENTS_WORKER_INVOCATION_LIMIT,
    EVENTS_WORKER_SOURCE_MAX_BYTES,
    limitFor,
    SUSPENDED_ROW_TTL_DAYS,
    type SubscriptionQuota,
} from '../../controllers/events/limits.js';
import {
    assertResolvedActor,
    isAccessTokenActor,
    makeActor,
    userRelatedActor,
    type Actor,
} from '../../core/actor.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import type {
    ReanchorInput,
    SuspendedReason,
} from '../../stores/events/DurableSubscriptionStore.js';
import {
    HANDLER_SETTLE_BATCH,
    isSuspendedReason,
} from '../../stores/events/DurableSubscriptionStore.js';
import type {
    KvShareHandle,
    KvShareHandleListOptions,
} from '../../stores/events/KvShareHandleStore.js';
import {
    HANDLER_NAME_MAX_LENGTH,
    hashContent,
    type EventHandlerSummary,
    type EventsWorkerSummary,
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
    type SubscriptionPermission,
    type SubscriptionTarget,
} from '../../stores/events/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import {
    KV_GLOBAL_APP_KEY,
    parseKvNamespace,
} from '../../stores/systemKv/SystemKVStore.js';
import {
    decodeCursor,
    encodeCursor,
    type PageResult,
} from '../../util/pagination.js';
import type { AclMode, ResourceDescriptor } from '../acl/ACLService.js';
import { resolveNode } from '../fs/resolveNode.js';
import { assertActorHasCredits } from '../metering/enforcement.js';
import {
    canViewNotification,
    notificationRowScope,
    ownedAppUids,
} from '../notification/notificationAudience.js';
import { notificationsFoldInEnabled } from '../notification/notificationSocket.js';
import {
    appSocketRoom,
    type SocketSpecifier,
} from '../socket/SocketService.js';
import { PuterService } from '../types.js';
import {
    resolveFsAnchor,
    resolveKvAnchor,
    resolveKvHandleAnchor,
    resolveNotifAnchor,
    type FsAnchorDeps,
} from './anchors.js';
import {
    assertCrossAppKvAuthorized,
    assertSubscribeAuthorized,
    backgroundConsentRequired,
    checkDeliveryAuthorized,
    crossAppKvDenial,
    crossAppKvPermissions,
    deliveryGenerationTag,
    EVENTS_BACKGROUND_PERMISSION,
    kvShareHandleDisabled,
    kvSharedRegionAuthorized,
    needsBackgroundConsent,
    nodeDescriptor,
    resolveGrantActor,
    rowInActorScope,
    SUBSCRIBE_MODE,
    unknownKvShareHandle,
    type CrossAppKvDeps,
    type EventAclDeps,
    type KvSharedRegionDeps,
    type SubscriptionGrant,
} from './authorization.js';
import { DeliveryCoalescer } from './coalescer.js';
import { forwardTarget } from './EventForwardService.js';
import type { ForwardDelivery } from './forwardQueue.js';
import {
    DELIVERY_USAGE_TYPES,
    EVENTS_COSTS,
    EVENTS_COST_UNITS,
    type EventsUsageType,
} from './costs.js';
import { DeliveryAuthCache } from './deliveryAuthCache.js';
import {
    FILTER_EVALUATIONS_PER_EVENT,
    compileMatch,
    evaluateWithCap,
    relativeTo,
    type CompiledMatch,
} from './matcher.js';
import { projectNotifRow, resolveNotifFetch } from './notifFetch.js';
import {
    lookupFsSubject,
    lookupKvSubject,
    lookupNotifSubject,
    type DeliverableEvent,
    type DeliveryClass,
    type DeliveryFields,
    type EventContextBase,
    type FsEventContext,
    type GapMarker,
    type GapReason,
    type KvEventContext,
    type MatchSpec,
    type NotifEventContext,
    type ProjectedEvent,
    type ProjectedKvEvent,
    type ProjectedNotifEvent,
    type SubjectSpec,
} from './registry.js';
import { SubscriptionCache } from './subscriptionCache.js';
import {
    assertBoundedManageGrant,
    assertShareableAppUid,
    assertShareablePermission,
    assertShareablePrefix,
    kvShareGrantCovers,
    kvShareManageNamespaceRoot,
    kvShareManagePermission,
    kvShareOwnerImplicator,
    kvSharePermission,
    relativeToKvShareRoot,
} from './kvShares.js';
import {
    KV_MATCH_SEPARATOR,
    NOTIF_MATCH_SEPARATOR,
    fsAnchorToken,
    isKvToken,
    kvHandleFromSubject,
    parseSubject,
    type FsOp,
    type ParsedSubject,
    type SubjectOp,
} from './subjects.js';
import { backlogPolicyFor, isResumable } from './suspension.js';
import type { EventsInvokeTransport } from '../../clients/events/EventsWorkerInvokerClient.js';
import {
    EVENTS_WORKER_SESSION_NAME,
    eventsInvokeKey,
    eventsWorkerScope,
    eventsWorkerScript,
} from './workerRuntime.js';
import { handlerSetHash } from './workerSource.js';
import {
    EventsWorkerInvoker,
    RecordingWorkerInvoker,
    type WorkerInvocation,
    type WorkerInvocationOutcome,
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
    /**
     * The region that owns the lease, echoed back from the delivery. Absent
     * when it was emitted where the client is connected, which is everything a
     * single-region deployment ever sees.
     */
    origin?: unknown;
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

/** Query for `GET /events/workers`. Always the caller's own account. */
export interface ListEventsWorkersRequest {
    limit?: number;
    cursor?: string;
}

/** One events worker as its owner's listing reports it. */
export interface EventsWorkerView extends EventsWorkerSummary {
    /** Deployed script name, for support/diagnosis. */
    script: string;
}

/** Body of `POST /events/workers/destroy`. */
export interface DestroyEventsWorkerRequest {
    appUid?: unknown;
}

/** What destroying an app's events worker did. */
export interface DestroyedEventsWorkerView {
    appUid: string;
    removed: number;
    suspended: number;
}

export interface DurableListRequest {
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}

/**
 * One page of catch-up. `after` is where the client got to — the cursor from
 * its last page — rather than a stored position, because nothing about a fetch
 * is registered anywhere.
 */
export interface FetchRequest {
    subject?: string;
    after?: string;
    limit?: number;
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

/** Body of the handle-minting surface. The grantee is named either way. */
export interface MintKvHandleRequest {
    granteeUsername?: unknown;
    granteeUid?: unknown;
    appUid?: unknown;
    prefix?: unknown;
}

/**
 * What minting returns. Only the handle and the region it covers: the owner
 * already knows the rest, and the grantee is handed this verbatim, so anything
 * else here would be something the handle exists to not say.
 */
export interface MintedKvHandle {
    handle: string;
    prefix: string;
}

/**
 * One handle as its owner sees it, revoked ones included — they are the record
 * of what was shared and when it stopped.
 */
export interface KvShareHandleView extends MintedKvHandle {
    appUid: string;
    granteeUsername: string | null;
    createdAt: number;
    revokedAt: number | null;
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
    /**
     * Which region holds the lease, present only when that is not the region
     * the client is connected to. Echoed back with the ack so whichever region
     * receives it knows where to send it.
     */
    origin?: string;
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
    /**
     * Whether the socket copy also goes to the other regions holding one. True
     * for `broadcast`, which every connected subscriber gets; a `single` picks
     * exactly one region itself and never fans.
     */
    remote?: boolean;
    worker?: WorkerInvocation;
    meter: DeliveryMeter;
    /**
     * Whether this specific call is the one that charges for the event. Always
     * true for `broadcast` (one send, no retries); a `single` retry after a
     * lease expiry carries `false` — the same event was already charged for on
     * whichever attempt reached here first.
     */
    bill: boolean;
}

/**
 * Who a delivery is billed to, and at which class's rate. Carried with the
 * delivery rather than looked up when it lands: by then the row that answers
 * both may already have been suspended or removed.
 */
interface DeliveryMeter {
    holderUserId: number;
    /** The app whose subscription this is, so usage is attributable to it. */
    appUid: string | null;
    deliveryClass: DeliveryClass;
    /** Only a durable row has a state to suspend when the balance runs out. */
    durable: boolean;
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
    permission: SubscriptionPermission;
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
    /** Present only for a move: where the entry lived before it, lazily. */
    movedFrom?: {
        path: string;
        ancestors: () => Promise<ReadonlyArray<{ uid: string; path: string }>>;
    };
}

/** One persisted notification, as the bus reports it. */
export interface NotifDispatchInput {
    /** The recipient, whose mailbox is the anchor. */
    userId: number;
    userUuid: string;
    uid: string;
    type: string;
    audience: string;
    /** App the notification is about, or `null` for a platform one. */
    appUid: string | null;
    value: Record<string, unknown>;
    createdAt: number;
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

// -- Metering ---------------------------------------------------------

/**
 * How long a holder's metering identity is reused, and how many are held.
 *
 * Deliveries for one holder arrive in bursts, and the identity behind them —
 * their user row, and the app the subscription belongs to — does not move
 * between them. Without this, every delivered event pays a user lookup to
 * record a line worth a fraction of a microcent.
 */
const METER_ACTOR_TTL_MS = 60_000;
const METER_ACTOR_LIMIT = 5_000;

/** Rows one page of the credit sweep takes, and pages one sweep takes. */
const NO_CREDIT_SWEEP_BATCH = 500;
const NO_CREDIT_SWEEP_MAX_BATCHES = 200;

/**
 * How often suspensions waiting on a restored balance are re-checked. Well
 * inside the hour a `no_credit` backlog is held for, so a top-up gets the
 * subscription back before what it was owed expires.
 */
const NO_CREDIT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

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

/**
 * A temporary account gets session subscriptions and nothing else. A durable
 * row outlives the account itself and is revoked from a settings surface a
 * temporary account never reaches — so this is refused outright rather than
 * sold as a quota of zero.
 */
const durableNeedsAccount = (): HttpError =>
    new HttpError(
        403,
        'A temporary account may only subscribe for the life of its connection',
        { legacyCode: 'events_durable_requires_account' },
    );

const handlerNotFound = (name: string): HttpError =>
    new HttpError(404, `No handler named \`${name}\` is published`, {
        legacyCode: 'events_handler_not_found',
    });

/** Same code as `handlerNotFound`: an app with no handlers has no events worker. */
const noEventsWorker = (appUid: string): HttpError =>
    new HttpError(404, `No handlers are published for \`${appUid}\``, {
        legacyCode: 'events_handler_not_found',
    });

/**
 * The app's generated events worker — every published handler's source, baked
 * into one file — would exceed what the runtime may load. Refused before the
 * write rather than left to fail at deploy time.
 */
const eventsWorkerTooLarge = (): HttpError =>
    new HttpError(
        413,
        `This app's events worker would exceed ${EVENTS_WORKER_SOURCE_MAX_BYTES} bytes across its published handlers`,
        { legacyCode: 'events_worker_too_large' },
    );

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
/**
 * Listing and revoking are the user's own view of what they have shared. An app
 * doing it on their behalf has no surface of its own yet.
 */
const handleOwnerOnly = (): HttpError =>
    new HttpError(403, 'Only an account session may manage share handles', {
        legacyCode: 'events_kv_handle_owner_only',
    });

/**
 * Events workers are billed to the owning account, so listing them is that
 * account's own view of what it is paying for — an app has no surface of its
 * own here, the same posture `handleOwnerOnly` takes for kv share handles.
 */
const eventsWorkerOwnerOnly = (): HttpError =>
    new HttpError(403, 'Only an account session may list its events workers', {
        legacyCode: 'events_worker_owner_only',
    });

/**
 * An app minting is delegation, and the `manage:` grant on the region is the
 * consent for it. Without one there is nothing authorizing the app to dispose
 * of its user's data, whatever the user themselves could do here.
 */
const handleNotDelegated = (): HttpError =>
    new HttpError(
        403,
        'This app has not been given permission to share this data',
        { legacyCode: 'events_kv_handle_not_delegated' },
    );

/**
 * A delegation is the app's to hold, not to pass on: a token it minted may
 * carry the `manage:` permission and still not mint through it, the same way an
 * access token is refused a socket of its own (`SocketService`). The user's own
 * token is not this case — it acts for the user, who needs no delegation.
 */
const handleAccessTokenForbidden = (): HttpError =>
    new HttpError(403, 'An access token may not mint a share handle', {
        legacyCode: 'forbidden',
    });

/**
 * An app addresses exactly one key-value namespace — its own, under its user —
 * so that is the only one it can hand a region of out.
 */
const handleOutsideNamespace = (): HttpError =>
    new HttpError(403, 'An app may only share its own key-value data', {
        legacyCode: 'events_kv_handle_outside_namespace',
    });

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

/**
 * A share-handle row's real anchor is the owner's namespace and the absolute
 * granted prefix — neither of which its holder was ever told. The handle is the
 * only anchor its holder may see, mirroring `#asRowAddressesIt`.
 */
const toView = (sub: DispatchSubscription): SubscriptionView => {
    const handle = kvHandleFromSubject(sub.subject);
    return {
        subId: sub.subId,
        subject: sub.subject,
        anchor:
            handle !== null
                ? { uid: handle, path: '' }
                : { uid: sub.anchorUid, path: sub.anchorPath },
        match: sub.match,
        op: sub.op,
        targets: sub.targets ?? SESSION_TARGETS,
    };
};

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
 * `row.anchorPath` is the anchor's path at subscribe time, not now — a rename
 * or move leaves it stale, and matching against it would silently drop every
 * event past the move. The live path is the entry's own when the event is on
 * the anchor, and otherwise the one the ancestor walk carries. The fallback is
 * for the chains that walk does not cover: a non-fs context (kv, notif), which
 * ignores this value, and the chain a move left, which `leftAnchorPath` has.
 */
const liveAnchorPath = (
    row: DispatchSubscription,
    context: EventContextBase,
): string => {
    const fs = context as Partial<FsEventContext>;
    if (!fs.entry) return row.anchorPath;
    if (fs.entry.uid === row.anchorUid) return fs.entry.path;
    return (
        fs.ancestors?.find((ancestor) => ancestor.uid === row.anchorUid)
            ?.path ?? row.anchorPath
    );
};

/**
 * Where this row's anchor sat in the chain a move left, or `null` when the row
 * was not watching that side. Only a move has one.
 */
const leftAnchorPath = (
    row: DispatchSubscription,
    context: EventContextBase,
): string | null => {
    const fs = context as Partial<FsEventContext>;
    return (
        fs.movedFrom?.ancestors.find(
            (ancestor) => ancestor.uid === row.anchorUid,
        )?.path ?? null
    );
};

/**
 * The (anchor path, event path) pairs a row's filter is tested against. A move
 * is two: where the node is now, and — for a row anchored on the chain it left
 * — where it was, which is the only scope a filter on the source folder can
 * match a departure in.
 */
const matchScopesFor = (
    row: DispatchSubscription,
    context: EventContextBase,
    matchOn: string,
): Array<[string, string]> => {
    const scopes: Array<[string, string]> = [
        [liveAnchorPath(row, context), matchOn],
    ];
    const left = leftAnchorPath(row, context);
    const from = (context as Partial<FsEventContext>).movedFrom?.path;
    if (left !== null && from !== undefined) scopes.push([left, from]);
    return scopes;
};

/**
 * Whether this row was watching where a moved node came from — anchored on the
 * node itself, or somewhere in the chain it left. A row that only watches the
 * destination was never shown the source, so it is not told the old path.
 */
const sawItLeave = (
    row: DispatchSubscription,
    context: EventContextBase,
): boolean => {
    const fs = context as Partial<FsEventContext>;
    if (!fs.movedFrom) return false;
    return (
        fs.entry?.uid === row.anchorUid || leftAnchorPath(row, context) !== null
    );
};

/** Who one row's deliveries are billed to, and at which rate. */
const meterFor = (row: DispatchSubscription): DeliveryMeter => ({
    holderUserId: row.holderUserId,
    appUid: row.appUid,
    deliveryClass: isSingle(row) ? 'single' : 'broadcast',
    durable: row.durable === true,
});

/** The marker that stands in for an event a delivery budget refused. */
const rateLimitGap = (event: DeliverableEvent): GapMarker => ({
    id: event.id,
    subject: event.subject,
    op: 'gap',
    reason: 'delivery_rate_limit',
    ts: event.ts,
});

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
    if (!targetsAllowedForDelivery(delivery, targets, appUid))
        throw badRequest(
            'A `single` subscription may not target `push`, and an app`s needs a `worker` target',
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
    /** Holder identities the metering lines are written as. */
    readonly #meterActors = new Map<
        string,
        { actor: Actor; expiresAt: number }
    >();
    #coalescer: DeliveryCoalescer<AddressedDelivery> | null = null;
    #expirySweep: ReturnType<typeof setInterval> | null = null;
    #expiryKick: ReturnType<typeof setTimeout> | null = null;
    #pendingSweep: ReturnType<typeof setInterval> | null = null;
    #creditSweep: ReturnType<typeof setInterval> | null = null;

    /**
     * What runs an app's handler. Replaced at start-up by the invoker that
     * calls the app's events worker; the recorder stands in until then and
     * settles nothing, so a delivery handed to it stays owed.
     */
    worker: WorkerInvokerSeam = new RecordingWorkerInvoker();

    // -- Lifecycle ---------------------------------------------------

    override onServerStart(): void {
        // Without it nothing can be addressed, and every background delivery
        // fails its way to a suspension with no obvious cause.
        if (
            this.config.events?.workerRuntime === true &&
            !this.config.events?.internalSecret
        )
            console.warn(
                '[events] workerRuntime is on but events.internalSecret is unset — no events worker can be addressed',
            );

        // Left alone when something has already put its own invoker here.
        if (this.worker instanceof RecordingWorkerInvoker)
            this.worker = new EventsWorkerInvoker(
                this.clients.eventsWorkerInvoker,
                (invocation) => this.#mintSubscriberToken(invocation),
                (appUid) => this.#addressEventsWorker(appUid),
            );

        this.clients.event.on(
            'outer.pubsub.events.generationBumped',
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

        // Emitted once the row is written, so a delivery never names a
        // notification the mailbox does not have.
        this.clients.event.on('notif.created', (_key, data) => {
            void this.dispatchNotif(data as NotifDispatchInput).catch((err) => {
                console.warn('[events] notification dispatch failed', err);
            });
        });

        // Owning a key-value namespace is holding every share grant over it,
        // which is what lets its owner mint a handle on their own data.
        this.services.permission.registerImplicator(kvShareOwnerImplicator());

        this.#armExpirySweep();
        this.#armPendingSweep();
        this.#armCreditSweep();
    }

    override onServerPrepareShutdown(): void {
        if (this.#expiryKick) clearTimeout(this.#expiryKick);
        this.#expiryKick = null;
        if (this.#expirySweep) clearInterval(this.#expirySweep);
        this.#expirySweep = null;
        if (this.#pendingSweep) clearInterval(this.#pendingSweep);
        this.#pendingSweep = null;
        if (this.#creditSweep) clearInterval(this.#creditSweep);
        this.#creditSweep = null;
    }

    override onServerShutdown(): void {
        for (const timer of this.#refreshTimers.values()) clearInterval(timer);
        this.#refreshTimers.clear();
    }

    /**
     * What one delivery costs, in the shape the driver surfaces report theirs.
     * Nothing consumes this at runtime — the rates are published on the
     * rate-limits page, which is where a developer actually reads them.
     */
    getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(EVENTS_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: EVENTS_COST_UNITS[usageType as EventsUsageType],
                source: 'service:events',
            }),
        );
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

    /**
     * Whether one user may hand another a watchable region of their key-value
     * namespace. Off by default, and read on the mint, the subscribe and the
     * delivery re-check alike — turning it off stops rows already made rather
     * than only new ones.
     */
    get kvHandlesEnabled(): boolean {
        return this.config.events?.kvHandles === true;
    }

    /**
     * Whether notification delivery runs through dispatch. Off, notifications
     * take the path they always have and nothing here sees them.
     */
    get notificationsFoldIn(): boolean {
        return notificationsFoldInEnabled(this.config);
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

        // Presence is per (user, app) and per region, so it is the connection
        // rather than the subscription that moves it — a client that has not
        // subscribed yet is still somewhere, and that is what a peer needs.
        void this.services.eventForward.noteConnect(actor).catch((err) => {
            console.warn('[events] presence connect failed', err);
        });

        socket.once('disconnect', (() => {
            void this.reapSocket(userId, socket.id);
            void this.services.eventForward
                .noteDisconnect(actor)
                .catch((err) => {
                    console.warn('[events] presence disconnect failed', err);
                });
        }) as (...args: never[]) => void);
    }

    /**
     * Put down one delivery another region handed us. Nothing is metered or
     * re-checked: the region that emitted it did both, and this one holds no
     * state about it at all.
     */
    async deliverForwarded(item: ForwardDelivery): Promise<void> {
        if (!this.enabled) return;
        const envelope: DeliveryEnvelope = {
            subId: item.subId,
            event: item.event,
            ...(item.ackRequired
                ? {
                      ackRequired: true as const,
                      ackId: item.ackId,
                      origin: item.origin,
                  }
                : {}),
        };
        await this.services.socket.send(
            forwardTarget(item.userId, item.appUid),
            EVENTS_DELIVERY_CHANNEL,
            envelope,
        );
    }

    /**
     * Settle a delivery whose client acked it in another region. The same
     * settle a local ack performs — including the guard that a suspended row
     * hands out nothing more — minus the checks the connected region already
     * made against the client.
     */
    async settleRelayedAck(
        holderUserId: number,
        subId: string,
        entryId: string,
    ): Promise<void> {
        if (!this.enabled || !subId || !entryId) return;
        const row = await this.stores.durableSubscription.getBySubId(subId);
        if (!row || row.holderUserId !== holderUserId) return;

        await this.stores.pendingDelivery.settle(subId, entryId);
        if (row.suspendedAt === null) await this.#drain(row);
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
        // An unresolved `effectiveApp` must not be read as "no app" — it
        // means the actor skipped `makeActor` and something upstream is
        // broken.
        assertResolvedActor(actor);

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
        const limits = await this.#subscriptionQuota(actor);
        const targets = parseTargets(request?.targets, delivery, appUid);
        const handlerName = parseHandlerName(request?.handlerName);
        const handlerHash = parseHandlerHash(request?.handlerHash);
        const context = parseContext(request?.context);
        const expiresAt = parseExpiresAt(request?.expiresAt);

        // A `single` is owed to exactly one consumer, and the handler is the
        // only one that is always there to take it.
        if (delivery === 'single' && !handlerName) throw handlerRequired();

        // Consent first: a row that would run the app's code with nobody
        // present is refused before anything about it is resolved or stored.
        if (
            needsBackgroundConsent(targets) &&
            !(await this.#hasBackgroundConsent(actor))
        )
            throw backgroundConsentRequired();

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
            limits,
        });
        this.#publishGeneration(bump, true);

        return { sub: toDurableView(row) };
    }

    /**
     * How many durable rows this caller's plan allows, in total and for the app
     * they are acting as. The store enforces them against one count, so the
     * plan is read here and the counting stays where the index is.
     *
     * A deployment with no metering has no plans to read, and is held to the
     * paid caps.
     */
    async #subscriptionQuota(actor: Actor): Promise<SubscriptionQuota> {
        const plan = await this.#planId(actor);
        if (
            plan !== null &&
            limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER, plan) === 0
        )
            throw durableNeedsAccount();
        return {
            perUser: limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER, plan),
            perApp: limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP, plan),
        };
    }

    /** The plan this actor is on, or `null` where there are no plans. */
    async #planId(actor: Actor): Promise<string | null> {
        const metering = this.services.metering;
        if (!metering) return null;
        try {
            return (await metering.getActorSubscription(actor)).id;
        } catch (err) {
            console.warn('[events] could not resolve a plan', err);
            return null;
        }
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

    /**
     * What a client missed while it was away. A plain authorized query against
     * the subject's own store: nothing is registered, no cursor is kept here,
     * and a second fetch from anywhere returns the same answer — the client
     * holds the position.
     *
     * Only `notif:` has a store to read; `fs:` and `kv:` say so rather than
     * returning an empty page, which a client would read as "nothing
     * happened".
     */
    async fetchMissed(
        actor: Actor,
        request: FetchRequest,
    ): Promise<PageResult<ProjectedNotifEvent>> {
        if (!this.enabled) throw disabled();
        const user = actor.user;
        if (!user?.id || !user.uuid) throw disabled();
        // Unresolved is not "no app": reading it that way would hand an app
        // rows only the account may see.
        if (actor.effectiveApp === undefined) return { items: [] };

        const scope = resolveNotifFetch(String(request.subject ?? ''), {
            userUuid: user.uuid,
            appUid: actor.effectiveApp?.uid ?? null,
        });

        const asked = Math.floor(Number(request.limit));
        const limit = Math.min(
            Number.isFinite(asked) && asked > 0
                ? asked
                : EVENTS_FETCH_LIMIT_DEFAULT,
            EVENTS_FETCH_LIMIT_CAP,
        );
        const cursored = Number(decodeCursor(request.after, 'after')?.id);

        // One extra row answers "is there another page" without a count.
        const rows = await this.stores.notification.listScoped(user.id, {
            audience: scope.audience,
            appUid: scope.appUid,
            after: Number.isFinite(cursored) ? cursored : null,
            limit: limit + 1,
        });

        const page = rows.slice(0, limit);
        const visible = await this.#visibleNotifications(actor, page);
        const last = page[page.length - 1];

        return {
            items: visible.map((row, i) => projectNotifRow(row, user.uuid, i)),
            ...(rows.length > limit && last
                ? { cursor: encodeCursor({ id: Number(last.id) }) }
                : {}),
        };
    }

    /**
     * The audience predicate, applied to rows the query already scoped to the
     * caller's own mailbox. A row the actor may not see is dropped rather than
     * refused: which notifications exist is not something an app token gets to
     * probe for.
     *
     * Ownership is a per-row fact rather than one shared answer: an unscoped
     * page (a session's own generic fetch) can carry `developer` rows about
     * several apps at once.
     */
    async #visibleNotifications(
        actor: Actor,
        rows: Array<Record<string, unknown>>,
    ): Promise<Array<Record<string, unknown>>> {
        if (rows.length === 0) return rows;
        const scopes = rows.map(notificationRowScope);
        const owned = await ownedAppUids(
            this.stores.app,
            Number(actor.user?.id),
            scopes.flatMap((s) =>
                s.audience === 'developer' && s.appUid ? [s.appUid] : [],
            ),
        );

        return rows.filter((_row, i) =>
            canViewNotification(scopes[i], actor, {
                recipientOwnsApp: owned.has(scopes[i].appUid ?? ''),
            }),
        );
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

        // The lease lives where the event was emitted, which is not always
        // where the client ended up connected. Nothing about the delivery is
        // held here to settle, so the ack goes home rather than being applied.
        const origin = String(request?.origin ?? '');
        const forward = this.services.eventForward;
        if (origin && origin !== forward.region && forward.isPeer(origin)) {
            forward.relayAck(origin, holderUserId, subId, entryId);
            return;
        }

        await this.stores.pendingDelivery.settle(subId, entryId);
        // A suspended row is not delivered to: settling what it already handed
        // out must not be the trigger that hands out the next one.
        if (row.suspendedAt === null) await this.#drain(row);
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
        const before = await this.stores.eventHandler.countForApp(appUid);
        const result = await this.#publishOne(appUid, request);
        await this.#maybeAnnounceWorkerCreate(appUid, before);
        return result;
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

        const before = await this.stores.eventHandler.countForApp(appUid);
        const published: PublishedHandlerView[] = [];
        try {
            for (const item of handlers) {
                if (!item || typeof item !== 'object' || Array.isArray(item))
                    throw badRequest(
                        'each handler must be an object',
                        'bad_request',
                    );
                published.push(
                    await this.#publishOne(
                        appUid,
                        item as PublishHandlerRequest,
                    ),
                );
            }
        } finally {
            // A refused item stops the pass but leaves the ones before it
            // published, and those are what stood the worker up.
            if (published.length > 0)
                await this.#maybeAnnounceWorkerCreate(appUid, before);
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
        if (removed) await this.#maybeAnnounceWorkerDestroy(appUid);
        return { name, removed: removed !== null, suspended };
    }

    // -- Events workers ------------------------------------------------
    //
    // The billable artifact a published handler set implies, not the handlers
    // themselves. Listing is account-scoped like kv handle listing — this is
    // the owner's own view of what it is paying for, so it takes no `appUid`
    // and, unlike the handler routes, an app cannot act on its owner's behalf
    // here. Destroying one is scoped to an app, the same way publishing is.

    /**
     * The events workers billed to this account — one per app it owns with at
     * least one published handler.
     */
    async listEventsWorkers(
        actor: Actor,
        request: ListEventsWorkersRequest = {},
    ): Promise<{
        items: EventsWorkerView[];
        cursor?: string;
        deployable: boolean;
    }> {
        if (!this.enabled) throw disabled();
        if (actor.effectiveApp !== null) throw eventsWorkerOwnerOnly();
        const ownerUserId = actor.user?.id;
        if (ownerUserId === undefined) throw disabled();

        const page = await this.stores.eventHandler.listEventsWorkersForOwner(
            ownerUserId,
            { limit: request.limit, cursor: request.cursor },
        );
        const items: EventsWorkerView[] = [];
        for (const worker of page.items) {
            const handlers = await this.stores.eventHandler.setForApp(
                worker.appUid,
            );
            items.push({
                ...worker,
                script: eventsWorkerScript(
                    handlerSetHash(handlers),
                    eventsWorkerScope(this.config),
                ),
            });
        }

        return {
            items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            deployable: this.config.events?.workerRuntime === true,
        };
    }

    /**
     * Remove every handler an app has published, in one call. Same consequences
     * as removing each by name — dependents suspend, not delete — since it runs
     * the same per-name removal, just for the whole set.
     */
    async destroyEventsWorker(
        actor: Actor,
        request: DestroyEventsWorkerRequest,
    ): Promise<DestroyedEventsWorkerView> {
        await this.#spendHandlerBudget(actor);
        const appUid = await this.#handlerApp(actor, request?.appUid);

        const names = (await this.stores.eventHandler.listForApp(appUid)).map(
            (handler) => handler.name,
        );
        if (names.length === 0) throw noEventsWorker(appUid);

        let removed = 0;
        let suspended = 0;
        try {
            for (const name of names) {
                const droppedRow = await this.stores.eventHandler.remove(
                    appUid,
                    name,
                );
                if (droppedRow) removed += 1;
                suspended += await this.#suspendHandlerDependents(appUid, name);
            }
        } finally {
            // A pass that stops partway may still have taken the last handler
            // with it, and the announce is what a rent listener stops on.
            if (removed > 0) await this.#maybeAnnounceWorkerDestroy(appUid);
        }
        return { appUid, removed, suspended };
    }

    // -- Cross-user key-value handles --------------------------------

    /**
     * Hand another user a watchable region of this account's key-value data.
     *
     * Two writes, in this order: the grant, which is the authorization and
     * carries its own `manage:` check and its own refusal to grant to yourself,
     * and then the handle, which is only a name for it. A handle whose grant
     * never landed would be a name for nothing; a grant whose handle never
     * landed is unaddressable, since a handle is the only thing that can name
     * this family.
     *
     * An app may mint too, bounded the way sharing bounds an app handing out
     * its user's files: authority is the user's, asked of the user behind the
     * actor and never of the app, and reach is what the credential itself
     * holds. Here reach is structural — an app addresses one namespace — so it
     * is asserted rather than worked out, and the app's own consent to delegate
     * is a `manage:` grant on the region.
     */
    async mintKvHandle(
        actor: Actor,
        request: MintKvHandleRequest,
    ): Promise<MintedKvHandle> {
        if (!this.enabled) throw disabled();
        if (!this.kvHandlesEnabled) throw kvShareHandleDisabled();

        const owner = actor.user;
        if (!owner?.uuid || owner.id === undefined) throw disabled();
        // `undefined` is an app that could not be resolved, not the absence of
        // one — reading it as an account session is what would hand an app a
        // surface bounded on the app it is acting as.
        const app = actor.effectiveApp;
        if (app === undefined) throw handleOwnerOnly();

        // The budget is the user's, so an app spends its user's slots rather
        // than a machine-rate allowance of its own.
        await this.#spendHandleBudget(owner.id);

        const keyPrefix = assertShareablePrefix(request?.prefix);
        const appUid = this.#mintNamespace(app, request);
        const grantee = await this.#resolveGrantee(request);

        const permission = assertShareablePermission(
            kvSharePermission(owner.uuid, appUid, keyPrefix),
        );
        // Before the idempotent answer below, or an app that lost its
        // delegation could read back a handle it may no longer hand out.
        if (app) await this.#assertKvShareDelegated(actor, permission);

        // The same region minted again for the same grantee is the same
        // capability, not a second one — handing back what already exists is
        // what keeps two handles from ever sharing one permission row. The
        // ceiling counts slots, and this takes none, so it is not asked.
        const existing = await this.stores.kvShareHandle.findLive({
            ownerUserId: owner.id,
            granteeUserId: grantee.id,
            appUid,
            keyPrefix,
        });
        if (existing)
            return { handle: existing.handle, prefix: existing.keyPrefix };

        await this.#assertHandleCeiling(owner.id);

        // The user behind the app, so the authority checked is theirs and the
        // issuer recorded is them. Which app acted is carried separately: it
        // belongs on the audit row, not in the grant's authority.
        await this.services.permission.grantUserUserPermission(
            userRelatedActor(actor),
            grantee.username,
            permission,
            {},
            { reason: 'kv share handle', appUid: app?.uid },
        );

        const row = await this.stores.kvShareHandle.mint({
            ownerUserId: owner.id,
            granteeUserId: grantee.id,
            appUid,
            keyPrefix,
            permission,
        });
        return { handle: row.handle, prefix: row.keyPrefix };
    }

    /**
     * Which namespace a mint may name. An app reaches `v1:<user>:<its own app>`
     * and nothing else, so a request naming another one is refused rather than
     * quietly minted somewhere the app cannot even write.
     */
    #mintNamespace(
        app: Actor['effectiveApp'],
        request: MintKvHandleRequest,
    ): string {
        const named = parseAppUid(request?.appUid);
        if (!app) return assertShareableAppUid(named ?? KV_GLOBAL_APP_KEY);
        if (named !== null && named !== app.uid) throw handleOutsideNamespace();
        return app.uid;
    }

    /**
     * Whether this app was given the region to hand out. The `manage:` grant is
     * the user's consent, and prefix implication makes one taken on a region
     * cover the keys beneath it — so a handle deeper than the consent is still
     * inside it, and one above it is not.
     */
    async #assertKvShareDelegated(
        actor: Actor,
        permission: string,
    ): Promise<void> {
        // Consequential enough to require the app's own session, whatever a
        // token it minted happens to carry — the same posture already taken
        // for an access token wanting a socket of its own (SocketService).
        if (isAccessTokenActor(actor)) throw handleAccessTokenForbidden();
        // The consent surface refuses a namespace-root delegation because no
        // prompt can describe it; refused here too, so a row written any other
        // way cannot authorize a mint.
        assertBoundedManageGrant(kvShareManagePermission(permission));
        const delegated = await this.services.permission.canManagePermission(
            actor,
            permission,
        );
        if (!delegated) throw handleNotDelegated();
        // `canManagePermission` walks ancestors, so a namespace-root grant
        // written by any path other than the consent surface would otherwise
        // authorize a mint anywhere in the namespace, bounded region or not.
        const unbounded = await this.services.permission.check(
            actor,
            kvShareManageNamespaceRoot(permission),
        );
        if (unbounded) throw handleNotDelegated();
    }

    /**
     * Take a shared region back.
     *
     * The grant goes first — the subtree with it, since a deeper grant would
     * leave access to part of a region that has just been withdrawn — and the
     * handle is retired after. Removing the grant is what actually settles the
     * subscriptions, and it is the only half that stops delivery, so it is the
     * half that must not be able to fail after the other has succeeded. In that
     * order both steps are idempotent and a failure anywhere is a retry: the
     * reverse leaves a handle nothing can address standing on a grant
     * everything still passes, and no way to try again.
     *
     * Not gated on the feature flag. Withdrawing access only ever narrows, and
     * an install that turned handles off must still be able to retire the ones
     * it has.
     */
    async revokeKvHandle(
        actor: Actor,
        handle: unknown,
    ): Promise<{ handle: string; revokedAt: number }> {
        if (!this.enabled) throw disabled();
        const owner = actor.user;
        if (owner?.id === undefined) throw disabled();
        if (actor.effectiveApp !== null) throw handleOwnerOnly();

        await this.#spendHandleBudget(owner.id);

        const named = typeof handle === 'string' ? handle : '';
        const share = await this.stores.kvShareHandle.getByHandle(named);
        // Unknown and somebody else's read the same way, so revoking cannot be
        // used to find out that a handle exists.
        if (!share || share.ownerUserId !== owner.id)
            throw unknownKvShareHandle(named);

        const grantee = await this.stores.user.getById(share.granteeUserId);
        if (!grantee?.username)
            throw new HttpError(500, 'The grantee of this handle is gone', {
                legacyCode: 'internal_error',
            });
        await this.services.permission.revokeUserUserPermissionSubtree(
            actor,
            grantee.username,
            share.permission,
            { reason: 'kv share handle revoked' },
        );

        const revoked = await this.stores.kvShareHandle.retire(named, owner.id);
        if (!revoked?.revokedAt) throw unknownKvShareHandle(named);

        // A narrower handle to the same grantee shares this one's permission
        // row whenever its region nests under it, and the subtree revoke
        // above just withdrew that row — so its grant is already gone even
        // though its own row still reads live.
        await this.#retireCoveredHandles(revoked);

        return { handle: revoked.handle, revokedAt: revoked.revokedAt };
    }

    /**
     * Every other live handle to this grantee that the just-withdrawn grant
     * covered.
     */
    async #retireCoveredHandles(revoked: KvShareHandle): Promise<void> {
        const siblings =
            await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
                revoked.ownerUserId,
                revoked.granteeUserId,
            );
        await Promise.all(
            siblings
                .filter((row) =>
                    kvShareGrantCovers(revoked.permission, row.permission),
                )
                .map((row) =>
                    this.stores.kvShareHandle.retire(
                        row.handle,
                        revoked.ownerUserId,
                    ),
                ),
        );
    }

    /**
     * What this account has shared out of its key-value data, retired handles
     * included: they are the only record of what was shared and when it
     * stopped. The grantee has no listing of their own — what they hold is the
     * handle they were given.
     */
    async listKvHandles(
        actor: Actor,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<KvShareHandleView>> {
        if (!this.enabled) throw disabled();
        const owner = actor.user;
        if (owner?.id === undefined) throw disabled();
        if (actor.effectiveApp !== null) throw handleOwnerOnly();

        const page = await this.stores.kvShareHandle.listForOwner(
            owner.id,
            options,
        );
        const grantees = await this.stores.user.getByIds([
            ...new Set(page.items.map((row) => row.granteeUserId)),
        ]);

        return {
            ...page,
            items: page.items.map((row) => ({
                handle: row.handle,
                prefix: row.keyPrefix,
                appUid: row.appUid,
                granteeUsername:
                    grantees.get(row.granteeUserId)?.username ?? null,
                createdAt: row.createdAt,
                revokedAt: row.revokedAt,
            })),
        };
    }

    /** Who a mint is for. Named by username or uuid; unknown reads as absent. */
    async #resolveGrantee(
        request: MintKvHandleRequest,
    ): Promise<{ id: number; username: string }> {
        const username =
            typeof request?.granteeUsername === 'string'
                ? request.granteeUsername.trim()
                : '';
        const uid =
            typeof request?.granteeUid === 'string'
                ? request.granteeUid.trim()
                : '';
        if (!username && !uid)
            throw badRequest(
                'Name the grantee with `granteeUsername` or `granteeUid`',
                'bad_request',
            );

        const user = username
            ? await this.stores.user.getByUsername(username)
            : await this.stores.user.getByUuid(uid);
        if (!user?.username || user.id === undefined)
            throw new HttpError(404, 'user_does_not_exist', {
                legacyCode: 'subject_does_not_exist',
            });
        return { id: user.id, username: user.username };
    }

    /**
     * Whether this account may hold out another share handle. Retired ones do
     * not count: the row stays as the record of what was shared, not as a slot.
     * Check-then-act: two mints racing past it can both proceed, which the mint
     * budget bounds well enough for an abuse backstop.
     */
    async #assertHandleCeiling(userId: number): Promise<void> {
        const live = await this.stores.kvShareHandle.countLiveForOwner(userId);
        if (live >= EVENTS_KV_HANDLES_PER_USER)
            throw new HttpError(
                409,
                `An account may hold out ${EVENTS_KV_HANDLES_PER_USER} share handles at a time`,
                { legacyCode: 'events_kv_handle_limit_reached' },
            );
    }

    async #spendHandleBudget(userId: number): Promise<void> {
        const ok = await checkRateLimit(
            `${EVENTS_KV_HANDLE_LIMIT.scope}:${userId}`,
            EVENTS_KV_HANDLE_LIMIT.limit,
            EVENTS_KV_HANDLE_LIMIT.window,
        );
        if (!ok) throw tooManyCalls();
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

    /**
     * Put back subscriptions a restored balance releases. Lazy on purpose: a
     * top-up is not something this service hears about, and coupling delivery
     * to the payment path would make one more thing that has to be told. The
     * cost of the delay is bounded by how long a `no_credit` backlog is held.
     */
    async sweepNoCredit(): Promise<number> {
        if (!this.enabled || !this.services.metering) return 0;

        let resumed = 0;
        let after = 0;
        for (let pass = 0; pass < NO_CREDIT_SWEEP_MAX_BATCHES; pass++) {
            const page =
                await this.stores.durableSubscription.listSuspendedPage(
                    'no_credit',
                    after,
                    NO_CREDIT_SWEEP_BATCH,
                );
            const holders = new Set(page.rows.map((row) => row.holderUserId));
            for (const holderUserId of holders) {
                const actor = await this.#meterActor({
                    holderUserId,
                    appUid: null,
                    deliveryClass: 'broadcast',
                    durable: true,
                });
                if (!actor) continue;
                try {
                    await assertActorHasCredits(
                        this.services.metering,
                        actor,
                        this.config,
                    );
                } catch {
                    continue;
                }
                resumed += await this.resumeForCredit(holderUserId);
            }
            if (page.nextId === null) break;
            after = page.nextId;
        }
        return resumed;
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
                    // A hold not past its deadline yet must not pin the head
                    // against every other backlog in the region.
                    else if (
                        (await this.stores.pendingDelivery.expireHold(
                            subId,
                        )) === 0
                    )
                        await this.stores.pendingDelivery.defer(subId);
                    continue;
                }
                attempted += await this.#drain(row, { deferWhenBusy: true });
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
        const name = String(item?.name ?? '');
        const source = typeof item?.source === 'string' ? item.source : '';
        await this.#assertHandlerSetSize(appUid, name, source);

        const { handler, outcome } = await this.stores.eventHandler.publish({
            appUid,
            name,
            source,
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
     * Refuse a publish that would push the app's events worker — every
     * handler's source, baked into one file — over the size cap. The name being
     * published may already have a row; its current bytes are backed out of the
     * total since this publish replaces them rather than adding to them.
     */
    async #assertHandlerSetSize(
        appUid: string,
        name: string,
        source: string,
    ): Promise<void> {
        const [totalBytes, existing] = await Promise.all([
            this.stores.eventHandler.totalSourceBytesForApp(appUid),
            this.stores.eventHandler.getByName(appUid, name),
        ]);
        const existingBytes = existing
            ? Buffer.byteLength(existing.source, 'utf8')
            : 0;
        const projected =
            totalBytes - existingBytes + Buffer.byteLength(source, 'utf8');
        if (projected > EVENTS_WORKER_SOURCE_MAX_BYTES)
            throw eventsWorkerTooLarge();
    }

    /**
     * Announce `events.worker.create` when this request just took the app from
     * zero published handlers to one or more. `before` is read at the start of
     * the request and compared against a fresh count now — a publish racing
     * against another one for the same app can double-announce or (rarely) miss
     * the transition, which is accepted rather than adding a lock around
     * something a listener idempotently prices anyway.
     */
    async #maybeAnnounceWorkerCreate(
        appUid: string,
        before: number,
    ): Promise<void> {
        if (before > 0) return;
        await this.#emitWorkerLifecycle('events.worker.create', appUid);
    }

    /**
     * The other half of {@link #maybeAnnounceWorkerCreate}, for a 1→0
     * transition.
     */
    async #maybeAnnounceWorkerDestroy(appUid: string): Promise<void> {
        await this.#emitWorkerLifecycle('events.worker.destroy', appUid);
    }

    /**
     * Emitted after the row write that triggered it has committed, and awaited
     * — so a rent listener has settled before the caller is told the publish or
     * removal succeeded. The actor carries the app's _owner_, not the caller: a
     * developer session publishing for an app it owns is the common case, but
     * billing follows ownership, resolved fresh through the user store rather
     * than assumed from the request.
     *
     * Never throws: this runs on the way out of a write, including one that is
     * itself failing, so nothing here may be what the caller sees.
     */
    async #emitWorkerLifecycle(
        name: 'events.worker.create' | 'events.worker.destroy',
        appUid: string,
    ): Promise<void> {
        try {
            // Only a count now on the far side of the transition is one: a
            // `create` needs a handler standing, a `destroy` needs none.
            const count = await this.stores.eventHandler.countForApp(appUid);
            if (name === 'events.worker.create' ? count === 0 : count > 0)
                return;

            const app = await this.stores.app.getByUid(appUid);
            const ownerUserId = Number(
                (app as { owner_user_id?: unknown } | null)?.owner_user_id,
            );
            if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) return;
            const owner = await this.stores.user.getById(ownerUserId);
            if (!owner) return;

            await this.clients.event.emitAndWait(
                name,
                { actor: makeActor({ user: owner }), appUid },
                {},
            );
        } catch (err) {
            console.warn(`[events] ${name} was not announced`, appUid, err);
        }
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

    /**
     * Bring back what was waiting on this name. The other half of a removal —
     * and of a handler that kept failing, since new source under the name is
     * the fix for one that could not take its deliveries.
     */
    async #resumeHandlerDependents(
        appUid: string,
        name: string,
    ): Promise<number> {
        let resumed = 0;
        for (const reason of ['handler_not_found', 'failures'] as const) {
            for (;;) {
                const batch =
                    await this.stores.durableSubscription.listByHandler(
                        appUid,
                        name,
                        { suspendedReason: reason },
                    );
                if (batch.length === 0) break;
                resumed += await this.resumeSubscriptions(batch);
                if (batch.length < HANDLER_SETTLE_BATCH) break;
            }
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
     * Whether this actor may have its handler run in the background.
     *
     * Asked of the actor rather than of the app, so an access token an app
     * issued has to carry the consent itself — a delivery that runs code with
     * nobody present is not something a narrower credential inherits.
     */
    async #hasBackgroundConsent(actor: Actor): Promise<boolean> {
        try {
            return await this.services.permission.check(
                actor,
                EVENTS_BACKGROUND_PERMISSION,
            );
        } catch (err) {
            console.warn('[events] background consent check failed', err);
            return false;
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
        if (parsed.family === 'notif')
            return this.#resolveNotifSubscribe(actor, parsed);
        if (parsed.family !== 'fs')
            throw new HttpError(
                400,
                `Subject family not subscribable yet: ${parsed.family}`,
                { legacyCode: 'invalid_subject' },
            );

        const anchor = await resolveFsAnchor(
            parsed,
            this.#anchorDeps(),
            { username: actor.user?.username },
            rawSubject,
        );

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

        if (parsed.anchorRef.kind === 'kvHandle')
            return this.#resolveKvHandleSubscribe(
                actor,
                parsed,
                parsed.anchorRef.handle,
            );

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

    /**
     * Resolve and authorize a `kv:<handle>:<key>` subject.
     *
     * The handle resolves to the region it was granted on and the key is
     * composed onto it, so the row lands on exactly the anchor the owner's own
     * subject would — same token, same keyspace, no dispatch change. Which
     * keyspace that is matters: the row is indexed under the **owner**, because
     * a write only ever knows whose namespace it touched.
     *
     * Authority is the grant, never the handle: an actor holding the mirrored
     * permission may subscribe, and one who does not is told the handle is not
     * there rather than that it is theirs to want.
     */
    async #resolveKvHandleSubscribe(
        actor: Actor,
        parsed: ParsedSubject,
        handle: string,
    ): Promise<ResolvedAnchor> {
        if (!this.kvHandlesEnabled) throw kvShareHandleDisabled();

        const share = await this.stores.kvShareHandle.getByHandle(handle);
        if (!share || share.revokedAt !== null)
            throw unknownKvShareHandle(handle);

        const held = await kvSharedRegionAuthorized(
            actor,
            share.permission,
            this.#kvShareDeps(),
        );
        if (!held) throw unknownKvShareHandle(handle);

        const owner = await this.stores.user.getById(share.ownerUserId);
        if (!owner?.uuid) throw unknownKvShareHandle(handle);

        const anchor = resolveKvHandleAnchor(parsed, {
            ownerUserUuid: owner.uuid,
            appUid: share.appUid,
            keyPrefix: share.keyPrefix,
        });

        if (anchor.match)
            compileMatch(anchor.match, { separator: KV_MATCH_SEPARATOR });

        return {
            token: anchor.token,
            uid: anchor.appUid,
            path: anchor.prefix,
            match: anchor.match,
            op: null,
            ownerUserId: share.ownerUserId,
            // The grant string rather than a mode: it is what a revoke names,
            // and what the delivery re-check asks again.
            permission: share.permission,
            subject: anchor.subject,
        };
    }

    /**
     * Resolve and authorize a `notif:` subject.
     *
     * You only ever subscribe to your own mailbox, so the anchor is fixed and
     * the check is the audience predicate: a slice the actor could never be
     * shown reads as absent rather than refused, the same answer subscribing to
     * a node you cannot see gives.
     */
    async #resolveNotifSubscribe(
        actor: Actor,
        parsed: ParsedSubject,
    ): Promise<ResolvedAnchor> {
        const user = actor.user;
        if (!user?.uuid || user.id === undefined) throw disabled();
        // Nothing dispatches notifications while the fold-in is off, so a
        // subscription would be a row that never delivers.
        if (!this.notificationsFoldIn)
            throw new HttpError(
                400,
                'Subject family not subscribable yet: notif',
                { legacyCode: 'invalid_subject' },
            );

        const anchor = resolveNotifAnchor(parsed, {
            userUuid: user.uuid,
            appUid: actor.effectiveApp?.uid ?? null,
        });

        const ownsApp =
            anchor.appScoped && anchor.audience === 'developer'
                ? await this.#recipientOwnsApp(user.id, anchor.ref)
                : false;
        const visible = canViewNotification(
            {
                audience: anchor.audience,
                appUid: anchor.appScoped ? anchor.ref : null,
            },
            actor,
            { recipientOwnsApp: ownsApp },
        );
        if (!visible)
            throw new HttpError(404, `No such subject: ${anchor.subject}`, {
                legacyCode: 'subject_does_not_exist',
            });

        compileMatch(anchor.match, { separator: NOTIF_MATCH_SEPARATOR });

        return {
            token: anchor.token,
            uid: anchor.ref,
            path: '',
            match: anchor.match,
            op: null,
            ownerUserId: user.id,
            // The column wants a mode; a notification row's re-check is the
            // audience predicate, so nothing reads this back.
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
        const movedFrom = options.movedFrom
            ? {
                  path: options.movedFrom.path,
                  ancestors: await options.movedFrom.ancestors(),
              }
            : undefined;
        const context: FsEventContext = {
            key,
            entry,
            ancestors,
            movedFrom,
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

    /**
     * Publish one persisted notification: the desktop's wire first, because
     * that is what a person is waiting on, then whatever subscriptions asked
     * for this slice of the mailbox.
     *
     * The fan-out is one token — a notification is addressed to a person — so
     * there is no tree to walk and nothing to coalesce against.
     */
    async dispatchNotif(input: NotifDispatchInput): Promise<void> {
        if (!this.notificationsFoldIn) return;

        const subject = lookupNotifSubject('notif.created');
        if (!subject) return;
        const userId = input?.userId;
        if (typeof userId !== 'number' || !input.userUuid || !input.uid) return;

        const context: NotifEventContext = {
            key: 'notif.created',
            userId,
            userUuid: input.userUuid,
            uid: input.uid,
            type: input.type ?? '',
            audience: (input.audience ??
                'account') as NotifEventContext['audience'],
            appUid: input.appUid ?? null,
            notification: input.value ?? {},
            id: input.uid,
            ts: input.createdAt || Date.now(),
        };

        // The adapter is not a subscription: the desktop is delivered to
        // whether or not anything subscribed, which is what keeps the wire
        // contract identical with the fold-in on.
        this.services.notification.deliverOverSocket(context);

        if (!(await this.#userHasAny(userId))) return;

        const watched = await this.stores.eventSubscription.watchedTokens(
            userId,
            subject.tokens(context),
        );
        if (watched.length === 0) return;

        const rows = await this.stores.eventSubscription.getForTokens(
            userId,
            watched,
        );
        if (rows.length === 0) return;

        await this.#route(subject, context, rows, userId, (matched) =>
            this.#notifStillAuthorized(matched, context),
        );
    }

    /**
     * Which rows may be told about this notification. The audience predicate is
     * the whole check — an `account` row never reaches an actor holding an app,
     * and a `developer` row only reaches one whose holder owns the app it
     * names.
     */
    async #notifStillAuthorized(
        rows: DispatchSubscription[],
        context: NotifEventContext,
    ): Promise<DispatchSubscription[]> {
        if (rows.length === 0) return rows;

        const scope = { audience: context.audience, appUid: context.appUid };
        const ownsApp =
            context.audience === 'developer' && context.appUid
                ? await this.#recipientOwnsApp(context.userId, context.appUid)
                : false;

        return rows.filter((row) =>
            canViewNotification(
                scope,
                { effectiveApp: row.appUid ? { uid: row.appUid } : null },
                { recipientOwnsApp: ownsApp },
            ),
        );
    }

    /** Whether the mailbox's owner is the owner of the app a row names. */
    async #recipientOwnsApp(userId: number, appUid: string): Promise<boolean> {
        const owned = await ownedAppUids(this.stores.app, userId, [appUid]);
        return owned.has(appUid);
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
            (row) => this.#passes(row, subject, op, matchOn, context),
            FILTER_EVALUATIONS_PER_EVENT,
        );

        const matched = await authorize(
            evaluated.matched.slice(0, EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT),
        );

        let seq = 0;
        for (const row of matched) {
            const event = this.#asRowAddressesIt(
                row,
                subject.project({
                    ...context,
                    // A row watching only where the node landed was never
                    // shown where it came from, so it is not handed that path.
                    ...(sawItLeave(row, context)
                        ? {}
                        : { movedFrom: undefined }),
                    // An unknown actor is never "self" — defaulting true would
                    // tell a holder an event they didn't cause was their own.
                    self:
                        actingUserId !== undefined &&
                        actingUserId === row.holderUserId,
                    seq: seq++,
                }),
            );
            // A stale or mis-scoped share-handle row: nothing resolves under
            // its grant, so nothing is delivered rather than the owner's
            // namespace and absolute key going out in its place.
            if (event === null) continue;

            // A `single` is owed rather than sent: it is queued, and never
            // coalesced or broadcast — collapsing two of them would drop one
            // the subscription was promised.
            if (isSingle(row)) {
                await this.#oweSingle(row, event);
                continue;
            }

            const targets = targetsOf(row);
            this.#coalesce().push(coalesceKey(row.subId, event.subject), {
                target: deliveryTarget(row),
                envelope: { subId: row.subId, event },
                socket: targets.includes('socket'),
                // A session row is addressed at one connection, which is the
                // one that made it and is therefore here.
                remote: row.socketId === undefined,
                worker: this.#workerInvocation(row, event),
                meter: meterFor(row),
                // `broadcast` is one send per delivery — no retry to dedup.
                bill: true,
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

        // Same re-check the delivery path applies: a row a revoked grant
        // would have refused must not learn it lost an event either.
        this.#gap(
            await authorize(missed),
            subject,
            context,
            evaluated.stoppedEarly
                ? 'filter_evaluation_limit'
                : 'matched_subscription_limit',
        );
    }

    /**
     * One event named the way the row that receives it addresses things. Only a
     * share-handle row differs: the projection names the owner's namespace and
     * an absolute key, neither of which its holder can address or was told
     * about, so both are re-based on the handle. Every other row is untouched.
     *
     * `null` when the key does not resolve under the grant — a stale or
     * mis-scoped row, never delivered rather than sent with the owner's
     * namespace and absolute key exposed.
     */
    #asRowAddressesIt<P extends ProjectedEvent>(
        row: DispatchSubscription,
        event: P,
    ): P | null {
        // Asked of every delivery, so the families that can never answer are
        // turned away on a token comparison rather than a subject parse.
        if (!isKvToken(row.token)) return event;
        const handle = kvHandleFromSubject(row.subject);
        if (handle === null) return event;

        const key = relativeToKvShareRoot(
            row.permission,
            (event as ProjectedKvEvent).key,
        );
        if (key === null) return null;
        return { ...event, subject: `kv:${handle}:${key}`, key };
    }

    /** Op filter first — a comparison, where the glob is not. */
    #passes(
        row: DispatchSubscription,
        subject: MatchSpec,
        op: SubjectOp,
        matchOn: string,
        context: EventContextBase,
    ): boolean {
        if (row.op !== null && row.op !== op) return false;
        if (!row.match) return true;

        const matcher = this.#matcherFor(row, subject.matchSeparator);
        return matchScopesFor(row, context, matchOn).some(
            ([anchorPath, target]) => {
                const scoped = subject.matchScope(anchorPath, target);
                return scoped !== null && matcher.test(scoped);
            },
        );
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
                row.permission as AclMode,
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
                // A row on a shared region is authorized by its grant, not by
                // whose namespace it names — and that is one question per
                // subscription, because the handle *is* the granted root.
                if (kvHandleFromSubject(row.subject) !== null)
                    return this.#kvShareHolds(row);
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

    /**
     * Whether one row's holder may still watch the region it was made on.
     *
     * Held in the cross-event cache under the row's anchor, which for a shared
     * region is the whole of what it can address: nothing above the handle is
     * nameable, so the answer does not vary by key and one evaluation covers
     * every event under it until a grant or a revoke moves the generation.
     */
    async #kvShareHolds(row: DispatchSubscription): Promise<boolean> {
        const identity = await this.#grantIdentity(row);
        if (!identity) return false;

        const key = {
            subId: row.subId,
            generation: identity.generation,
            nodeUid: row.anchorUid,
        };
        const cached = this.#deliveryAuth.read(key);
        if (cached !== null) return cached;

        const allowed = await kvSharedRegionAuthorized(
            identity.actor,
            row.permission,
            this.#kvShareDeps(),
        );
        this.#deliveryAuth.write(key, allowed);
        return allowed;
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
            // subscription's events would: queued for a `single`, coalesced
            // and rate limited for the rest — a burst that opens many gaps in
            // one window still surfaces one marker per subscription. It is
            // never billed: charging for a loss would bill the holder for it.
            if (isSingle(row)) {
                void this.#owe(row, marker);
                continue;
            }
            // A marker rides the socket; a row with none has nowhere to hear
            // it, and sending nothing must not count as a delivery.
            if (!targetsOf(row).includes('socket')) continue;
            this.#coalesce().push(coalesceKey(row.subId, marker.subject), {
                target: deliveryTarget(row),
                socket: targetsOf(row).includes('socket'),
                remote: row.socketId === undefined,
                envelope: { subId: row.subId, event: marker },
                meter: meterFor(row),
                // A gap marker is never billed regardless — `#delivered`'s own
                // op check is the real guard — but it never earns the claim.
                bill: false,
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

        // A copied-out worker token must stop working the moment the consent
        // that let it be minted is gone — not just the rows using it.
        if (
            revocation.appUid &&
            (revocation.permission === null ||
                revocation.permission === EVENTS_BACKGROUND_PERMISSION)
        ) {
            await this.#revokeWorkerSession(
                revocation.holderUserId,
                revocation.appUid,
            );
        }

        const held = await this.stores.durableSubscription.listActiveForHolder(
            revocation.holderUserId,
            revocation.appUid,
        );
        const settling = await this.#leftSettling(held, revocation.permission);
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
     * Revoke the reused `events:handlers` worker session for (holder, app), if
     * one was ever minted. Best-effort: a lookup or revoke failure must not
     * fail the settle that triggered it.
     */
    async #revokeWorkerSession(userId: number, appUid: string): Promise<void> {
        try {
            const row = await this.stores.session.getWorker(userId, {
                appUid,
                workerName: EVENTS_WORKER_SESSION_NAME,
            });
            if (row) await this.services.auth.revokeSession(row.uuid);
        } catch (err) {
            console.warn(
                '[events] could not revoke worker session',
                appUid,
                err,
            );
        }
    }

    /**
     * Which of a holder's rows one withdrawn grant actually stops.
     *
     * Withdrawing an app's access wholesale is the user saying the app is done,
     * so it takes everything the app holds — no per-row question, and none of
     * the standing exemptions an app enjoys over its own data keep a
     * subscription alive past the consent that made it.
     */
    async #leftSettling(
        held: readonly DurableSubscription[],
        permission: string | null,
    ): Promise<DurableSubscription[]> {
        if (permission === null) return [...held];
        if (permission === EVENTS_BACKGROUND_PERMISSION)
            return this.#leftWithoutConsent(held);
        return this.#leftUnauthorized(held, permission);
    }

    /**
     * Of a holder's rows, the ones that were running the app's code in the
     * background on a consent that has just been withdrawn. Rows delivered only
     * to a connection are untouched: what was withdrawn is the right to run
     * with nobody there, not the app itself.
     *
     * The consent is asked for again rather than assumed gone — a mode change
     * is recorded as a revoke followed by a grant, and settling on the revoke
     * alone would end subscriptions whose consent still stands.
     */
    async #leftWithoutConsent(
        rows: readonly DurableSubscription[],
    ): Promise<DurableSubscription[]> {
        const background = rows.filter((row) =>
            needsBackgroundConsent(targetsOf(row)),
        );
        if (background.length === 0) return [];

        const deps = this.#aclDeps();
        const settling: DurableSubscription[] = [];
        for (const row of background) {
            const actor = await resolveGrantActor(row, deps);
            if (actor && (await this.#hasBackgroundConsent(actor))) continue;
            settling.push(row);
        }
        return settling;
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
            const covered = this.#coveredByRevocation(row, permission);
            if (covered && !(await this.#anchorStillReachable(row)))
                settling.push(row);
        }
        return settling;
    }

    /**
     * Whether one withdrawn grant is one of the ones a row was standing on.
     * Narrowing only — the question is asked again for real below.
     *
     * A shared key-value region is the exact string match plus prefix
     * implication, which is what makes handle to subscriptions a lookup over
     * rows the holder index already returned rather than a scan for the
     * handle.
     */
    #coveredByRevocation(
        row: DurableSubscription,
        permission: string,
    ): boolean {
        if (kvHandleFromSubject(row.subject) !== null)
            return kvShareGrantCovers(permission, row.permission);
        if (isKvToken(row.token))
            return crossAppKvPermissions(row.anchorUid).includes(permission);
        return this.services.acl
            .permissionsFor(row.anchorUid, row.permission as AclMode)
            .includes(permission);
    }

    /** Whether a row's holder can still reach its anchor, asked fresh. */
    async #anchorStillReachable(row: DurableSubscription): Promise<boolean> {
        if (kvHandleFromSubject(row.subject) !== null)
            return this.#kvShareHolds(row);
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
            row.permission as AclMode,
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
        anchorPath: string,
        ancestors: ReadonlyArray<{ uid: string; path: string }>,
    ): Promise<void> {
        let current = row;
        let currentAnchorPath = anchorPath;
        for (let hop = 0; hop <= ancestors.length; hop++) {
            const next = await this.#nextAnchor(
                current,
                currentAnchorPath,
                ancestors,
            );
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
            currentAnchorPath = next.anchorPath;
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
                // The removed node's live path, not `row.anchorPath` — a
                // rename or move before this delete left that stale.
                if (row.match)
                    await this.#carryForward(
                        row,
                        context.entry.path,
                        context.ancestors,
                    );
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
        anchorPath: string,
        ancestors: ReadonlyArray<{ uid: string; path: string }>,
    ): Promise<ReanchorInput | null> {
        for (const survivor of ancestors) {
            const climbed = relativeTo(survivor.path, anchorPath);
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
     * One `single` event, or the marker that says its subscription is being
     * delivered faster than the class allows. Spent before the queue: a budget
     * checked at hand-out time would let a backlog build that nothing can ever
     * work through.
     */
    async #oweSingle(
        row: DispatchSubscription,
        event: DeliverableEvent,
    ): Promise<void> {
        const allowed = await checkRateLimit(
            `${EVENTS_SINGLE_DELIVERY_LIMIT.scope}:${row.subId}`,
            EVENTS_SINGLE_DELIVERY_LIMIT.limit,
            EVENTS_SINGLE_DELIVERY_LIMIT.window,
        );
        await this.#owe(row, allowed ? event : rateLimitGap(event));
    }

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
    async #drain(
        row: DispatchSubscription,
        // Only the sweeper defers: it alone reads the pending index in score
        // order, so only it may rewrite a score without starving what is behind.
        opts?: { deferWhenBusy?: boolean },
    ): Promise<number> {
        let handed = 0;
        for (let pass = 0; pass < PENDING_DRAIN_BATCH; pass++) {
            const claimed = await this.stores.pendingDelivery.claim(row.subId);
            if (!claimed) {
                // Already in flight (or briefly nothing to claim): move on in
                // the sweeper's line rather than pin the head against every
                // other backlog behind it.
                if (opts?.deferWhenBusy)
                    await this.stores.pendingDelivery.defer(row.subId);
                return handed;
            }
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
        const meter = meterFor(row);
        // Held, not dropped: a delivery its holder cannot pay for waits out the
        // suspension's window and goes out if the balance comes back.
        if (!(await this.#chargeable(meter, row.subId))) return false;

        const targets = targetsOf(row);
        const target = deliveryTarget(row);
        const hasWorkerFallback = targets.includes('worker');

        // A row with no worker to fall back to has nothing left to try once
        // its socket budget is spent. Without this, a socket that disappeared
        // mid-attempt would spend that whole budget on nobody and wedge the
        // entry forever even after it reappears.
        if (
            !hasWorkerFallback &&
            claimed.socketAttempts >= SINGLE_SOCKET_ATTEMPTS &&
            targets.includes('socket') &&
            this.services.socket.has(target)
        ) {
            await this.stores.pendingDelivery.resetSocketAttempts(
                row.subId,
                claimed.entryId,
            );
            claimed = { ...claimed, socketAttempts: 0, remoteAttempts: 0 };
        }

        // Candidates in order: this region's own connection, then the regions
        // presence names, most recently connected first. The attempt counter
        // spans them, so two attempts is two candidates however they are split.
        const socketsLeft =
            targets.includes('socket') &&
            claimed.socketAttempts < SINGLE_SOCKET_ATTEMPTS;
        const here = socketsLeft && this.services.socket.has(target);
        const region =
            socketsLeft && !(here && claimed.socketAttempts === 0)
                ? await this.services.eventForward.candidateRegion(
                      row.holderUserId,
                      row.appUid,
                      claimed.remoteAttempts,
                  )
                : null;

        if (here || region) {
            await this.stores.pendingDelivery.recordSocketAttempt(
                row.subId,
                claimed.entryId,
            );
            if (region)
                await this.stores.pendingDelivery.recordRemoteAttempt(
                    row.subId,
                    claimed.entryId,
                );
            const envelope: DeliveryEnvelope = {
                subId: row.subId,
                event: claimed.event,
                ackRequired: true,
                ackId: claimed.entryId,
            };
            const bill = await this.#firstAttempt(row.subId, claimed);
            if (region) {
                this.services.eventForward.handOff(region, {
                    holderUserId: row.holderUserId,
                    appUid: row.appUid,
                    subId: row.subId,
                    event: claimed.event,
                    ackRequired: true,
                    ackId: claimed.entryId,
                });
                this.#delivered(envelope, meter, bill);
            } else {
                await this.#send({
                    target,
                    socket: true,
                    envelope,
                    meter,
                    bill,
                });
            }
            return false;
        }

        // Nowhere to put it yet: the lease is what paces the next attempt.
        if (!hasWorkerFallback) return false;

        const invocation = this.#workerInvocation(row, claimed.event);
        if (!invocation) return false;

        // Over the invocation budget nothing ran, so nothing was delivered and
        // the lease is the backoff — and the budget refusal itself must not
        // spend the one bill this entry gets, nor count against the handler.
        const outcome = await this.#invokeHandler(invocation);
        if (outcome === null) return false;

        // Only a settled outcome is a delivery: billing and reporting it
        // ahead of that would charge for an attempt that failed, is still
        // retrying, or was discarded outright.
        if (outcome === 'settled') {
            this.#delivered(
                { subId: row.subId, event: claimed.event },
                meter,
                await this.#firstAttempt(row.subId, claimed),
            );
            await this.stores.pendingDelivery.clearFailures(row.subId);
            await this.stores.pendingDelivery.settle(
                row.subId,
                claimed.entryId,
            );
            return true;
        }
        // Nothing was attempted, so nothing failed: the lease paces the retry.
        if (outcome === 'deferred') return false;

        await this.#handlerFailed(row, claimed, outcome);
        return false;
    }

    /**
     * What a handler that would not take a delivery costs it, and what a run of
     * them costs the subscription.
     *
     * A refusal is the handler's answer, so the delivery is dropped with a gap
     * marker rather than sent again to the same answer; anything else is "not
     * now", and the delivery waits longer each time. Both count: five failures
     * in a row is a handler that is not working, whichever way it is failing,
     * and retrying it forever is how one bad deploy becomes a standing load on
     * whatever it is calling.
     */
    async #handlerFailed(
        row: DispatchSubscription,
        claimed: ClaimedDelivery,
        outcome: Exclude<WorkerInvocationOutcome, 'settled' | 'deferred'>,
    ): Promise<void> {
        const pending = this.stores.pendingDelivery;
        try {
            if (outcome === 'terminal')
                await pending.discard(
                    row.subId,
                    claimed.entryId,
                    'handler_rejected',
                );
            else await pending.deferAfterFailure(row.subId, claimed.entryId);

            const failures = await pending.recordFailure(row.subId);
            if (failures < EVENTS_CONSECUTIVE_FAILURES) return;

            await pending.clearFailures(row.subId);
            await this.suspendForFailures(row.subId);
        } catch (err) {
            console.warn(
                '[events] could not record a failed handler attempt',
                row.subId,
                err,
            );
        }
    }

    /**
     * Whether this is the first genuine attempt at this entry — across however
     * many times it is claimed, retried and handed to a different transport. A
     * `single` retries the same entry after a lease expiry, and that is one
     * owed event, not a new one each time: only the attempt that gets here
     * first is billed. A gap marker is never billed at all, so it never spends
     * the claim either.
     */
    async #firstAttempt(
        subId: string,
        claimed: ClaimedDelivery,
    ): Promise<boolean> {
        if (claimed.event.op === 'gap') return false;
        return this.stores.pendingDelivery.markBilled(subId, claimed.entryId);
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
     * The token one invocation carries: the subscriber acting through the
     * subscribing app, the same authority that app has for this user in a tab —
     * not a token scoped to whatever grant the subscription was made under. It
     * can read what the app can read, and reaches the app's own KV and AppData
     * like any other app session would. What authorizes running that with
     * nobody present is the `events:background` consent the row needed to
     * target a worker at all, checked at subscribe time and re-run on every
     * delivery.
     *
     * The session behind the token is one row per (user, app), reused across
     * every delivery — the same idempotent worker session `puter.workers.*`
     * uses — so it appears once in the user's sessions list and is revocable
     * there like any other.
     *
     * Null when the identity cannot be rebuilt (the holder or the app is gone)
     * or the consent is no longer there, which is not a handler failure: there
     * is nothing to invoke.
     */
    async #mintSubscriberToken(
        invocation: WorkerInvocation,
    ): Promise<string | null> {
        const { appUid } = invocation;
        if (!appUid) return null;

        const actor = await resolveGrantActor(
            {
                holderUserId: invocation.holderUserId,
                appUid,
                permission: SUBSCRIBE_MODE,
            },
            this.#aclDeps(),
        );
        if (!actor) return null;

        // Asked again here: nothing else on the delivery path reads it, the
        // settle that ends a revoked row is best-effort, and what is minted is
        // the app's whole standing for this holder. The permission cache
        // answers it, so only a grant change costs a lookup.
        if (!(await this.#hasBackgroundConsent(actor))) return null;

        try {
            return await this.services.auth.createWorkerAppToken(
                actor,
                appUid,
                EVENTS_WORKER_SESSION_NAME,
            );
        } catch (err) {
            console.warn(
                '[events] could not mint a delivery token',
                invocation.subId,
                err,
            );
            return null;
        }
    }

    /**
     * Replace how invocations reach an events worker. For the layer that owns
     * workers, which is the only one that can provide an in-process runtime;
     * production leaves the client on its dispatcher transport.
     */
    useWorkerTransport(transport: EventsInvokeTransport): void {
        this.clients.eventsWorkerInvoker.setTransport(transport);
    }

    /**
     * Where an app's handlers currently live: the script its published set
     * hashes to, and the key an invocation of it carries.
     *
     * Resolved per invocation rather than cached, from the set's names and
     * hashes alone — a cache here would go on addressing a superseded script,
     * which is still deployed and still running the handlers it was baked with,
     * until the entry expired.
     */
    async #addressEventsWorker(
        appUid: string,
    ): Promise<{ script: string; key: string } | null> {
        const secret = this.config.events?.internalSecret;
        if (this.config.events?.workerRuntime !== true || !secret) return null;

        const set = await this.stores.eventHandler.setForApp(appUid);
        if (set.length === 0) return null;

        // A gone or suspended owner is nobody to deploy or bill this as, so
        // there is nothing to address — retriable rather than a kill switch,
        // the same posture `no-owner` takes on the deploy side.
        const app = await this.stores.app.getByUid(appUid);
        const ownerUserId = Number(
            (app as { owner_user_id?: unknown } | null)?.owner_user_id,
        );
        if (!app || !Number.isFinite(ownerUserId)) return null;
        const owner = await this.stores.user.getById(ownerUserId);
        if (!owner || owner.suspended) return null;

        const script = eventsWorkerScript(
            handlerSetHash(set),
            eventsWorkerScope(this.config),
        );
        return { script, key: eventsInvokeKey(secret, script) };
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
            if (
                !(await this.#chargeable(
                    delivery.meter,
                    delivery.envelope.subId,
                ))
            )
                return;

            const allowed = await checkRateLimit(
                `${EVENTS_BROADCAST_DELIVERY_LIMIT.scope}:${delivery.envelope.subId}`,
                EVENTS_BROADCAST_DELIVERY_LIMIT.limit,
                EVENTS_BROADCAST_DELIVERY_LIMIT.window,
            );
            if (allowed) {
                await this.#send(delivery);
                return;
            }
            // The marker goes to the socket only: running the handler on a
            // notice that its event was dropped is the invocation the budget
            // was refusing.
            await this.#send({
                target: delivery.target,
                socket: delivery.socket,
                remote: delivery.remote,
                meter: delivery.meter,
                envelope: {
                    subId: delivery.envelope.subId,
                    event: rateLimitGap(delivery.envelope.event),
                },
                bill: false,
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
    async #send(delivery: AddressedDelivery): Promise<void> {
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

            // Every connected subscriber gets a `broadcast`, and the ones this
            // region cannot reach are wherever presence says they are.
            if (delivery.remote)
                void this.services.eventForward
                    .fanOut({
                        holderUserId: delivery.meter.holderUserId,
                        appUid: delivery.meter.appUid,
                        subId: delivery.envelope.subId,
                        event: delivery.envelope.event,
                    })
                    .catch((err: unknown) => {
                        console.warn('[events] forward failed', err);
                    });
        }

        let invoked = false;
        if (delivery.worker) {
            // At-most-once by construction: a `broadcast` invocation is never
            // retried, which is why the docs ask handlers to be idempotent
            // rather than promising them each event exactly once. It counts
            // toward nothing either — a row whose socket copies are arriving
            // must not be stopped by a handler nobody is waiting on. Only a
            // settled outcome counts as delivered — a failed or still-retrying
            // run must not bill or report a broadcast that never landed.
            try {
                invoked =
                    (await this.#invokeHandler(delivery.worker)) === 'settled';
            } catch (err) {
                console.warn('[events] handler invocation failed', err);
            }
        }

        // Nothing carried it, so nothing was delivered — and a delivery that
        // did not happen is not billed.
        if (delivery.socket || invoked)
            this.#delivered(delivery.envelope, delivery.meter, delivery.bill);
    }

    /**
     * One event reached a subscriber. Metering rides the same call the seam
     * does, so a delivery cannot be reported without being charged for: nothing
     * filtered out, coalesced away, rate limited or refused for credit gets
     * here, and a gap marker — a notice of loss rather than a delivery — is
     * reported without a line. `bill` is false for a `single` retry: the event
     * it carries was already charged for on an earlier attempt.
     */
    #delivered(
        envelope: DeliveryEnvelope,
        meter: DeliveryMeter,
        bill: boolean,
    ): void {
        this.onDelivered(envelope);
        if (envelope.event.op === 'gap' || !bill) return;
        void this.#meterDelivery(meter);
    }

    /**
     * Called once per event that actually reached a subscriber, gap markers
     * included.
     */
    onDelivered(_envelope: DeliveryEnvelope): void {
        return;
    }

    // -- Metering ----------------------------------------------------

    /**
     * Record one delivered event against its subscription's holder. Buffered
     * rather than written: a line is worth a fraction of a microcent and they
     * arrive per event, so writing each one would cost more than it records.
     */
    async #meterDelivery(meter: DeliveryMeter): Promise<void> {
        const metering = this.services.metering;
        if (!metering) return;
        try {
            const actor = await this.#meterActor(meter);
            if (!actor) return;
            const usageType = DELIVERY_USAGE_TYPES[meter.deliveryClass];
            metering.bufferIncrementUsages(actor, [
                {
                    usageType,
                    usageAmount: 1,
                    costOverride: EVENTS_COSTS[usageType],
                },
            ]);
        } catch (err) {
            console.warn('[events] could not meter a delivery', err);
        }
    }

    /**
     * Whether this holder's deliveries can still be charged for. Answered from
     * the metering service's own cache, so it costs a map read per coalesced
     * delivery rather than a lookup per event; the account that cannot pay has
     * the subscription suspended and is told once, and comes back through the
     * credit sweep.
     */
    async #chargeable(meter: DeliveryMeter, subId: string): Promise<boolean> {
        const actor = await this.#meterActor(meter);
        if (!actor) return true;

        try {
            await assertActorHasCredits(
                this.services.metering,
                actor,
                this.config,
            );
            return true;
        } catch (err) {
            if (!isHttpError(err) || err.statusCode !== 402) {
                // Not being able to read a balance is our problem, not a reason
                // to stop delivering.
                console.warn('[events] could not read a balance', err);
                return true;
            }
        }

        // A session row has no state to suspend and nothing that outlives the
        // connection: it simply stops being delivered to.
        if (meter.durable && (await this.suspendForNoCredit(subId)))
            await this.#notifyNoCredit(meter.holderUserId, meter.appUid);
        return false;
    }

    /** Tell a holder their subscriptions stopped, and what brings them back. */
    async #notifyNoCredit(
        holderUserId: number,
        appUid: string | null,
    ): Promise<void> {
        try {
            // The holder's news rather than the developer's — they are the one
            // billed, and the one who can act on it.
            await this.services.notification.notify(
                [holderUserId],
                {
                    title: 'Event delivery stopped',
                    reason: 'no_credit',
                },
                { type: 'app.events.ended', appUid },
            );
        } catch (err) {
            console.warn('[events] could not report an empty balance', err);
        }
    }

    /**
     * Run a handler, unless this (account, app) has spent its invocations for
     * the minute. `null` says nothing ran: a `single` stays owed and its lease
     * paces the next attempt, and a `broadcast` copy is simply not made.
     */
    async #invokeHandler(
        invocation: WorkerInvocation,
    ): Promise<WorkerInvocationOutcome | null> {
        const allowed = await checkRateLimit(
            `${EVENTS_WORKER_INVOCATION_LIMIT.scope}:${invocation.holderUserId}:${invocation.appUid ?? ''}`,
            EVENTS_WORKER_INVOCATION_LIMIT.limit,
            EVENTS_WORKER_INVOCATION_LIMIT.window,
        );
        if (!allowed) return null;
        return this.worker.invoke(invocation);
    }

    /**
     * The identity a holder's lines are written as: their account, acting as
     * the app whose subscription this is, so usage lands where the account can
     * see which app produced it.
     */
    async #meterActor(meter: DeliveryMeter): Promise<Actor | null> {
        const key = `${meter.holderUserId}|${meter.appUid ?? ''}`;
        const now = Date.now();
        const held = this.#meterActors.get(key);
        if (held && held.expiresAt > now) return held.actor;

        const user = await this.stores.user.getById(meter.holderUserId);
        if (!user) return null;
        const actor = makeActor({
            user,
            app: meter.appUid ? { uid: meter.appUid } : null,
        });

        // Insertion-ordered, so the oldest goes when a burst of one-off holders
        // would otherwise grow this without bound.
        if (this.#meterActors.size >= METER_ACTOR_LIMIT) {
            const oldest = this.#meterActors.keys().next().value;
            if (oldest !== undefined) this.#meterActors.delete(oldest);
        }
        this.#meterActors.set(key, {
            actor,
            expiresAt: now + METER_ACTOR_TTL_MS,
        });
        return actor;
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
                'outer.pubsub.events.generationBumped',
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

    #kvShareDeps(): KvSharedRegionDeps {
        return {
            enabled: this.kvHandlesEnabled,
            checkPermission: (actor, permission) =>
                this.services.permission.check(actor, permission),
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

    #armCreditSweep(): void {
        if (!this.enabled) return;
        const sweep = setInterval(() => {
            void this.sweepNoCredit().catch((err) => {
                console.warn('[events] credit sweep failed', err);
            });
        }, NO_CREDIT_SWEEP_INTERVAL_MS);
        sweep.unref?.();
        this.#creditSweep = sweep;
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
