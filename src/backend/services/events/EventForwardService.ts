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

import type { Actor } from '../../core/actor.js';
import {
    PRESENCE_NO_APP,
    type PresenceRow,
} from '../../stores/events/PresenceStore.js';
import { runWithConcurrencyLimitSettled } from '../../util/concurrency.js';
import {
    appSocketRoom,
    type SocketSpecifier,
} from '../socket/SocketService.js';
import { PuterService } from '../types.js';
import {
    FORWARD_MAX_QUEUED,
    FORWARD_MAX_QUEUED_BYTES,
    PeerForwardQueue,
    type ForwardAck,
    type ForwardBatch,
    type ForwardDelivery,
    type ForwardItem,
    type ForwardReply,
} from './forwardQueue.js';
import { PresenceCache, remoteRegions } from './presenceCache.js';
import type { DeliverableEvent, GapMarker } from './registry.js';

/**
 * Getting a socket delivery to the region that holds the socket.
 *
 * Cross-region traffic here is proportional to matched socket deliveries with a
 * live client somewhere else — never to event volume, and never to connected
 * population. Three things hold that line:
 *
 * - **Presence says where to send**, and is read through a generation-keyed
 *   region-local cache, so a busy subscription against a settled row reads the
 *   table once.
 * - **Nothing is broadcast on the chance someone is listening.** An empty row is
 *   no hop at all, which is the common case, and a deployment with no peers
 *   configured never gets as far as reading one.
 * - **Wrong rows are corrected on the read path.** A peer that answers "no
 *   socket" from its own registry is authoritative, and its region is removed
 *   with a write conditional on the version that was read. A peer that times
 *   out is not: a timeout is ambiguous, and evicting on it would blackhole a
 *   healthy region for the length of a partition and beyond it.
 *
 * No delivery state crosses a region. A `single`'s lease, retry counter and
 * queue live where it was emitted; a peer holding the socket relays the
 * client's ack home, and that is the whole of what it knows.
 */

/** Path peers accept addressed event batches on. */
export const FORWARD_WEBHOOK_PATH = '/broadcast/events';

/** Identities held so a delivery need not look one up to address a row. */
const UUID_CACHE_MAX = 10_000;

/** Where a delivery is put down once it reaches the region holding the socket. */
export const forwardTarget = (
    userId: number,
    appUid: string | null,
): SocketSpecifier =>
    appUid ? { room: appSocketRoom(userId, appUid) } : { room: String(userId) };

/** The presence pair a socket, or a subscription row, belongs to. */
export const presenceApp = (appUid: string | null | undefined): string =>
    appUid ?? PRESENCE_NO_APP;

/** One delivery, in the terms this service addresses it by. */
export interface ForwardableDelivery {
    holderUserId: number;
    appUid: string | null;
    subId: string;
    event: DeliverableEvent;
    ackRequired?: true;
    ackId?: string;
}

/** What stands in for events a full queue could not carry across. */
const overflowGap = (event: DeliverableEvent): GapMarker => ({
    id: event.id,
    subject: event.subject,
    op: 'gap',
    reason: 'backlog_overflow',
    ts: event.ts,
});

export class EventForwardService extends PuterService {
    readonly #cache = new PresenceCache();
    /** UserId → uuid, which is what the presence row is keyed by. */
    readonly #uuids = new Map<number, string>();
    readonly #leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Peer → subscriptions with a gap marker still queued for it. */
    readonly #pendingMarkers = new Map<string, Set<string>>();
    #queue: PeerForwardQueue | null = null;
    #draining = false;

    /**
     * How long a region waits before taking itself out of a row. Reloads, flaky
     * networks and rolling deploys all reconnect inside it and write nothing at
     * all, which is the point — the write is an optimisation, since lazy repair
     * is what actually keeps rows honest.
     */
    static LEAVE_DELAY_MIN_MS = 30_000;
    static LEAVE_DELAY_MAX_MS = 60_000;

