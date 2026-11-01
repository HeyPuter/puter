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
    type ScheduleQuota,
    type ScheduleRow,
} from '../../stores/events/ScheduleStore.js';
import type { ScheduleIndexChange } from '../../stores/events/ScheduleIndexStore.js';
import {
    isScheduleRow,
    SCHEDULE_TOKEN_PREFIX,
    type DurableSubscription,
} from '../../stores/events/types.js';
import { actorPlanId } from '../metering/enforcement.js';
import { PuterService } from '../types.js';
import {
    backgroundConsentRequired,
    EVENTS_BACKGROUND_PERMISSION,
} from './authorization.js';
import { ScheduleActionRegistry } from './scheduleActions.js';
import { rememberCron } from './scheduleCron.js';
import {
    endedChange,
    indexDefFor,
    recoveredOwed,
    resumedChange,
    slotDefOf,
} from './scheduleIndex.js';
import {
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
import { firstSlotAtOrAfter } from './scheduleSlots.js';

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
        const appUid = actor.effectiveApp?.uid;
        if (!appUid) throw appRequired();
        if (isAccessTokenActor(actor)) throw scopedToken();
        if ((await this.services.events.hasBackgroundConsent(actor)) !== true)
            throw backgroundConsentRequired();

        const plan = await actorPlanId(this.services.metering, actor);
        const quota: ScheduleQuota = {
            recurringPerUser: limitFor(EVENTS_SCHEDULES_PER_USER, plan),
            recurringPerApp: limitFor(EVENTS_SCHEDULES_PER_APP, plan),
            oneShotsPerUser: limitFor(
                EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_USER,
                plan,
            ),
            oneShotsPerApp: limitFor(
                EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP,
                plan,
            ),
            budgetPerUser: limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_USER, plan),
            budgetPerApp: limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP, plan),
        };
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
     * End one of the caller's schedules. Anyone else's, or one already ended,
     * reads as absent. A delayed send that has started can't be cancelled.
     */
    async remove(actor: Actor, scheduleId: string): Promise<void> {
        if (!this.enabled) throw disabled();
        const row = await this.stores.schedule.get(this.namespace, scheduleId);
        const appUid = actor.effectiveApp?.uid;
        if (
            !row ||
            row.deletedAt !== null ||
            row.holderUserId !== actor.user?.id ||
            (appUid && row.appUid !== appUid)
        )
            throw notFound();

        let ended: ScheduleRow | undefined;
        try {
            if (row.kind === 'deferred') {
                [ended] = await this.stores.schedule.cancelDeferred(
                    [row.id],
                    'removed',
                );
                if (!ended) throw sending();
            } else {
                await this.stores.durableSubscription.removeScheduleSubscription(
                    row.uid,
                );
                [ended] = await this.stores.schedule.finish(
                    [row.id],
                    'removed',
                );
            }
        } catch (err) {
            // Stop it firing anyway; the reconcile finds the live row under
            // the tombstone and finishes the soft delete.
            if (!isHttpError(err))
                await this.#distribute([
                    {
                        region: row.region,
                        change: endedChange(row.uid, null),
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
        let updated: ScheduleRow[] | null = null;
        for (let attempt = 1; attempt <= 2 && updated === null; attempt++) {
            try {
                updated = await this.stores.schedule.applySubscriptionChange(
                    this.namespace,
                    owned.map((row) => row.subId),
                    end,
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
            if (updated) await this.#indexChanged(updated, owned, change);
            else await this.#indexAtCurrentVersion(owned, change, end !== null);
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
        this.clients.event.on('app.uninstalled', async (_key, data) => {
            if (!this.enabled) return;
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
            if (!this.enabled || action !== 'deleted' || !appUid) return;
            await this.#endDeferredForApp(appUid);
        });
        this.clients.event.on('user.delete', async (_key, data) => {
            if (!this.enabled) return;
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
            endRows: (rows, reason) => this.#endRows(rows, reason),
            alarm: (id, message, details) => this.#alarm(id, message, details),
        });
        return this.#reconciler;
    }

    #runnerHost(): ScheduleRunnerHost {
        return {
            index: this.stores.scheduleIndex,
            events: this.services.events,
            actions: this.actions,
            finishRun: async (id, entryVersion, def) => {
                const [row] = await this.stores.schedule.finish(
                    [def.rowId],
                    'ended',
                );
                await this.stores.durableSubscription.removeScheduleSubscription(
                    id,
                );
                return row ? row.version : entryVersion + 1;
            },
            endOrphan: async (id, entryVersion, def) => {
                const row = await this.stores.schedule.getReplica(
                    this.namespace,
                    id,
                );
                if (!row) return entryVersion + 1;
                if (row.deletedAt !== null)
                    return Math.max(row.version, entryVersion);
                const holder = await this.stores.user.getById(def.holderUserId);
                const [ended] = await this.#endRows(
                    [row],
                    holder ? 'app_gone' : 'holder_gone',
                );
                return ended ? ended.version : row.version + 1;
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

    /** End rows in SQL, the subscription rows they own included. */
    async #endRows(
        rows: readonly ScheduleRow[],
        reason: ScheduleEndReason,
    ): Promise<ScheduleRow[]> {
        if (rows.length === 0) return [];
        for (const row of rows)
            if (row.kind !== 'deferred')
                await this.stores.durableSubscription.removeScheduleSubscription(
                    row.uid,
                );
        return this.stores.schedule.finish(
            rows.map((row) => row.id),
            reason,
        );
    }

    /** Index the rows a lifecycle change left, as they now stand. */
    async #indexChanged(
        rows: readonly ScheduleRow[],
        subs: readonly DurableSubscription[],
        change: ScheduleSubscriptionChange,
    ): Promise<void> {
        const subById = new Map(subs.map((sub) => [sub.subId, sub]));
        const now = Date.now();
        const items: IndexItem[] = [];
        const finishing: ScheduleRow[] = [];
        for (const row of rows) {
            const sub = subById.get(row.subId ?? '') ?? null;
            if (row.deletedAt !== null) {
                items.push({
                    region: row.region,
                    change: endedChange(row.uid, row.version),
                });
            } else if (change.type === 'suspended') {
                const def = indexDefFor(row, sub);
                items.push({
                    region: row.region,
                    change: {
                        id: row.uid,
                        version: row.version,
                        state: `suspended:${change.reason}`,
                        def,
                        score: 0,
                        owed: recoveredOwed(def, now),
                    },
                });
            } else if (change.type === 'resumed') {
                const resumed = resumedChange(row, sub, now);
                if (resumed)
                    items.push({ region: row.region, change: resumed });
                // It ended while parked: nothing is left to fire.
                else finishing.push(row);
            }
        }
        for (const ended of await this.#endRows(finishing, 'ended'))
            items.push({
                region: ended.region,
                change: endedChange(ended.uid, ended.version),
            });
        await this.#distribute(items);
    }

    /**
     * The hook's SQL step failed: change the index anyway, at the version it
     * holds. The equal-version apply takes a state change, and the reconcile
     * brings the table in line later.
     */
    async #indexAtCurrentVersion(
        subs: readonly DurableSubscription[],
        change: ScheduleSubscriptionChange,
        ends: boolean,
    ): Promise<void> {
        let rows: ScheduleRow[] = [];
        try {
            rows = await this.stores.schedule.listBySubIdsReplica(
                this.namespace,
                subs.map((sub) => sub.subId),
            );
        } catch {
            // Applied here only, which is right for this region's schedules.
        }
        const byUid = new Map(rows.map((row) => [row.uid, row]));
        const now = Date.now();
        const state = ends
            ? 'ended'
            : change.type === 'suspended'
              ? `suspended:${change.reason}`
              : 'active';
        const items = subs.map((sub): IndexItem => {
            const uid = sub.token.slice(SCHEDULE_TOKEN_PREFIX.length);
            const row = byUid.get(uid);
            const resumed =
                state === 'active' && row ? resumedChange(row, sub, now) : null;
            return {
                region: row?.region ?? this.region,
                change: {
                    id: uid,
                    version: null,
                    state,
                    def: null,
                    score: resumed?.score ?? now,
                    owed: null,
                },
            };
        });
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

const jittered = (ms: number): number => ms * (0.8 + Math.random() * 0.4);

const isIndexChange = (value: unknown): value is ScheduleIndexChange => {
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    return (
        typeof c.id === 'string' &&
        (c.version === null || Number.isSafeInteger(c.version)) &&
        typeof c.state === 'string' &&
        /^(active|ended|suspended:[a-z_]+)$/.test(c.state) &&
        (c.def === null || typeof c.def === 'object') &&
        Number.isFinite(c.score) &&
        (c.owed === null || Number.isFinite(c.owed))
    );
};
