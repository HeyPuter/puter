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
import type { EventKey } from '../../clients/event/types.js';
import {
    EVENTS_BROADCAST_DELIVERY_LIMIT,
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT,
    EVENTS_SUBSCRIBE_LIMIT,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import {
    SESSION_SUBSCRIPTION_TTL_SECONDS,
    type DispatchSubscription,
    type DurableSubscription,
    type GenerationBump,
    type SessionSubscription,
} from '../../stores/events/EventSubscriptionStore.js';
import {
    isSubscriptionTarget,
    type SubscriptionTarget,
} from '../../stores/events/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { PageResult } from '../../util/pagination.js';
import type { AclMode, ResourceDescriptor } from '../acl/ACLService.js';
import { resolveNode } from '../fs/resolveNode.js';
import {
    appSocketRoom,
    type SocketSpecifier,
} from '../socket/SocketService.js';
import { PuterService } from '../types.js';
import { resolveFsAnchor, type FsAnchorDeps } from './anchors.js';
import {
    assertSubscribeAuthorized,
    checkDeliveryAuthorized,
    nodeDescriptor,
    rowInActorScope,
    type EventAclDeps,
} from './authorization.js';
import { DeliveryCoalescer } from './coalescer.js';
import {
    FILTER_EVALUATIONS_PER_EVENT,
    compileMatch,
    evaluateWithCap,
    relativeTo,
    type CompiledMatch,
} from './matcher.js';
import {
    lookupPublicSubject,
    type DeliveryClass,
    type EventContext,
    type ProjectedEvent,
    type PublicSubject,
} from './registry.js';
import { SubscriptionCache } from './subscriptionCache.js';
import { parseSubject, type FsOp } from './subjects.js';

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
}

export interface UnsubscribeRequest {
    subId?: unknown;
}

/** Body of `POST /events/subscribe`. */
export interface DurableSubscribeRequest extends SubscribeRequest {
    delivery?: unknown;
    targets?: unknown;
    handlerName?: unknown;
    context?: unknown;
    expiresAt?: unknown;
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
}

/**
 * A durable row as its holder sees it. `context` is deliberately absent: it is
 * read on the delivery path and nowhere else, and a listing is the one surface
 * an app can call repeatedly.
 */
export interface DurableSubscriptionView extends SubscriptionView {
    delivery: DeliveryClass;
    targets: SubscriptionTarget[];
    handlerName: string | null;
    appUid: string | null;
    createdAt: number;
    expiresAt: number | null;
    suspendedAt: number | null;
    suspendedReason: string | null;
}

export type VerbAck<T extends object> =
    | ({ ok: true } & T)
    | { ok: false; error: { code: string; message: string } };

export type GapReason =
    | 'matched_subscription_limit'
    | 'filter_evaluation_limit'
    | 'delivery_rate_limit';

/**
 * `gap` says an event existed and was not delivered. It rides the delivery
 * channel because a subscriber that never saw one would read the silence as
 * "nothing happened", and carries no `uid`/`path` — what was dropped is exactly
 * what it cannot name.
 */
export interface GapMarker {
    id: string;
    subject: string;
    op: 'gap';
    reason: GapReason;
    ts: number;
}

/** One delivery, as the client receives it. */
export interface DeliveryEnvelope {
    subId: string;
    event: ProjectedEvent | GapMarker;
}

