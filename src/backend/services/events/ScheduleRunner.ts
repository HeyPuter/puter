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

import { SCHEDULE_INVOKE_CONNECTIONS } from '../../clients/events/EventsWorkerInvokerClient.js';
import {
    EVENTS_CONSECUTIVE_FAILURES,
    EVENTS_RETRY_MAX_MS,
    EVENTS_SCHEDULE_INVOCATION_LIMIT,
    EVENTS_SCHEDULE_MISSED_CAP,
    EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import {
    SCHEDULE_PARTITIONS,
    type PoppedSchedule,
    type ScheduleIndexChange,
    type ScheduleIndexDef,
    type ScheduleIndexStore,
} from '../../stores/events/ScheduleIndexStore.js';
import { scheduleToken } from '../../stores/events/types.js';
import type { ScheduleInvokeResult } from './EventsService.js';
import { scheduleFire, scheduleLag } from './metrics.js';
import type { ScheduleActionRegistry } from './scheduleActions.js';
import { rememberCron } from './scheduleCron.js';
import { endedChange, slotDefOf } from './scheduleIndex.js';
import {
    countSlots,
    latestSlotAtOrBefore,
    nextSlotAfter,
    recoverOwed,
} from './scheduleSlots.js';
import type {
    ScheduleEvent,
    WorkerInvocation,
    WorkerRunOptions,
} from './workerSeam.js';

/**
 * Fires due schedules. Every node runs one: it pops due members of the region's
 * index under a fenced lease, runs each through the fire path, and settles
 * through the index's scripts, which refuse an attempt whose lease was lost.
 * Nothing on this path reads or writes the primary database except the
 * lifecycle events that change a schedule's state.
 */

export const SCHEDULE_TICK_MS = 2_000;
export const SCHEDULE_POP_LIMIT = 100;
export const SCHEDULE_LEASE_MS = 45_000;
export const SCHEDULE_RENEW_MS = 15_000;
export const SCHEDULE_FINALIZE_RETRY_MS = 60_000;
/** One in-flight run per connection the schedule invoker lane holds. */
export const SCHEDULE_IN_FLIGHT_PER_NODE = SCHEDULE_INVOKE_CONNECTIONS;

/** Runs that finish this close together share one refill. */
const REFILL_DELAY_MS = 100;

/** A tick lands within this share of `SCHEDULE_TICK_MS` either side. */
const TICK_JITTER = 0.2;

/** How long a run waits when who it runs as couldn't be settled. */
const NO_IDENTITY_DEFER_MS = 60_000;
/** How long a run waits for consent a settle may be about to withdraw. */
const NO_CONSENT_DEFER_MS = 60_000;
/** How long a run waits for another deploy of its script, or a free slot. */
const DEPLOY_BUSY_DEFER_MS = 5_000;
/** A holder who can't pay is parked; this only paces a park that failed. */
const NO_CREDIT_DEFER_MS = 60_000;
/** A delayed send whose action isn't registered on this node waits this long. */
const NO_ACTION_DEFER_MS = 60_000;

/** Lag over this at p95, five minutes running, raises the lag alarm. */
const LAG_ALARM_MS = 60_000;
const LAG_ALARM_MINUTES = 5;
const LAG_SAMPLES_PER_MINUTE = 1_000;

/** What the runner needs from the layers around it. */
export interface ScheduleRunnerHost {
    index: ScheduleIndexStore;
    events: {
        invokeForSchedule(
            invocation: WorkerInvocation,
            options: Pick<WorkerRunOptions, 'stampEvent'>,
        ): Promise<ScheduleInvokeResult>;
        resolveScheduleActor(
            holderUserId: number,
            appUid: string,
        ): Promise<Actor | null>;
        chargeableForSchedule(
            holderUserId: number,
            appUid: string,
            subId: string,
        ): Promise<boolean>;
        meterScheduleRun(holderUserId: number, appUid: string): Promise<void>;
        suspendForFailures(subId: string): Promise<boolean>;
    };
    actions: ScheduleActionRegistry;
    /**
     * End a schedule whose last slot settled, in SQL. Returns the version the
     * index is to end it at; throws when the primary write failed.
     */
    finishRun(
        id: string,
        entryVersion: number,
        def: ScheduleIndexDef,
    ): Promise<number>;
    /**
     * End a schedule whose holder or app is gone; the version to end it at.
     * `null` when both turn out to be there, so it is not to be ended.
     */
    endOrphan(
        id: string,
        entryVersion: number,
        def: ScheduleIndexDef,
    ): Promise<number | null>;
    alarm(id: string, message: string, details: Record<string, unknown>): void;
}

export interface ScheduleRunnerOptions {
    inFlightCap?: number;
    popLimit?: number;
    tickMs?: number;
}

/** A lease held while an attempt runs, renewed until it is let go. */
interface HeldLease {
    readonly lost: boolean;
    readonly signal: AbortSignal;
    stop(): void;
}

/**
 * P95 lag per minute over the last few minutes, so a backlog that lasts is told
 * from a burst that drains.
 */
class LagWatch {
    readonly #minutes = new Map<number, number[]>();

    /** Whether every one of the last few whole minutes ran over at p95. */
    record(lagMs: number, now: number): boolean {
        const minute = Math.floor(now / 60_000);
        let samples = this.#minutes.get(minute);
        if (!samples) {
            samples = [];
            this.#minutes.set(minute, samples);
            for (const key of this.#minutes.keys())
                if (key < minute - LAG_ALARM_MINUTES) this.#minutes.delete(key);
        }
        if (samples.length < LAG_SAMPLES_PER_MINUTE) samples.push(lagMs);
        else samples[Math.floor(Math.random() * samples.length)] = lagMs;

        for (let m = minute - LAG_ALARM_MINUTES; m < minute; m++) {
            const window = this.#minutes.get(m);
            if (!window || window.length === 0) return false;
            const sorted = [...window].sort((a, b) => a - b);
            const p95 =
                sorted[
                    Math.min(
                        sorted.length - 1,
                        Math.floor(sorted.length * 0.95),
                    )
                ];
            if (p95 <= LAG_ALARM_MS) return false;
        }
        return true;
    }
}

export class ScheduleRunner {
    readonly #host: ScheduleRunnerHost;
    readonly #cap: number;
    readonly #popLimit: number;
    readonly #tickMs: number;
    readonly #running = new Set<Promise<void>>();
    readonly #lag = new LagWatch();
    #timer: ReturnType<typeof setTimeout> | null = null;
    #stopped = true;
    #ticking: Promise<void> | null = null;
    /** The last visit left due members behind for want of room. */
    #backlogged = false;
    #kick: ReturnType<typeof setTimeout> | null = null;

    constructor(host: ScheduleRunnerHost, options: ScheduleRunnerOptions = {}) {
        this.#host = host;
        this.#cap = options.inFlightCap ?? SCHEDULE_IN_FLIGHT_PER_NODE;
        this.#popLimit = options.popLimit ?? SCHEDULE_POP_LIMIT;
        this.#tickMs = options.tickMs ?? SCHEDULE_TICK_MS;
    }

    get inFlight(): number {
        return this.#running.size;
    }

    start(): void {
        if (!this.#stopped) return;
        this.#stopped = false;
        this.#arm();
    }

    stop(): void {
        this.#stopped = true;
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
        if (this.#kick) clearTimeout(this.#kick);
        this.#kick = null;
    }

    /** Wait for every attempt already started. */
    async drain(): Promise<void> {
        if (this.#ticking) await this.#ticking;
        while (this.#running.size > 0) await Promise.all([...this.#running]);
    }

    #arm(): void {
        if (this.#stopped) return;
        const jitter = 1 + (Math.random() * 2 - 1) * TICK_JITTER;
        this.#timer = setTimeout(() => {
            void (async () => {
                await this.tick();
                this.#arm();
            })();
        }, this.#tickMs * jitter);
        this.#timer.unref?.();
    }

    /**
     * Visit every partition once, from a random one, popping what is due while
     * this node has room for it. Attempts run on after it returns.
     */
    async tick(): Promise<void> {
        if (this.#ticking) return this.#ticking;
        const ticking = this.#visit();
        this.#ticking = ticking;
        try {
            await ticking;
        } finally {
            if (this.#ticking === ticking) this.#ticking = null;
        }
    }

    async #visit(): Promise<void> {
        this.#backlogged = false;
        const start = Math.floor(Math.random() * SCHEDULE_PARTITIONS);
        for (let i = 0; i < SCHEDULE_PARTITIONS; i++) {
            const room = this.#cap - this.#running.size;
            if (room <= 0) {
                this.#backlogged = true;
                return;
            }
            const partition = (start + i) % SCHEDULE_PARTITIONS;
            const limit = Math.min(this.#popLimit, room);
            let popped;
            try {
                popped = await this.#host.index.pop(
                    partition,
                    limit,
                    SCHEDULE_LEASE_MS,
                );
            } catch (err) {
                console.warn('[events] schedule pop failed', err);
                continue;
            }
            if (popped.items.length >= limit) this.#backlogged = true;
            for (const item of popped.items) this.#launch(item, popped.nowMs);
        }
    }

    /**
     * Visit again as soon as a run frees room, while the last visit left due
     * members behind. Without it a node would refill only once per tick, and
     * its throughput would be its cap per tick rather than per handler run.
     */
    #refill(): void {
        if (this.#stopped || !this.#backlogged || this.#kick) return;
        this.#kick = setTimeout(() => {
            this.#kick = null;
            void this.tick();
        }, REFILL_DELAY_MS);
        this.#kick.unref?.();
    }

    #launch(item: PoppedSchedule, nowMs: number): void {
        const run = (async () => {
            try {
                await this.#fire(item, nowMs);
            } catch (err) {
                // The lease lapses and the next pop retries this slot.
                scheduleFire.add(1, { result: 'error' });
                console.warn('[events] schedule run failed', item.id, err);
            }
        })();
        // Tracked as the promise that settles after it leaves the set.
        const tracked: Promise<void> = run.finally(() => {
            this.#running.delete(tracked);
            this.#refill();
        });
        this.#running.add(tracked);
    }

    #recordLag(item: PoppedSchedule, nowMs: number): void {
        const lag = Math.max(0, nowMs - item.score);
        scheduleLag.record(lag);
        if (this.#lag.record(lag, nowMs))
            this.#host.alarm(
                'events_schedule_lag',
                'Schedules have been running more than a minute late for five minutes',
                { p95OverMs: LAG_ALARM_MS, minutes: LAG_ALARM_MINUTES },
            );
    }

    // -- Fire path ----------------------------------------------------

    async #fire(item: PoppedSchedule, nowMs: number): Promise<void> {
        const { id, token, prevRun } = item;
        const def = item.def.def!;
        const index = this.#host.index;
        this.#recordLag(item, nowMs);

        if (prevRun.phase === 'finalizing') {
            scheduleFire.add(1, { result: 'finalizing' });
            if (!(await this.#finish(item)))
                await index.defer(id, token, SCHEDULE_FINALIZE_RETRY_MS);
            return;
        }

        const slotDef = slotDefOf(def);
        if (def.cron !== null) rememberCron(def.cron, def.tz);
        const owed =
            prevRun.owed ??
            recoverOwed(slotDef, def.createdAt, nowMs, def.offsetMs);
        if (owed === null) {
            await this.#finish(item);
            return;
        }

        // Which slot this attempt fires. A pinned slot, or the owed one of an
        // attempt that crashed, is fired again so `event.id` holds.
        let slot: number;
        let missed = 0;
        let missedCapped = false;
        let pin = false;
        if (prevRun.pinned !== null) {
            slot = prevRun.pinned;
            missed = prevRun.missed;
            missedCapped = prevRun.missedCapped;
        } else if (prevRun.token !== '') {
            slot = owed;
        } else {
            const latest = latestSlotAtOrBefore(slotDef, nowMs - def.offsetMs);
            if (latest === null || latest < owed) {
                // Popped before its slot: a repair or resume re-dued it early.
                scheduleFire.add(1, { result: 'early' });
                await index.defer(id, token, owed + def.offsetMs - nowMs);
                return;
            }
            slot = latest;
            if (latest > owed) {
                const skipped = countSlots(
                    slotDef,
                    owed,
                    latest,
                    EVENTS_SCHEDULE_MISSED_CAP,
                );
                missed = skipped.count;
                missedCapped = skipped.capped;
                pin = true;
            }
        }

        if (def.kind === 'deferred') {
            await this.#runAction(item, slot);
            return;
        }

        const actor = await this.#host.events.resolveScheduleActor(
            def.holderUserId,
            def.appUid,
        );
        if (!actor) {
            await this.#orphaned(item);
            return;
        }
        if (actor.user?.suspended) {
            scheduleFire.add(1, { result: 'holder-suspended' });
            await index.defer(
                id,
                token,
                EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
            );
            return;
        }

        const wait = await index.spendBudget(
            def.holderUserId,
            def.appUid,
            EVENTS_SCHEDULE_INVOCATION_LIMIT.limit,
            EVENTS_SCHEDULE_INVOCATION_LIMIT.windowMs,
        );
        if (wait > 0) {
            scheduleFire.add(1, { result: 'over-budget' });
            await index.defer(id, token, wait);
            return;
        }

        if (
            !(await this.#host.events.chargeableForSchedule(
                def.holderUserId,
                def.appUid,
                def.subId ?? '',
            ))
        ) {
            // Parked by the suspension, which clears this lease; the defer
            // only paces a suspension that didn't land.
            scheduleFire.add(1, { result: 'no-credit' });
            await index.defer(id, token, NO_CREDIT_DEFER_MS);
            return;
        }

        if (
            pin &&
            !(await index.start(id, token, slot, missed, missedCapped))
        ) {
            scheduleFire.add(1, { result: 'lost' });
            return;
        }

        const event: ScheduleEvent = {
            subject: scheduleToken(id),
            op: 'tick',
            id: `${id}:${slot}`,
            scheduleId: id,
            scheduledFor: slot,
            missed,
            ...(missedCapped ? { missedCapped: true as const } : {}),
            attempt: prevRun.attempts + 1,
        };
        const lease = this.#holdLease(id, token);
        let result: ScheduleInvokeResult;
        try {
            result = await this.#host.events.invokeForSchedule(
                {
                    subId: def.subId ?? '',
                    holderUserId: def.holderUserId,
                    appUid: def.appUid,
                    handlerName: def.handlerName,
                    event,
                    context: def.context,
                    handlerDepth: def.handlerDepth,
                    actor,
                },
                {
                    stampEvent: (sent) => ({
                        ...(sent as ScheduleEvent),
                        firedAt: Date.now(),
                    }),
                },
            );
        } finally {
            lease.stop();
        }
        if (lease.lost) {
            scheduleFire.add(1, { result: 'lost' });
            return;
        }
        await this.#settle(item, slot, missed, missedCapped, result);
    }

    async #settle(
        item: PoppedSchedule,
        slot: number,
        missed: number,
        missedCapped: boolean,
        result: ScheduleInvokeResult,
    ): Promise<void> {
        const { id, token, prevRun } = item;
        const def = item.def.def!;
        const index = this.#host.index;
        scheduleFire.add(1, { result: result.outcome });

        switch (result.outcome) {
            case 'settled':
                await this.#advance(item, slot, 0, true);
                return;
            case 'terminal': {
                // The handler refused this slot: it is dropped, billed, and
                // counted against the handler.
                const fails = prevRun.fails + 1;
                const advanced = await this.#advance(item, slot, fails, true);
                if (advanced === 'settled')
                    await this.#maybeSuspend(def, fails);
                return;
            }
            case 'retriable':
            case 'unavailable':
            case 'deferred':
            case 'mint-failed': {
                const attempts = prevRun.attempts + 1;
                // Only the handler's own failures count toward suspension.
                const fails =
                    result.outcome === 'retriable'
                        ? prevRun.fails + 1
                        : prevRun.fails;
                const retryAfterMs =
                    'retryAfterMs' in result ? (result.retryAfterMs ?? 0) : 0;
                const delayMs = Math.max(
                    deliveryBackoffMs(attempts),
                    Math.min(retryAfterMs, EVENTS_RETRY_MAX_MS),
                );
                if (
                    (await index.retry(
                        id,
                        token,
                        delayMs,
                        slot,
                        missed,
                        missedCapped,
                        attempts,
                        fails,
                    )) &&
                    result.outcome === 'retriable'
                )
                    await this.#maybeSuspend(def, fails);
                return;
            }
            case 'no-consent':
                // The consent settle was started by the mint; it ends the
                // schedule if the withdrawal stands.
                await index.defer(id, token, NO_CONSENT_DEFER_MS);
                return;
            case 'no-identity':
                await this.#orphaned(item);
                return;
            case 'too-deep':
                // Never runnable at this depth: dropped, not billed, not a failure.
                await this.#advance(item, slot, prevRun.fails, false);
                return;
            case 'deploy-busy':
                await index.defer(id, token, DEPLOY_BUSY_DEFER_MS);
                return;
        }
    }

    /**
     * Move past `slot`: to the next one, or, after the last, into the finish.
     * Bills once, and only when the index accepted the settle.
     */
    async #advance(
        item: PoppedSchedule,
        slot: number,
        fails: number,
        bill: boolean,
    ): Promise<'settled' | 'finalized' | 'refused'> {
        const { id, token } = item;
        const def = item.def.def!;
        const index = this.#host.index;
        const next = nextSlotAfter(slotDefOf(def), slot);
        if (next === null) {
            const finalized = await index.finalize(
                id,
                token,
                slot,
                SCHEDULE_FINALIZE_RETRY_MS,
                fails,
            );
            if (finalized !== 1) return 'refused';
            if (bill)
                await this.#host.events.meterScheduleRun(
                    def.holderUserId,
                    def.appUid,
                );
            await this.#finish(item);
            return 'finalized';
        }
        const settled = await index.settle(
            id,
            token,
            slot,
            next + def.offsetMs,
            next,
            fails,
        );
        if (settled !== 1) return 'refused';
        if (bill)
            await this.#host.events.meterScheduleRun(
                def.holderUserId,
                def.appUid,
            );
        return 'settled';
    }

    async #maybeSuspend(def: ScheduleIndexDef, fails: number): Promise<void> {
        if (fails < EVENTS_CONSECUTIVE_FAILURES || !def.subId) return;
        await this.#host.events.suspendForFailures(def.subId);
    }

    /**
     * End a schedule after its last slot: SQL first, then the index. On a
     * failed write the member stays finalizing and comes back for another try,
     * never invoking again.
     */
    async #finish(item: PoppedSchedule): Promise<boolean> {
        let version: number;
        try {
            version = await this.#host.finishRun(
                item.id,
                item.def.version,
                item.def.def!,
            );
        } catch (err) {
            console.warn('[events] could not finish a schedule', item.id, err);
            return false;
        }
        await this.#host.index.apply([endedChange(item.id, version)]);
        return true;
    }

    /**
     * The holder or the app looked gone: end the schedule, once. When that
     * can't be established, or turns out wrong, the run waits instead.
     */
    async #orphaned(item: PoppedSchedule): Promise<void> {
        let version: number | null;
        try {
            version = await this.#host.endOrphan(
                item.id,
                item.def.version,
                item.def.def!,
            );
        } catch (err) {
            console.warn('[events] could not check a schedule`s holder', err);
            version = null;
        }
        if (version === null) {
            scheduleFire.add(1, { result: 'identity-unsure' });
            await this.#host.index.defer(
                item.id,
                item.token,
                NO_IDENTITY_DEFER_MS,
            );
            return;
        }
        scheduleFire.add(1, { result: 'orphaned' });
        await this.#host.index.apply([endedChange(item.id, version)]);
    }

    /** A delayed send: its action owns the row, the runner the index. */
    async #runAction(item: PoppedSchedule, slot: number): Promise<void> {
        const { id, token, prevRun } = item;
        const def = item.def.def!;
        const index = this.#host.index;
        const action = this.#host.actions.get(def.action);
        if (!action) {
            scheduleFire.add(1, { result: 'no-action' });
            await index.defer(id, token, NO_ACTION_DEFER_MS);
            return;
        }
        const lease = this.#holdLease(id, token);
        let outcome;
        try {
            outcome = await action({
                scheduleId: id,
                rowId: def.rowId,
                holderUserId: def.holderUserId,
                appUid: def.appUid,
                scheduledFor: slot,
                attempts: prevRun.attempts,
                signal: lease.signal,
            });
        } finally {
            lease.stop();
        }
        if (lease.lost) return;
        scheduleFire.add(1, { result: `action-${outcome.type}` });
        const change: ScheduleIndexChange[] = [];
        switch (outcome.type) {
            case 'finished':
                change.push(endedChange(id, outcome.version));
                await index.apply(change);
                return;
            case 'retry': {
                const attempts = prevRun.attempts + 1;
                await index.retry(
                    id,
                    token,
                    outcome.delayMs ?? deliveryBackoffMs(attempts),
                    slot,
                    0,
                    false,
                    attempts,
                    prevRun.fails,
                );
                return;
            }
            case 'defer':
                await index.defer(id, token, outcome.delayMs);
                return;
        }
    }

    #holdLease(id: string, token: string): HeldLease {
        const controller = new AbortController();
        let lost = false;
        const timer = setInterval(() => {
            void (async () => {
                try {
                    if (
                        !lost &&
                        !(await this.#host.index.renew(
                            id,
                            token,
                            SCHEDULE_LEASE_MS,
                        ))
                    ) {
                        lost = true;
                        controller.abort();
                    }
                } catch {
                    // A missed renewal is retried on the next interval; the
                    // lease outlasts two of them.
                }
            })();
        }, SCHEDULE_RENEW_MS);
        timer.unref?.();
        return {
            get lost() {
                return lost;
            },
            signal: controller.signal,
            stop: () => clearInterval(timer),
        };
    }
}