    /** Deliveries held for one peer before the oldest are shed with markers. */
    static MAX_QUEUED = FORWARD_MAX_QUEUED;
    /** Bytes held for one peer before the oldest are shed with markers. */
    static MAX_QUEUED_BYTES = FORWARD_MAX_QUEUED_BYTES;

    /** Concurrency `receive()` settles a peer's relayed acks under. */
    static RECEIVE_CONCURRENCY = 16;

    override onServerStart(): void {
        this.clients.event.on(
            'outer.pubsub.events.presenceBumped',
            (_key, data, meta) => {
                // Our own emit reaches local listeners too, and that half has
                // already been applied.
                if (!(meta as { from_outside?: boolean })?.from_outside) return;
                const { userId } = (data ?? {}) as { userId?: number };
                if (typeof userId === 'number') this.#cache.bump(userId);
            },
        );
    }

    override async onServerPrepareShutdown(): Promise<void> {
        // A drain is not a disconnect: every socket on this node is going at
        // once, and writing a row for each would be the burst the transition-
        // only rule exists to avoid. Lazy repair corrects what is left.
        this.#draining = true;
        for (const timer of this.#leaveTimers.values()) clearTimeout(timer);
        this.#leaveTimers.clear();
        await this.#queue?.flushAll();
        this.#queue?.stop();
    }

    /**
     * Whether anything here has work to do. A deployment with no peers has
     * nowhere to forward and nobody to read its rows, so it takes no part in
     * presence at all — not a write, not a read, not a timer.
     */
    get active(): boolean {
        return (
            this.config.events?.enabled === true &&
            this.services.broadcast.addressablePeers.length > 0
        );
    }

    /** What this deployment calls itself in a presence row. */
    get region(): string {
        return this.services.broadcast.regionId;
    }

    // -- Presence transitions ----------------------------------------

    /**
     * One more connection for the pair. Only the one that crosses zero in this
     * region writes: every reconnect after it is a counter increment. Crossing
     * zero says a transition happened on this node; the region-shared pin is
     * what says whether a sibling node already wrote it in.
     */
    async noteConnect(actor: Actor): Promise<void> {
        if (!this.active) return;
        const pair = this.#pairOf(actor);
        if (!pair) return;

        // A reconnect inside the window cancels the write the disconnect owed
        // — and owes none of its own when the row still holds this region. A
        // reload, a flaky network and a rolling deploy all land here.
        const pending = this.#leaveTimers.get(pair.key);
        if (pending) {
            clearTimeout(pending);
            this.#leaveTimers.delete(pair.key);
        }

        const count = await this.stores.presence.addConnection(
            pair.userId,
            pair.appUid,
        );
        if (count !== 1) return;
        if (
            !(await this.stores.presence.acquireJoinPin(
                pair.userId,
                pair.appUid,
            ))
        )
            return;
        await this.stores.presence.join(
            pair.userUuid,
            pair.appUid,
            this.region,
        );
        await this.#bump(pair.userId);
    }

    /**
     * One connection gone. The last one owes the region's removal, but not yet:
     * a reload is a disconnect followed immediately by a connect, and both
     * writes are avoidable.
     */
    async noteDisconnect(actor: Actor): Promise<void> {
        if (!this.active) return;
        const pair = this.#pairOf(actor);
        if (!pair) return;

        const count = await this.stores.presence.removeConnection(
            pair.userId,
            pair.appUid,
        );
        if (count > 0 || this.#draining) return;

        const delay =
            EventForwardService.LEAVE_DELAY_MIN_MS +
            Math.random() *
                Math.max(
                    0,
                    EventForwardService.LEAVE_DELAY_MAX_MS -
                        EventForwardService.LEAVE_DELAY_MIN_MS,
                );
        const timer = setTimeout(() => {
            this.#leaveTimers.delete(pair.key);
            void this.#leaveIfStillGone(pair).catch((err: unknown) => {
                console.warn('[events] presence leave failed', err);
            });
        }, delay);
        timer.unref?.();
        this.#leaveTimers.set(pair.key, timer);
    }

