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

import {
    EVENTS_SUBSCRIBE_LIMIT,
    EVENTS_UNSUBSCRIBE_LIMIT,
    EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP,
    EVENTS_SCHEDULE_FIRE_BUDGET_PER_USER,
    EVENTS_SCHEDULE_MIN_INTERVAL_MS,
    EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP,
    EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_USER,
    EVENTS_SCHEDULES_PER_APP,
    EVENTS_SCHEDULES_PER_USER,
    limitFor,
} from '../../controllers/events/limits.js';
import {
    assertResolvedActor,
    handlerDepthOf,
    isAccessTokenActor,
    isAccountContext,
    type Actor,
} from '../../core/actor.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import {
    TERMINAL_SUSPENDED_REASONS,
    type SuspendedReason,
} from '../../stores/events/DurableSubscriptionStore.js';
import {
    scheduleNamespace,
    type ScheduleEndReason,
    type ScheduleListOptions,
    type ScheduleQuota,
    type ScheduleRow,
    type ScheduleSyncRow,
} from '../../stores/events/ScheduleStore.js';
import type { ScheduleIndexChange } from '../../stores/events/ScheduleIndexStore.js';
import {
    isScheduleRow,
    SCHEDULE_TOKEN_PREFIX,
    type DurableSubscription,
    type ScheduleKind,
} from '../../stores/events/types.js';
import type { PageResult } from '../../util/pagination.js';
import { actorPlanId } from '../metering/enforcement.js';
import { PuterService } from '../types.js';
import {
    backgroundConsentRequired,
    EVENTS_BACKGROUND_PERMISSION,
    rowInActorScope,
} from './authorization.js';
import { projectContext, spendUserWindow } from './requestParsing.js';
import { ScheduleActionRegistry } from './scheduleActions.js';
import { rememberCron } from './scheduleCron.js';
import {
    endedChange,
    indexDefFor,
    liveChange,
    recoveredOwed,
    resumedChange,
    rowStateOf,
    slotDefOf,
} from './scheduleIndex.js';
import {
    parseSendAt,
    validateScheduleRequest,
    type ScheduleRequest,
    type ScheduleSpec,
} from './scheduleOptions.js';
import {
    RECONCILE_INTERVAL_MS,
    ScheduleReconciler,
    type ScheduleReconcileReport,
} from './scheduleReconcile.js';
import { ScheduleRunner, type ScheduleRunnerHost } from './ScheduleRunner.js';
import {
    firstSlotAtOrAfter,
    latestSlotAtOrBefore,
    spreadOffsetMs,
} from './scheduleSlots.js';

/**
 * Scheduled handlers: validating a create, and keeping schedule rows in step
 * with the subscription rows they own as those are suspended, resumed and
 * reaped.
 */

/** The signed peer route a region's schedule changes are sent to. */
export const SCHEDULE_PEER_PATH = '/broadcast/events/schedules';

/** Delayed sends one cancel pass ends at a time. */
const DEFERRED_PAGE = 500;

/** Gap between passes while the index is being rebuilt. */
const REBUILD_PASS_GAP_MS = 1_000;

/** What happened to a set of subscription rows. */
export type ScheduleSubscriptionChange =
    | {
          type: 'suspended';
          reason: SuspendedReason;
          /** For a reason that never lifts; defaults to that reason. */
          endReason?: ScheduleEndReason;
      }
    | { type: 'resumed' }
    | { type: 'ended'; endReason: ScheduleEndReason };

/** What a delayed send runs: its action, and the payload it reads back. */
export interface DeferredSendRequest {
    action: string;
    /** JSON text the action reads back when it runs. */
    payload: string;
}

/** A caller cleared to supply `sendAt`, and when it asked for. */
export interface DeferredSendPlan {
    sendAt: number;
    /** Due within 5 seconds, or past: sent now rather than stored. */
    immediate: boolean;
    holderUserId: number;
    appUid: string;
    handlerDepth: number;
    quota: ScheduleQuota;
}

/** A validated create, with who it is for and the caps it is held to. */
export interface SchedulePlan extends ScheduleSpec {
    namespace: string;
    holderUserId: number;
    appUid: string;
    handlerDepth: number;
    quota: ScheduleQuota;
}

