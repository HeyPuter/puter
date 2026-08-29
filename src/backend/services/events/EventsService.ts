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
    type GenerationBump,
    type SessionSubscription,
} from '../../stores/events/EventSubscriptionStore.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { ResourceDescriptor } from '../acl/ACLService.js';
import { resolveNode } from '../fs/resolveNode.js';
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

/** What a client gets back for a subscription it just made. */
export interface SubscriptionView {
    subId: string;
    subject: string;
    anchor: { uid: string; path: string };
    match: string | null;
    op: FsOp | null;
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

/** The envelope plus where it goes. The socket id is not part of the wire. */
interface AddressedDelivery {
    socketId: string;
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

const toView = (sub: SessionSubscription): SubscriptionView => ({
    subId: sub.subId,
    subject: sub.subject,
    anchor: { uid: sub.anchorUid, path: sub.anchorPath },
    match: sub.match,
    op: sub.op,
});

/** Coalescing is per (subscription, subject), which is what the key says. */
const coalesceKey = (subId: string, subject: string): string =>
    `${subId}|${subject}`;

export class EventsService extends PuterService {
    readonly #cache = new SubscriptionCache();
    readonly #compiled = new Map<string, CompiledMatch>();
    readonly #refreshTimers = new Map<string, ReturnType<typeof setInterval>>();
    #coalescer: DeliveryCoalescer<AddressedDelivery> | null = null;

    // -- Lifecycle ---------------------------------------------------

    override onServerStart(): void {
        this.clients.event.on(
            'outer.events.generationBumped',
            (_key, data, meta) => {
                // Our own emit reaches local listeners too, and that half has
                // already been applied.
                if (!(meta as { from_outside?: boolean })?.from_outside) return;
                const { userId, generation } = (data ?? {}) as {
                    userId?: number;
                    generation?: number;
                };
                if (typeof userId !== 'number') return;
                this.#cache.bump(userId, generation);
            },
        );
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

        const sub: SessionSubscription = {
            subId: randomUUID(),
            socketId,
            holderUserId,
            ownerUserId: entry.userId,
            subject: rawSubject,
            token: anchor.token,
            anchorUid: anchor.uid,
            anchorPath: anchor.path,
            match: anchor.match,
            op: anchor.op,
            appUid: actor.effectiveApp?.uid ?? null,
            permission,
        };

        const bump = await this.stores.eventSubscription.add(sub);
        this.#publishGeneration(bump);
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
        this.#publishGeneration(bump);
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
            for (const bump of bumps) this.#publishGeneration(bump);
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
        rows: SessionSubscription[],
        actingUserId: number | undefined,
    ): Promise<void> {
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
                socketId: row.socketId,
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
    #passes(row: SessionSubscription, op: FsOp, matchOn: string): boolean {
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
        rows: SessionSubscription[],
        context: EventContext,
    ): Promise<SessionSubscription[]> {
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

    #matcherFor(row: SessionSubscription): CompiledMatch {
        const cached = this.#compiled.get(row.subId);
        if (cached && cached.pattern === row.match) return cached;
        const compiled = compileMatch(row.match as string);
        this.#compiled.set(row.subId, compiled);
        return compiled;
    }

    #gap(
        rows: SessionSubscription[],
        subject: PublicSubject,
        context: EventContext,
        reason: GapReason,
    ): void {
        for (const row of rows)
            this.#send({
                socketId: row.socketId,
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
                socketId: delivery.socketId,
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
     * Addressed at the socket's own id, which socket.io joins every socket to —
     * so the adapter carries it to whichever node terminates the connection.
     */
    #send(delivery: AddressedDelivery): void {
        try {
            void this.services.socket
                .send(
                    { socket: delivery.socketId },
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
     * cold, one `EXISTS`. The generation is captured before the read, so a
     * subscribe that lands mid-flight is not cached over.
     */
    async #userHasAny(userId: number): Promise<boolean> {
        const cached = this.#cache.read(userId);
        if (cached !== null) return cached;

        const generation = this.#cache.generationOf(userId);
        try {
            const hasAny =
                await this.stores.eventSubscription.userHasAny(userId);
            this.#cache.write(userId, generation, hasAny);
            return hasAny;
        } catch {
            // Not being able to tell is the same outcome as no subscribers,
            // and this must not become the writer's problem.
            return false;
        }
    }

    #publishGeneration({ userId, generation }: GenerationBump): void {
        this.#cache.bump(userId, generation);
        try {
            this.clients.event.emit(
                'outer.events.generationBumped',
                { userId, generation },
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

    #stopRefresh(holderUserId: number, socketId: string): void {
        const key = `${holderUserId}|${socketId}`;
        const timer = this.#refreshTimers.get(key);
        if (!timer) return;
        clearInterval(timer);
        this.#refreshTimers.delete(key);
    }
}