    async #leaveIfStillGone(pair: PresencePair): Promise<void> {
        if (this.#draining) return;
        if (
            await this.stores.presence.holdsConnection(pair.userId, pair.appUid)
        )
            return;
        const row = await this.stores.presence.read(pair.userUuid, pair.appUid);
        const connectedAt = row.regions[this.region];
        if (connectedAt === undefined) {
            // Already gone — a repair likely got there first. Release the pin
            // regardless, so a reconnect that lost its own join race while
            // this was still deciding is not left permanently unpinned.
            await this.stores.presence.releaseJoinPin(pair.userId, pair.appUid);
            return;
        }
        const left = await this.stores.presence.leave(
            pair.userUuid,
            pair.appUid,
            this.region,
            connectedAt,
        );
        if (!left) return; // a fresher join already replaced this one

        await this.stores.presence.releaseJoinPin(pair.userId, pair.appUid);
        // A connect that lost the join-pin race while this leave was still in
        // flight has nothing written for it now that the pin is free. Close
        // that gap immediately instead of waiting for the pair's next
        // transition, which for a long-lived tab may never come.
        if (
            await this.stores.presence.holdsConnection(pair.userId, pair.appUid)
        ) {
            if (
                await this.stores.presence.acquireJoinPin(
                    pair.userId,
                    pair.appUid,
                )
            )
                await this.stores.presence.join(
                    pair.userUuid,
                    pair.appUid,
                    this.region,
                );
        }
        await this.#bump(pair.userId);
    }

    /**
     * Renew this region's item for a socket that has stayed connected without a
     * transition. `touchConnection` gates its own write behind a region-shared
     * claim, so calling it on every renewal only ever costs a Redis command; a
     * table write happens for whichever caller wins the claim, at most once per
     * pair per region per refresh window.
     */
    async touchPresence(userId: number, appUid: string): Promise<void> {
        if (!this.active) return;
        const userUuid = await this.#uuidOf(userId);
        if (!userUuid) return;
        await this.stores.presence.touchConnection(userId, appUid, {
            userUuid,
            region: this.region,
        });
    }

    // -- Forwarding --------------------------------------------------

    /**
     * Hand one `broadcast` delivery to every other region holding a socket for
     * the pair. The emitting region has already delivered its own copy and
     * never asks presence about itself.
     */
    async fanOut(delivery: ForwardableDelivery): Promise<void> {
        if (!this.active) return;
        const regions = await this.regionsFor(
            delivery.holderUserId,
            delivery.appUid,
        );
        for (const region of regions) this.#send(region, delivery);
    }

    /**
     * The region to try for one `single` attempt, or `null` when the candidates
     * are spent. Ordered most-recently-connected first, which is the socket
     * most likely to still be there.
     */
    async candidateRegion(
        holderUserId: number,
        appUid: string | null,
        attempt: number,
    ): Promise<string | null> {
        if (!this.active) return null;
        const regions = await this.regionsFor(holderUserId, appUid);
        return regions[attempt] ?? null;
    }

    /** Send one `single` to a named region, carrying what settles it. */
    handOff(region: string, delivery: ForwardableDelivery): void {
        this.#send(region, delivery);
    }