const disabled = (): HttpError =>
    new HttpError(503, 'Schedules are not enabled on this server', {
        legacyCode: 'events_disabled',
    });

const appRequired = (): HttpError =>
    new HttpError(403, 'A schedule must be created by an app', {
        legacyCode: 'events_schedule_app_required',
    });

/** As for persistent subscriptions: a scoped token is not the app. */
const scopedToken = (): HttpError =>
    new HttpError(403, 'A scoped access token may not hold schedules', {
        legacyCode: 'events_durable_requires_account',
    });

const temporaryAccount = (): HttpError =>
    new HttpError(403, 'A temporary account may not hold schedules', {
        legacyCode: 'events_durable_requires_account',
    });

const notFound = (): HttpError =>
    new HttpError(404, 'No such schedule', {
        legacyCode: 'events_schedule_not_found',
    });

const sending = (): HttpError =>
    new HttpError(409, 'This delayed send has already started', {
        legacyCode: 'events_schedule_sending',
    });

/** Public schedule ids are v4 uuids; anything else is answered as absent. */
const SCHEDULE_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A schedule as its holder sees it. Times are epoch ms. `context` values are
 * never returned, as for a persistent subscription: only its keys and a hash.
 */
export interface ScheduleView {
    scheduleId: string;
    kind: ScheduleKind;
    appUid: string;
    /** `null` once ended: the handler binding goes with the schedule. */
    handlerName: string | null;
    contextKeys: string[] | null;
    contextHash: string | null;
    /** Interval of an `every` schedule. */
    every: number | null;
    cron: string | null;
    tz: string;
    /** First allowed run; a one-shot's only run. */
    startAt: number;
    /** Last allowed run, inclusive. */
    endsAt: number | null;
    /** `sending` once a delayed send has started; it can't be cancelled then. */
    state: 'active' | 'suspended' | 'sending' | 'ended';
    suspendedReason: string | null;
    endReason: string | null;
    endedAt: number | null;
    /**
     * The slot it runs for next; `null` while suspended or sending, and once
     * ended.
     */
    nextRunAt: number | null;
    createdAt: number;
}

export interface ScheduleListRequest {
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}

/**
 * The next nominal slot of a live schedule's definition, from the clock alone:
 * the first whose spread hasn't passed, never one before create. Past the end,
 * the last slot, which is still owed until the run that finishes it. A late,
 * backlogged or retrying run for an earlier slot may still fire first. A
 * one-shot's only slot until it has run.
 */
const nextRunOf = (row: ScheduleRow, now: number): number | null => {
    if (row.kind !== 'recurring') return row.startAt;
    const offsetMs = spreadOffsetMs(row.uid, row.kind, row.minGapMs);
    return (
        firstSlotAtOrAfter(row, Math.max(row.createdAt, now - offsetMs)) ??
        latestSlotAtOrBefore(row, now) ??
        firstSlotAtOrAfter(row, row.createdAt)
    );
};

const toScheduleView = (row: ScheduleSyncRow, now: number): ScheduleView => {
    const rowState = rowStateOf(row);
    const ended = rowState.kind === 'ended' || rowState.kind === 'revoked';
    const suspended = rowState.kind === 'live' && rowState.state !== 'active';
    // A delayed send stays live while it sends, and once its mailbox row is
    // written until its finish lands.
    const sending =
        !ended && (row.state === 'sending' || row.state === 'delivered');
    return {
        scheduleId: row.uid,
        kind: row.kind,
        appUid: row.appUid,
        handlerName: row.sub?.handlerName ?? null,
        ...projectContext(row.sub?.context ?? null),
        every: row.everyMs,
        cron: row.cron,
        tz: row.tz,
        startAt: row.startAt,
        endsAt: row.endsAt,
        state: ended
            ? 'ended'
            : suspended
              ? 'suspended'
              : sending
                ? 'sending'
                : 'active',
        suspendedReason: suspended ? (row.sub?.suspendedReason ?? null) : null,
        endReason: ended
            ? (row.endReason ?? row.sub?.suspendedReason ?? null)
            : null,
        endedAt: row.deletedAt,
        nextRunAt: ended || suspended || sending ? null : nextRunOf(row, now),
        createdAt: row.createdAt,
    };
};