/** The envelope plus where it goes. The address is not part of the wire. */
interface AddressedDelivery {
    target: SocketSpecifier;
    envelope: DeliveryEnvelope;
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

// -- Socket wire names ------------------------------------------------

export const EVENTS_SUBSCRIBE_VERB = 'events.subscribe';
export const EVENTS_UNSUBSCRIBE_VERB = 'events.unsubscribe';
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

/** Stands until there is a pending-delivery store to take a `single` lease. */
const deliveryClassUnavailable = (): HttpError =>
    new HttpError(501, 'Delivery class `single` is not available yet', {
        legacyCode: 'delivery_class_unavailable',
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
});

const toDurableView = (sub: DurableSubscription): DurableSubscriptionView => ({
    ...toView(sub),
    delivery: sub.delivery,
    targets: sub.targets,
    handlerName: sub.handlerName,
    appUid: sub.appUid,
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

/**
 * Rows this pass can actually deliver. Durable `single` rows need the pending
 * store to take a lease, and a row with no socket target has asked not to be
 * delivered over one.
 */
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Past `expiresAt` a durable row is finished, sweep or no sweep. */
const unexpired = (row: DispatchSubscription): boolean => {
    if (row.durable !== true) return true;
    const { expiresAt } = row as DurableSubscription;
    return expiresAt === null || expiresAt > nowSeconds();
};

const deliverableOverSockets = (row: DispatchSubscription): boolean =>
    unexpired(row) &&
    (row.durable !== true ||
        (row.delivery === 'broadcast' &&
            (row.targets ?? []).includes('socket')));

// -- Durable request parsing ------------------------------------------

/** Transports a durable row takes unless the caller says otherwise. */
const DEFAULT_DURABLE_TARGETS: SubscriptionTarget[] = ['socket', 'worker'];

/** Longest a `handlerName` may be, matching the column that holds it. */
const HANDLER_NAME_MAX_LENGTH = 128;

const parseDelivery = (value: unknown): DeliveryClass => {
    if (value === undefined || value === null || value === 'broadcast')
        return 'broadcast';
    // Creatable but inert is worse than refused: a `single` row would take a
    // lease nothing in this build can settle.
    if (value === 'single') throw deliveryClassUnavailable();
    throw badRequest(`Unknown delivery class: ${String(value)}`, 'bad_request');
};

const parseTargets = (value: unknown): SubscriptionTarget[] => {
    if (value === undefined || value === null) return DEFAULT_DURABLE_TARGETS;
    if (!Array.isArray(value) || value.length === 0)
        throw badRequest(
            'targets must be a non-empty array',
            'invalid_targets',
        );
    if (!value.every(isSubscriptionTarget))
        throw badRequest('Unknown delivery target', 'invalid_targets');
    return [...new Set(value)];
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
    readonly #compiled = new Map<string, CompiledMatch>();
    readonly #lookups = new Map<string, Promise<boolean>>();
    readonly #refreshTimers = new Map<string, ReturnType<typeof setInterval>>();
    #coalescer: DeliveryCoalescer<AddressedDelivery> | null = null;
    #expirySweep: ReturnType<typeof setInterval> | null = null;
    #expiryKick: ReturnType<typeof setTimeout> | null = null;

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
        this.#armExpirySweep();
    }

    override onServerPrepareShutdown(): void {
        if (this.#expiryKick) clearTimeout(this.#expiryKick);
        this.#expiryKick = null;
        if (this.#expirySweep) clearInterval(this.#expirySweep);
        this.#expirySweep = null;
    }

    override onServerShutdown(): void {
        for (const timer of this.#refreshTimers.values()) clearInterval(timer);
        this.#refreshTimers.clear();
    }

    /** The master switch. Read on every write, so it stays a field lookup. */
    get enabled(): boolean {
        return this.config.events?.enabled === true;
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

        const rawSubject = String(request?.subject ?? '');
        const anchor = await this.#resolveSubscribeAnchor(actor, rawSubject);

        const sub: SessionSubscription = {
            subId: randomUUID(),
            socketId,
            holderUserId,
            ownerUserId: anchor.ownerUserId,
            subject: rawSubject,
            token: anchor.token,
            anchorUid: anchor.uid,
            anchorPath: anchor.path,
            match: anchor.match,
            op: anchor.op,
            appUid: actor.effectiveApp?.uid ?? null,
            permission: anchor.permission,
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
        const targets = parseTargets(request?.targets);
        const handlerName = parseHandlerName(request?.handlerName);
        const context = parseContext(request?.context);
        const expiresAt = parseExpiresAt(request?.expiresAt);

        const rawSubject = String(request?.subject ?? '');
        const anchor = await this.#resolveSubscribeAnchor(actor, rawSubject);

        const { row, bump } = await this.stores.durableSubscription.create({
            holderUserId,
            ownerUserId: anchor.ownerUserId,
            appUid: actor.effectiveApp?.uid ?? null,
            subject: rawSubject,
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
        this.#forget(subId);
        this.#publishGeneration(bump, true);
    }

    /**
     * Drop rows past their expiry, in batches, and report how many went. Every
     * node sweeps; the delete is idempotent, so two overlapping costs a few
     * empty batches rather than correctness.
     */
    async sweepExpired(): Promise<number> {
        if (!this.enabled) return 0;
        let removed = 0;
        for (let pass = 0; pass < EXPIRY_MAX_BATCHES; pass++) {
            const batch =
                await this.stores.durableSubscription.sweepExpired(
                    EXPIRY_BATCH_SIZE,
                );
            removed += batch;
            if (batch < EXPIRY_BATCH_SIZE) break;
        }
        return removed;
    }

    /**
     * Resolve, authorize and compile one subscribe request. Shared so a durable
     * row cannot be created under a weaker check than a session one.
     */
    async #resolveSubscribeAnchor(
        actor: Actor,
        rawSubject: string,
    ): Promise<{
        token: string;
        uid: string;
        path: string;
        match: string | null;
        op: FsOp | null;
        ownerUserId: number;
        permission: AclMode;
    }> {
        const parsed = parseSubject(rawSubject);
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

        return { ...anchor, ownerUserId: entry.userId, permission };
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

        const subject = lookupPublicSubject(key);
        if (!subject) return;

        const ownerUserId = entry?.userId;
        if (typeof ownerUserId !== 'number') return;

        if (!(await this.#userHasAny(ownerUserId))) return;

        const ancestors = options.ancestors ? await options.ancestors() : [];
        const context: EventContext = {
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

        await this.#route(subject, context, rows, options.actingUserId);
    }

    async #route(
        subject: PublicSubject,
        context: EventContext,
        candidates: DispatchSubscription[],
        actingUserId: number | undefined,
    ): Promise<void> {
        const rows = candidates.filter(deliverableOverSockets);
        if (rows.length === 0) return;

        // One throwaway projection reads the op off the registry entry rather
        // than re-deriving it from the subject string.
        const { op } = subject.project({ ...context, self: false, seq: 0 });
        const matchOn = subject.matchOn(context);

        const evaluated = evaluateWithCap(
            rows,
            (row) => this.#passes(row, op, matchOn),
            FILTER_EVALUATIONS_PER_EVENT,
        );

        const matched = await this.#stillAuthorized(
            evaluated.matched.slice(0, EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT),
            context,
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
            this.#coalesce().push(coalesceKey(row.subId, event.subject), {
                target: deliveryTarget(row),
                envelope: { subId: row.subId, event },
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
    #passes(row: DispatchSubscription, op: FsOp, matchOn: string): boolean {
        if (row.op !== null && row.op !== op) return false;
        if (!row.match) return true;

        const relative = relativeTo(row.anchorPath, matchOn);
        if (relative === null) return false;
        return this.#matcherFor(row).test(relative);
    }

    /**
     * Re-run each surviving row's access against the node the event is about,
     * not against its anchor: a filter that reaches into something the holder
     * cannot list must not deliver from it, and a share revoked after the
     * subscription was made must stop delivering at once rather than when the
     * row is next touched.
     *
     * Last of the filters, because it is the only one that can cost a lookup —
     * and rows that share an identity and a grant share one decision.
     */
    async #stillAuthorized(
        rows: DispatchSubscription[],
        context: EventContext,
    ): Promise<DispatchSubscription[]> {
        if (rows.length === 0) return rows;

        const node = this.#eventDescriptor(context);
        const decisions = new Map<string, Promise<boolean>>();
        const allowed = await Promise.all(
            rows.map((row) => {
                const key = `${row.holderUserId}|${row.appUid ?? ''}|${row.permission}`;
                let decision = decisions.get(key);
                if (!decision) {
                    decision = checkDeliveryAuthorized(
                        row,
                        node,
                        this.#aclDeps(),
                    );
                    decisions.set(key, decision);
                }
                return decision;
            }),
        );
        return rows.filter((_row, i) => allowed[i]);
    }

    /** The event's node as ACL wants it, reusing the walk dispatch already did. */
    #eventDescriptor(context: EventContext): ResourceDescriptor {
        return nodeDescriptor(
            { uid: context.entry.uid, path: context.entry.path },
            { getAncestorChain: async () => context.ancestors },
        );
    }

    #matcherFor(row: DispatchSubscription): CompiledMatch {
        const cached = this.#compiled.get(row.subId);
        if (cached && cached.pattern === row.match) return cached;
        const compiled = compileMatch(row.match as string);
        this.#compiled.set(row.subId, compiled);
        return compiled;
    }

    #gap(
        rows: DispatchSubscription[],
        subject: PublicSubject,
        context: EventContext,
        reason: GapReason,
    ): void {
        for (const row of rows)
            this.#send({
                target: deliveryTarget(row),
                envelope: {
                    subId: row.subId,
                    event: {
                        id: context.id,
                        subject: subject.subject,
                        op: 'gap',
                        reason,
                        ts: context.ts,
                    },
                },
            });
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
     * the connection.
     */
    #send(delivery: AddressedDelivery): void {
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
        this.#coalesce().cancel((key) => key.startsWith(`${subId}|`));
    }

    #anchorDeps(): FsAnchorDeps {
        return {
            resolveNode: (ref) => resolveNode(this.stores.fsEntry, ref),
            getAncestorChain: (path) => this.services.fs.getAncestorChain(path),
        };
    }

    #aclDeps(): EventAclDeps {
        return {
            acl: this.services.acl,
            getAncestorChain: (path) => this.services.fs.getAncestorChain(path),
            getUser: (userId) => this.stores.user.getById(userId),
            getApp: (uid) => this.stores.app.getByUid(uid),
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
            void this.sweepExpired().catch((err) => {
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

    #stopRefresh(holderUserId: number, socketId: string): void {
        const key = `${holderUserId}|${socketId}`;
        const timer = this.#refreshTimers.get(key);
        if (!timer) return;
        clearInterval(timer);
        this.#refreshTimers.delete(key);
    }
}