    /**
     * Relay a client's settle to the region that owns the lease. Nothing is
     * settled locally: the queue it belongs to is not here.
     */
    relayAck(
        region: string,
        userId: number,
        subId: string,
        entryId: string,
    ): void {
        if (!this.active) return;
        if (!this.services.broadcast.addressablePeers.includes(region)) return;
        this.#queueFor().push(region, {
            kind: 'ack',
            userId,
            subId,
            entryId,
        });
    }

    /** Whether a region name is a peer this node can address. */
    isPeer(region: string): boolean {
        return this.services.broadcast.addressablePeers.includes(region);
    }

    /**
     * Regions other than this one holding a socket for the pair, read through
     * the generation-keyed cache and narrowed to regions this deployment can
     * still address. An unaddressable name would otherwise sit at the head of
     * the recency-sorted row forever: nothing can reach it, so nothing ever
     * answers `noSocket`, and lazy repair never fires. A fresh table read
     * prunes any it finds, through the same conditional delete `#repair` uses.
     */
    async regionsFor(
        holderUserId: number,
        appUid: string | null,
    ): Promise<string[]> {
        const app = presenceApp(appUid);
        const cached = this.#cache.read(holderUserId, app);
        if (cached) return this.#addressableRegions(cached);

        const userUuid = await this.#uuidOf(holderUserId);
        if (!userUuid) return [];

        const epoch = this.#cache.generationOf(holderUserId);
        let row: PresenceRow;
        try {
            row = await this.stores.presence.read(userUuid, app);
        } catch (err) {
            console.warn('[events] presence read failed', err);
            return [];
        }
        this.#cache.write(holderUserId, app, epoch, row);

        for (const region of Object.keys(row.regions))
            if (region !== this.region && !this.isPeer(region))
                void this.#repair(region, holderUserId, appUid);

        return this.#addressableRegions(row);
    }

    #addressableRegions(row: PresenceRow): string[] {
        return remoteRegions(row, this.region).filter((region) =>
            this.isPeer(region),
        );
    }

    // -- Inbound -----------------------------------------------------

    /**
     * Apply one peer's batch. Deliveries go out over this region's own sockets;
     * acks settle where the lease actually lives, which is here. The reply
     * names the pairs this region holds nothing for — the only signal that lets
     * the sender edit the row.
     *
     * Deliveries keep the batch's order, so a subscription's events reach its
     * socket as emitted; settles are each a row read, a queue write and a
     * drain, so they run under a concurrency bound instead.
     */
    async receive(batch: ForwardBatch): Promise<ForwardReply> {
        const items = batch.items ?? [];

        for (const item of items) {
            if (item.kind !== 'delivery') continue;
            try {
                await this.services.events.deliverForwarded(item);
            } catch (err) {
                console.warn('[events] forwarded delivery failed', err);
            }
        }

        const acks = items.filter(
            (item): item is ForwardAck => item.kind === 'ack',
        );
        const settled = await runWithConcurrencyLimitSettled(
            acks,
            EventForwardService.RECEIVE_CONCURRENCY,
            (ack) =>
                this.services.events.settleRelayedAck(
                    ack.userId,
                    ack.subId,
                    ack.entryId,
                ),
        );
        for (const outcome of settled)
            if (outcome.status === 'rejected')
                console.warn('[events] relayed ack failed', outcome.reason);

        // One `#holdsSocket` check per (user, app) pair in the batch, not per
        // item — a busy subscription can carry many deliveries for the same
        // pair in one window.
        const pairs = new Map<
            string,
            { userId: number; appUid: string | null }
        >();
        for (const item of items)
            if (item.kind === 'delivery') {
                const key = `${item.userId}|${presenceApp(item.appUid)}`;
                if (!pairs.has(key))
                    pairs.set(key, {
                        userId: item.userId,
                        appUid: item.appUid,
                    });
            }

        const candidates = [...pairs.values()];
        const checks = await runWithConcurrencyLimitSettled(
            candidates,
            EventForwardService.RECEIVE_CONCURRENCY,
            (pair) => this.#holdsSocket(pair),
        );
        const noSocket: Array<{ userId: number; appUid: string | null }> = [];
        candidates.forEach((pair, i) => {
            const outcome = checks[i];
            if (outcome.status === 'fulfilled' && !outcome.value)
                noSocket.push(pair);
            else if (outcome.status === 'rejected')
                console.warn(
                    '[events] holdsSocket check failed',
                    outcome.reason,
                );
        });

        return noSocket.length > 0 ? { noSocket } : {};
    }

    /**
     * Whether this region has anywhere to put deliveries for the pair. The
     * per-region connection counter is the honest answer: the socket registry
     * on one node says nothing about the others. A `false` tells the emitting
     * region to repair its row, so it also releases this region's join pin — or
     * the next connect here would skip writing itself back in.
     */
    async #holdsSocket(pair: {
        userId: number;
        appUid: string | null;
    }): Promise<boolean> {
        if (this.services.socket.has(forwardTarget(pair.userId, pair.appUid)))
            return true;
        const app = presenceApp(pair.appUid);
        // Still in the row on purpose: a pair inside its disconnect window is
        // one this region expects back, and has not written itself out for.
        if (this.#leaveTimers.has(`${pair.userId}|${app}`)) return true;
        try {
            const holds = await this.stores.presence.holdsConnection(
                pair.userId,
                app,
            );
            if (!holds)
                await this.stores.presence.releaseJoinPin(pair.userId, app);
            return holds;
        } catch {
            // Unable to tell is not "definitely not": a repair has to be
            // affirmative, so this reports a socket rather than inviting one.
            return true;
        }
    }

    // -- Transport ---------------------------------------------------

    #send(region: string, delivery: ForwardableDelivery): void {
        if (!this.isPeer(region)) return;
        const item: ForwardDelivery = {
            kind: 'delivery',
            userId: delivery.holderUserId,
            appUid: delivery.appUid,
            subId: delivery.subId,
            event: delivery.event,
            ...(delivery.ackRequired
                ? {
                      ackRequired: true as const,
                      ackId: delivery.ackId,
                      origin: this.region,
                  }
                : {}),
        };
        this.#queueFor().push(region, item);
    }

    #queueFor(): PeerForwardQueue {
        this.#queue ??= new PeerForwardQueue({
            maxQueued: EventForwardService.MAX_QUEUED,
            maxQueuedBytes: EventForwardService.MAX_QUEUED_BYTES,
            send: (peerId, items) => this.#ship(peerId, items),
            onOverflow: (peerId, dropped) => this.#overflowed(peerId, dropped),
        });
        return this.#queue;
    }

    async #ship(peerId: string, items: ForwardItem[]): Promise<void> {
        // Shipped or lost, these are out of the queue either way, so the next
        // shed for their subscriptions may queue a marker again.
        this.#forgetMarkers(peerId, items);
        const batch: ForwardBatch = { from: this.region, items };
        const reply = (await this.services.broadcast.postToPeer(
            peerId,
            FORWARD_WEBHOOK_PATH,
            batch,
        )) as ForwardReply | null;

        for (const missing of reply?.noSocket ?? [])
            await this.#repair(peerId, missing.userId, missing.appUid);
    }

    /**
     * Take a region out of a row it is no longer addressable in — either it
     * answered `noSocket` for itself, or a fresh read found a name that is not
     * a peer at all. Conditional on the `connectedAt` that was read: a connect
     * racing this repair writes a fresh one, and the repair loses harmlessly
     * rather than blackholing a socket that just arrived.
     */
    async #repair(
        region: string,
        userId: number,
        appUid: string | null,
    ): Promise<void> {
        const app = presenceApp(appUid);
        if (!this.#cache.claimRepair(userId, app, region)) return;

        const userUuid = await this.#uuidOf(userId);
        if (!userUuid) return;
        const row = this.#cache.read(userId, app);
        const connectedAt = row?.regions[region];
        if (connectedAt === undefined) return;

        try {
            const applied = await this.stores.presence.leave(
                userUuid,
                app,
                region,
                connectedAt,
            );
            if (!applied) return;
            this.#cache.forget(userId, app, region);
            await this.#bump(userId);
        } catch (err) {
            console.warn('[events] presence repair failed', err);
        }
    }

    /**
     * Deliveries the queue could not hold. Never a log line on its own: each
     * subscription that lost events gets a marker in their place — handed back
     * to the queue, which puts it where the shed just made room — and the
     * region being this far behind is worth someone's attention.
     *
     * One marker per (peer, subscription) at a time. A subscription still
     * losing events while its marker waits has already been told, and a second
     * marker would take a slot from a delivery; a marker that is itself shed
     * frees the slot for the next one.
     */
    #overflowed(peerId: string, dropped: ForwardItem[]): ForwardItem[] {
        const pending = this.#pendingMarkersFor(peerId);
        const markers: ForwardItem[] = [];
        for (const item of dropped) {
            if (item.kind !== 'delivery') continue;
            if (item.event.op === 'gap') {
                pending.delete(item.subId);
                continue;
            }
            // A `single` loses nothing here: its lease is still running, and
            // the next attempt is what the expiry is for.
            if (item.ackRequired || pending.has(item.subId)) continue;
            pending.add(item.subId);
            markers.push({ ...item, event: overflowGap(item.event) });
        }

        this.clients.alarm.create(
            'events_forward_overflow',
            'Events queued for another region were dropped to stay inside the queue bound',
            { peerId, dropped: dropped.length },
            'warning',
            { dedup: true },
        );
        return markers;
    }

    #pendingMarkersFor(peerId: string): Set<string> {
        let pending = this.#pendingMarkers.get(peerId);
        if (!pending) {
            pending = new Set();
            this.#pendingMarkers.set(peerId, pending);
        }
        return pending;
    }

    #forgetMarkers(peerId: string, items: ForwardItem[]): void {
        const pending = this.#pendingMarkers.get(peerId);
        if (!pending) return;
        for (const item of items)
            if (item.kind === 'delivery' && item.event.op === 'gap')
                pending.delete(item.subId);
    }

    // -- Generation --------------------------------------------------

    /**
     * Say that presence moved. One `INCR` and one broadcast, the same shape the
     * watched-token set and the permission cache use — which is what makes
     * reads scale with transitions rather than with events.
     */
    async #bump(userId: number): Promise<void> {
        try {
            const generation =
                await this.stores.presence.bumpGeneration(userId);
            this.#cache.bump(userId, generation);
            this.clients.event.emit(
                'outer.pubsub.events.presenceBumped',
                { userId, generation },
                {},
            );
        } catch (err) {
            this.#cache.bump(userId);
            console.warn('[events] presence generation bump failed', err);
        }
    }

    // -- Plumbing ----------------------------------------------------

    #pairOf(actor: Actor): PresencePair | null {
        const userId = actor.user?.id;
        const userUuid = actor.user?.uuid;
        if (typeof userId !== 'number' || !userUuid) return null;
        const appUid = presenceApp(actor.effectiveApp?.uid ?? null);
        this.#rememberUuid(userId, userUuid);
        return { userId, userUuid, appUid, key: `${userId}|${appUid}` };
    }

    async #uuidOf(userId: number): Promise<string | null> {
        const held = this.#uuids.get(userId);
        if (held) return held;
        try {
            const user = await this.stores.user.getById(userId);
            const uuid = user?.uuid;
            if (!uuid) return null;
            this.#rememberUuid(userId, uuid);
            return uuid;
        } catch {
            return null;
        }
    }

    #rememberUuid(userId: number, uuid: string): void {
        this.#uuids.delete(userId);
        this.#uuids.set(userId, uuid);
        while (this.#uuids.size > UUID_CACHE_MAX) {
            const oldest = this.#uuids.keys().next();
            if (oldest.done) break;
            this.#uuids.delete(oldest.value);
        }
    }
}

interface PresencePair {
    userId: number;
    userUuid: string;
    appUid: string;
    key: string;
}