const quotaFor = (plan: string | null): ScheduleQuota => ({
    recurringPerUser: limitFor(EVENTS_SCHEDULES_PER_USER, plan),
    recurringPerApp: limitFor(EVENTS_SCHEDULES_PER_APP, plan),
    oneShotsPerUser: limitFor(EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_USER, plan),
    oneShotsPerApp: limitFor(EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP, plan),
    budgetPerUser: limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_USER, plan),
    budgetPerApp: limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP, plan),
});

const endFor = (
    change: ScheduleSubscriptionChange,
): { reason: ScheduleEndReason } | null => {
    if (change.type === 'ended') return { reason: change.endReason };
    if (
        change.type === 'suspended' &&
        TERMINAL_SUSPENDED_REASONS.includes(change.reason)
    )
        return { reason: change.endReason ?? 'permission_revoked' };
    return null;
};

export class ScheduleService extends PuterService {
    get enabled(): boolean {
        return (
            this.config.events?.enabled === true &&
            this.config.events?.schedules?.enabled === true
        );
    }

    get namespace(): string {
        return scheduleNamespace(this.config);
    }

    /**
     * Check a create against the caller and their plan, and compute what is
     * stored. A schedule belongs to an app and runs its published handler with
     * nobody present, so an account-context caller or a scoped token is
     * refused, and the app needs the holder's background consent.
     */
    async prepareCreate(
        actor: Actor,
        request: ScheduleRequest,
        now: number = Date.now(),
    ): Promise<SchedulePlan> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();
        assertResolvedActor(actor);
        // A scoped token first, whoever issued it: an account-issued one has
        // no app either, and must not read as the account.
        if (isAccessTokenActor(actor) && !isAccountContext(actor))
            throw scopedToken();
        const appUid = actor.effectiveApp?.uid;
        if (!appUid) throw appRequired();
        // Before validation: a cron create can cost a scan.
        await spendUserWindow(EVENTS_SUBSCRIBE_LIMIT, holderUserId);
        if ((await this.services.events.hasBackgroundConsent(actor)) !== true)
            throw backgroundConsentRequired();

        const plan = await actorPlanId(this.services.metering, actor);
        const quota = quotaFor(plan);
        if (quota.recurringPerUser === 0 && quota.oneShotsPerUser === 0)
            throw temporaryAccount();

        const spec = await validateScheduleRequest(request, {
            now,
            minIntervalMs: limitFor(EVENTS_SCHEDULE_MIN_INTERVAL_MS, plan),
        });
        await this.services.events.assertHandlerBinding(
            appUid,
            spec.handlerName,
            spec.handlerHash,
        );

        return {
            ...spec,
            namespace: this.namespace,
            holderUserId,
            appUid,
            handlerDepth: handlerDepthOf(actor),
            quota,
        };
    }

    /**
     * Store a validated schedule and put it in the region's due index. It fires
     * in this region. An index write that fails is left to the reconcile, which
     * adds the row from the table.
     */
    async create(plan: SchedulePlan): Promise<ScheduleRow> {
        const row = await this.stores.schedule.create({
            namespace: plan.namespace,
            region: this.region,
            kind: plan.kind,
            holderUserId: plan.holderUserId,
            appUid: plan.appUid,
            startAt: plan.startAt,
            everyMs: plan.everyMs,
            cron: plan.cron,
            tz: plan.tz,
            endsAt: plan.endsAt,
            ratePerHour: plan.ratePerHour,
            minGapMs: plan.minGapMs,
            handlerDepth: plan.handlerDepth,
            subscription: {
                handlerName: plan.handlerName,
                context: plan.context,
                permission: EVENTS_BACKGROUND_PERMISSION,
            },
            quota: plan.quota,
        });
        if (row.cron !== null) rememberCron(row.cron, row.tz);
        const def = indexDefFor(row, {
            handlerName: plan.handlerName,
            context: plan.context,
        });
        // Never a back-fill: the first slot at or after create.
        const owed = firstSlotAtOrAfter(slotDefOf(def), row.createdAt);
        if (owed !== null)
            await this.#distribute([
                {
                    region: row.region,
                    change: {
                        id: row.uid,
                        version: row.version,
                        state: 'active',
                        def,
                        score: owed + def.offsetMs,
                        owed,
                    },
                },
            ]);
        return row;
    }

    /**
     * Check a caller supplying `sendAt` and read it. The gates hold whether it
     * goes now or later: an app context, no scoped token or temporary account
     * (neither could list or cancel a stored send), and schedules switched on.
     */
    async prepareSendAt(
        actor: Actor,
        value: unknown,
        now: number = Date.now(),
    ): Promise<DeferredSendPlan> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();
        assertResolvedActor(actor);
        if (isAccessTokenActor(actor) && !isAccountContext(actor))
            throw scopedToken();
        const appUid = actor.effectiveApp?.uid;
        if (!appUid) throw appRequired();
        const quota = quotaFor(
            await actorPlanId(this.services.metering, actor),
        );
        if (quota.oneShotsPerUser === 0) throw temporaryAccount();
        return {
            ...parseSendAt(value, now),
            holderUserId,
            appUid,
            handlerDepth: handlerDepthOf(actor),
            quota,
        };
    }

    /**
     * Store a delayed send {@link prepareSendAt} passed, and index it. It counts
     * against the sender's pending one-shot caps and needs no consent or
     * handler.
     */
    async createDeferred(
        plan: DeferredSendPlan,
        send: DeferredSendRequest,
    ): Promise<ScheduleRow> {
        if (!this.enabled) throw disabled();
        const row = await this.stores.schedule.create({
            namespace: this.namespace,
            region: this.region,
            kind: 'deferred',
            holderUserId: plan.holderUserId,
            appUid: plan.appUid,
            startAt: plan.sendAt,
            everyMs: null,
            cron: null,
            tz: 'UTC',
            endsAt: plan.sendAt,
            ratePerHour: 0,
            minGapMs: null,
            handlerDepth: plan.handlerDepth,
            action: send.action,
            payload: send.payload,
            quota: plan.quota,
        });
        const def = indexDefFor(row, null);
        await this.#distribute([
            {
                region: row.region,
                change: {
                    id: row.uid,
                    version: row.version,
                    state: 'active',
                    def,
                    score: row.startAt + def.offsetMs,
                    owed: row.startAt,
                },
            },
        ]);
        return row;
    }

    /** Validate, store and index one create, answered as its holder sees it. */
    async createFor(
        actor: Actor,
        request: ScheduleRequest,
    ): Promise<ScheduleView> {
        const plan = await this.prepareCreate(actor, request);
        const row = await this.create(plan);
        return toScheduleView(
            {
                ...row,
                sub: {
                    suspendedAt: null,
                    suspendedReason: null,
                    handlerName: plan.handlerName,
                    context: plan.context,
                },
            },
            Date.now(),
        );
    }

    /**
     * The caller's schedules, ended ones within their retention included. An
     * app sees its own; a session acting for the account sees every app's, so
     * it can remove what an app left behind. A scoped token holds none.
     */
    async list(
        actor: Actor,
        request: ScheduleListRequest = {},
    ): Promise<PageResult<ScheduleView>> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();
        const app = actor.effectiveApp;
        const none: PageResult<ScheduleView> = request.includeTotal
            ? { items: [], total: 0 }
            : { items: [] };
        // Unresolved is not "no app": that reading would hand an app the
        // account-wide view.
        if (app === undefined) return none;
        if (isAccessTokenActor(actor) && !isAccountContext(actor)) return none;

        const options: ScheduleListOptions = {
            appUid: app?.uid ?? null,
            limit: request.limit,
            cursor: request.cursor,
            includeTotal: request.includeTotal,
        };
        const page = await this.stores.schedule.listForHolder(
            this.namespace,
            holderUserId,
            options,
        );
        const now = Date.now();
        return {
            items: page.items.map((row) => toScheduleView(row, now)),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        };
    }

    /**
     * One of the caller's schedules, ended or not; anyone else's reads as
     * absent.
     */
    async get(actor: Actor, scheduleId: unknown): Promise<ScheduleView> {
        if (!this.enabled) throw disabled();
        return toScheduleView(
            await this.#ownRow(actor, scheduleId),
            Date.now(),
        );
    }

    /**
     * End one of the caller's schedules. Anyone else's, or one already ended,
     * reads as absent. A delayed send that has started can't be cancelled.
     */
    async remove(actor: Actor, scheduleId: unknown): Promise<void> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();
        await spendUserWindow(EVENTS_UNSUBSCRIBE_LIMIT, holderUserId);
        const row = await this.#ownRow(actor, scheduleId);
        if (row.deletedAt !== null) throw notFound();

        // What the index holds before the change, so a fallback can't land
        // on a newer one.
        const observed = (
            await this.stores.scheduleIndex.versionsOf([row.uid])
        ).get(row.uid);
        let ended: ScheduleRow | undefined;
        try {
            if (row.kind === 'deferred') {
                [ended] = await this.stores.schedule.cancelDeferred(
                    [row.id],
                    'removed',
                );
                if (!ended) throw sending();
            } else [ended] = await this.#endRows([row], 'removed');
        } catch (err) {
            // Stop it firing anyway, at the version the index held. The
            // reconcile finds the live row under the tombstone and finishes
            // the soft delete. Best effort: only this region's index is
            // reached, and only one that held the schedule.
            if (!isHttpError(err) && observed !== undefined)
                await this.#distribute([
                    {
                        region: this.region,
                        change: {
                            ...endedChange(row.uid, observed),
                            exact: true,
                        },
                    },
                ]);
            throw err;
        }
        if (ended)
            await this.#distribute([
                {
                    region: ended.region,
                    change: endedChange(ended.uid, ended.version),
                },
            ]);
    }

    /**
     * Keep schedule rows, and the due index, in step with a change to the
     * subscription rows they own. Called after the subscription change, from
     * every path that makes one; rows that aren't a schedule's are ignored.
     * Never throws: the subscription change has already happened. A failed SQL
     * step is retried once; after that the index is changed at the version it
     * already holds, and the reconcile brings the table in line.
     */
    async onSubscriptionsChanged(
        rows: readonly DurableSubscription[],
        change: ScheduleSubscriptionChange,
    ): Promise<ScheduleRow[]> {
        const owned = rows.filter(isScheduleRow);
        if (owned.length === 0) return [];
        const end = endFor(change);
        let observed = new Map<string, number>();
        if (this.enabled) {
            try {
                observed = await this.stores.scheduleIndex.versionsOf(
                    owned.map(scheduleUidOf),
                );
            } catch {
                // Then there is no fallback to fence.
            }
        }
        let updated: ScheduleSyncRow[] | null = null;
        for (let attempt = 1; attempt <= 2 && updated === null; attempt++) {
            try {
                updated = await this.stores.schedule.applySubscriptionChange(
                    this.namespace,
                    owned.map((row) => row.subId),
                    end,
                    { resumed: change.type === 'resumed' },
                );
            } catch (err) {
                if (attempt === 2)
                    console.warn(
                        '[events] could not record a schedule lifecycle change',
                        change.type,
                        err,
                    );
            }
        }
        if (!this.enabled) return updated ?? [];
        try {
            if (updated) await this.#indexChanged(updated, change);
            else
                await this.#indexAtObservedVersion(
                    owned,
                    change,
                    end !== null,
                    observed,
                );
        } catch (err) {
            console.warn('[events] could not update the schedule index', err);
        }
        return updated ?? [];
    }

    /**
     * Apply changes another region sent for schedules this region owns. One
     * from a deployment with another namespace is dropped.
     */
    async receivePeerChanges(body: unknown): Promise<{ applied: number }> {
        const { namespace, changes } = (body ?? {}) as {
            namespace?: unknown;
            changes?: unknown;
        };
        if (!this.enabled || namespace !== this.namespace)
            return { applied: 0 };
        if (!Array.isArray(changes)) return { applied: 0 };
        const valid = changes.filter(isIndexChange);
        if (valid.length > 0) await this.stores.scheduleIndex.apply(valid);
        return { applied: valid.length };
    }

    /** One reconcile pass over this region's schedules. */
    reconcile(): Promise<ScheduleReconcileReport> {
        return this.#reconcilerFor().pass();
    }

    /** The runner this node fires schedules with. */
    get runner(): ScheduleRunner {
        this.#runner ??= new ScheduleRunner(this.#runnerHost());
        return this.#runner;
    }

    /** Where this node is, which is where the schedules it creates fire. */
    get region(): string {
        return this.services.broadcast.regionId;
    }

    override onServerStart(): void {
        // Rows are shared, so these end them even with schedules off here; a
        // region with them on would still send. The index side is gated.
        this.clients.event.on('app.uninstalled', async (_key, data) => {
            try {
                await this.#endDeferred(
                    (afterId) =>
                        this.stores.schedule.listDeferredForHolderApp(
                            data.userId,
                            data.appUid,
                            afterId,
                            DEFERRED_PAGE,
                        ),
                    'uninstalled',
                );
            } catch (err) {
                console.warn('[events] could not cancel delayed sends', err);
            }
        });
        this.clients.event.on('app.changed', async (_key, data) => {
            const { app_uid: appUid, action } = (data ?? {}) as {
                app_uid?: string;
                action?: string;
            };
            if (action !== 'deleted' || !appUid) return;
            await this.#endDeferredForApp(appUid);
        });
        this.clients.event.on('user.delete', async (_key, data) => {
            for (const appUid of new Set(data?.appUids ?? []))
                await this.#endDeferredForApp(appUid);
        });

        if (!this.enabled) return;
        try {
            scheduleNamespace(this.config);
        } catch (err) {
            console.error('[events] schedules are not running', err);
            return;
        }
        this.runner.start();
        this.#armReconcile(Math.random() * RECONCILE_INTERVAL_MS);
    }

    override onServerPrepareShutdown(): void {
        this.#runner?.stop();
        this.#stopped = true;
        if (this.#reconcileTimer) clearTimeout(this.#reconcileTimer);
        this.#reconcileTimer = null;
    }

    // -- Internals ---------------------------------------------------

    #runner: ScheduleRunner | null = null;
    #reconciler: ScheduleReconciler | null = null;
    #reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    #stopped = false;

    #armReconcile(delayMs: number): void {
        if (this.#stopped) return;
        this.#reconcileTimer = setTimeout(() => {
            void (async () => {
                let next = jittered(RECONCILE_INTERVAL_MS);
                try {
                    const report = await this.reconcile();
                    // A rebuild runs back-to-back until its first cycle is done.
                    if (report.rebuilding && !report.cycleCompleted)
                        next = REBUILD_PASS_GAP_MS;
                } catch (err) {
                    console.warn('[events] schedule reconcile failed', err);
                }
                this.#armReconcile(next);
            })();
        }, delayMs);
        this.#reconcileTimer.unref?.();
    }

    #reconcilerFor(): ScheduleReconciler {
        this.#reconciler ??= new ScheduleReconciler({
            index: this.stores.scheduleIndex,
            store: this.stores.schedule,
            namespace: this.namespace,
            region: this.region,
            endRows: (rows, reason, options) =>
                this.#endRows(rows, reason, { ...options, fenced: true }),
            alarm: (id, message, details) => this.#alarm(id, message, details),
        });
        return this.#reconciler;
    }

    /**
     * A schedule the caller holds and may see: an app its own, the account any
     * of its own. Everything else, including any id asked by a scoped token,
     * reads as absent, so the answer is no oracle for ids.
     */
    async #ownRow(actor: Actor, scheduleId: unknown): Promise<ScheduleSyncRow> {
        if (typeof scheduleId !== 'string' || !SCHEDULE_ID.test(scheduleId))
            throw notFound();
        const row = await this.stores.schedule.get(this.namespace, scheduleId);
        if (
            !row ||
            row.holderUserId !== actor.user?.id ||
            !rowInActorScope(actor, row)
        )
            throw notFound();
        return row;
    }

    #runnerHost(): ScheduleRunnerHost {
        return {
            index: this.stores.scheduleIndex,
            events: this.services.events,
            actions: this.actions,
            finishRun: async (id, entryVersion, def) => {
                const [row] = await this.stores.schedule.end(
                    [{ id: def.rowId, uid: id, kind: def.kind }],
                    'ended',
                );
                return row ? row.version : entryVersion + 1;
            },
            endOrphan: async (id, entryVersion, def) => {
                // The replica first; a miss is confirmed on the primary, so a
                // lagging replica never ends a schedule.
                const row =
                    (await this.stores.schedule.getReplica(
                        this.namespace,
                        id,
                    )) ?? (await this.stores.schedule.get(this.namespace, id));
                if (!row) return entryVersion + 1;
                if (row.deletedAt !== null)
                    return Math.max(row.version, entryVersion);
                const holder = await this.stores.user.getById(def.holderUserId);
                const app =
                    holder !== null &&
                    ((await this.stores.app.getByUid(def.appUid)) !== null ||
                        (await this.stores.app.uidExistsOnPrimary(def.appUid)));
                // Both are there after all: nothing to end.
                if (holder && app) return null;
                const [ended] = await this.#endRows(
                    [row],
                    holder ? 'app_gone' : 'holder_gone',
                );
                return ended ? ended.version : null;
            },
            alarm: (id, message, details) => this.#alarm(id, message, details),
        };
    }

    #alarm(
        id: string,
        message: string,
        details: Record<string, unknown>,
    ): void {
        this.clients.alarm.create(id, message, details, 'warning', {
            dedup: true,
        });
    }

    /**
     * End rows in SQL with the subscription rows they own, together. `fenced`
     * ends each only while it is at the version given with it.
     */
    #endRows(
        rows: readonly ScheduleRow[],
        reason: ScheduleEndReason,
        options: { fenced?: boolean; orphan?: boolean } = {},
    ): Promise<ScheduleRow[]> {
        return this.stores.schedule.end(
            rows.map((row) => ({
                id: row.id,
                uid: row.uid,
                kind: row.kind,
                ...(options.fenced ? { ifVersion: row.version } : {}),
            })),
            reason,
            { orphan: options.orphan },
        );
    }

    /**
     * Index the rows a lifecycle change left, as they now stand: each row's
     * state is read from its subscription row in the same statement as its
     * version, so a change that lost a race to a later one hands the index what
     * the later one did, never its own stale state at the newer version.
     */
    async #indexChanged(
        rows: readonly ScheduleSyncRow[],
        change: ScheduleSubscriptionChange,
    ): Promise<void> {
        const now = Date.now();
        const items: IndexItem[] = [];
        const finishing: ScheduleRow[] = [];
        for (const row of rows) {
            const state = rowStateOf(row);
            if (state.kind === 'ended') {
                items.push({
                    region: row.region,
                    change: endedChange(row.uid, row.version),
                });
                continue;
            }
            // Left to the reconcile.
            if (state.kind !== 'live') continue;
            if (state.state !== 'active') {
                const def = indexDefFor(row, row.sub);
                items.push({
                    region: row.region,
                    change: {
                        id: row.uid,
                        version: row.version,
                        state: state.state,
                        def,
                        score: 0,
                        owed: recoveredOwed(def, now),
                    },
                });
                continue;
            }
            const resumed =
                resumedChange(row, row.sub, now) ??
                (change.type === 'resumed'
                    ? null
                    : liveChange(row, row.sub, 'active', now));
            if (resumed) items.push({ region: row.region, change: resumed });
            // It ended while parked: nothing is left to fire.
            else finishing.push(row);
        }
        for (const ended of await this.#endRows(finishing, 'ended'))
            items.push({
                region: ended.region,
                change: endedChange(ended.uid, ended.version),
            });
        await this.#distribute(items);
    }

    /**
     * The hook's SQL step failed: change this region's index anyway, but only
     * where it still holds the version seen before the change, so a newer
     * change that did land is never overwritten. A resume with no slot left
     * ends the schedule rather than putting it back. The reconcile brings the
     * table in line later.
     */
    async #indexAtObservedVersion(
        subs: readonly DurableSubscription[],
        change: ScheduleSubscriptionChange,
        ends: boolean,
        observed: ReadonlyMap<string, number>,
    ): Promise<void> {
        let rows: ScheduleRow[] = [];
        try {
            rows = await this.stores.schedule.listBySubIdsReplica(
                this.namespace,
                subs.map((sub) => sub.subId),
            );
        } catch {
            // A resume then has nothing to compute its slot from.
        }
        const byUid = new Map(rows.map((row) => [row.uid, row]));
        const now = Date.now();
        const items: IndexItem[] = [];
        for (const sub of subs) {
            const uid = scheduleUidOf(sub);
            const version = observed.get(uid);
            if (version === undefined) continue;
            let state = ends
                ? 'ended'
                : change.type === 'suspended'
                  ? `suspended:${change.reason}`
                  : 'active';
            let score = 0;
            if (state === 'active') {
                const row = byUid.get(uid);
                if (!row) continue;
                const resumed = resumedChange(row, sub, now);
                if (resumed) score = resumed.score;
                else state = 'ended';
            }
            items.push({
                region: this.region,
                change: {
                    id: uid,
                    version,
                    exact: true,
                    state,
                    def: null,
                    score,
                    owed: null,
                },
            });
        }
        await this.#distribute(items);
    }

    /**
     * Apply index changes where each schedule lives: here, or in a message to
     * the region that owns it. Best effort; the reconcile repairs a loss.
     */
    async #distribute(items: readonly IndexItem[]): Promise<void> {
        if (!this.enabled || items.length === 0) return;
        const local: ScheduleIndexChange[] = [];
        const byPeer = new Map<string, ScheduleIndexChange[]>();
        for (const { region, change } of items) {
            if (region === this.region) local.push(change);
            else byPeer.set(region, [...(byPeer.get(region) ?? []), change]);
        }
        if (local.length > 0) {
            try {
                await this.stores.scheduleIndex.apply(local);
            } catch (err) {
                console.warn(
                    '[events] could not update the schedule index',
                    err,
                );
            }
        }
        for (const [peer, changes] of byPeer) {
            try {
                await this.services.broadcast.postToPeer(
                    peer,
                    SCHEDULE_PEER_PATH,
                    { namespace: this.namespace, changes },
                );
            } catch (err) {
                console.warn(
                    '[events] could not send schedule changes to their region',
                    peer,
                    err,
                );
            }
        }
    }

    /** End pending delayed sends page by page, then index the ends. */
    async #endDeferred(
        page: (afterId: number) => Promise<number[]>,
        reason: ScheduleEndReason,
    ): Promise<void> {
        let afterId = 0;
        for (;;) {
            const ids = await page(afterId);
            if (ids.length === 0) return;
            const ended = await this.stores.schedule.cancelDeferred(
                ids,
                reason,
            );
            await this.#distribute(
                ended
                    .filter((row) => row.namespace === this.namespace)
                    .map((row) => ({
                        region: row.region,
                        change: endedChange(row.uid, row.version),
                    })),
            );
            if (ids.length < DEFERRED_PAGE) return;
            afterId = ids[ids.length - 1];
        }
    }

    async #endDeferredForApp(appUid: string): Promise<void> {
        try {
            await this.#endDeferred(
                (afterId) =>
                    this.stores.schedule.listDeferredForApp(
                        appUid,
                        afterId,
                        DEFERRED_PAGE,
                    ),
                'app_deleted',
            );
        } catch (err) {
            console.warn('[events] could not cancel delayed sends', err);
        }
    }

    readonly actions = new ScheduleActionRegistry();
}

interface IndexItem {
    region: string;
    change: ScheduleIndexChange;
}

const scheduleUidOf = (sub: { token: string }): string =>
    sub.token.slice(SCHEDULE_TOKEN_PREFIX.length);

const jittered = (ms: number): number => ms * (0.8 + Math.random() * 0.4);

const isIndexChange = (value: unknown): value is ScheduleIndexChange => {
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    return (
        typeof c.id === 'string' &&
        Number.isSafeInteger(c.version) &&
        (c.exact === undefined || typeof c.exact === 'boolean') &&
        typeof c.state === 'string' &&
        /^(active|ended|suspended:[a-z_]+)$/.test(c.state) &&
        (c.def === null || typeof c.def === 'object') &&
        Number.isFinite(c.score) &&
        (c.owed === null || Number.isFinite(c.owed))
    );
};
