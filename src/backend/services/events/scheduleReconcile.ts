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

import { EVENTS_SCHEDULE_TOMBSTONE_TTL_MS } from '../../controllers/events/limits.js';
import {
    SCHEDULE_PARTITIONS,
    parseDefEntry,
    type ScheduleFullDiffCursor,
    type ScheduleIndexChange,
    type ScheduleIndexStore,
} from '../../stores/events/ScheduleIndexStore.js';
import {
    isScheduleOrphan,
    type ScheduleEndReason,
    type ScheduleRow,
    type ScheduleStore,
    type ScheduleSyncRow,
} from '../../stores/events/ScheduleStore.js';
import { scheduleReconcile } from './metrics.js';
import { endedChange, liveChange, rowStateOf } from './scheduleIndex.js';

/**
 * Keeps the region's due index in step with the schedule table, reading only
 * the replica. Lifecycle hooks and peer messages update the index as changes
 * happen; this catches what they lost, and rebuilds the index from nothing.
 *
 * - Incremental: rows changed since the stored cursor, minus an overlap that
 *   covers replica lag and clock skew. The cursor is the largest `updated_at` a
 *   read returned, never a clock.
 * - Full diff: a keyset walk of every row of the region, a page or so per pass,
 *   then a sweep of the index for members the table no longer has, then a purge
 *   of rows ended past {@link EVENTS_SCHEDULE_TOMBSTONE_TTL_MS}. One missing
 *   member is dropped only when a later sweep, at least
 *   {@link FULL_DIFF_ABSENT_MIN_MS} on, still finds it missing.
 * - Rebuild: with no `built` marker the full diff runs back-to-back until a cycle
 *   completes, then seeds the incremental cursor from the cycle's start.
 *
 * Every write to the index is version-guarded, so passes that overlap or replay
 * old rows can't move a schedule backwards.
 */

export const RECONCILE_INTERVAL_MS = 60_000;
export const RECONCILE_OVERLAP_MS = 120_000;
export const RECONCILE_PASS_BUDGET_MS = 40_000;
export const RECONCILE_PAGE = 5000;
export const FULL_DIFF_ABSENT_MIN_MS = 600_000;
const RECONCILE_LOCK_TTL_MS = 55_000;
const SWEEP_SCAN_COUNT = 500;
const PURGE_BATCH = 500;

/** Of each pass, what the incremental step leaves for the full diff. */
const FULL_DIFF_RESERVE_MS = 10_000;

/** Rows one ending transaction takes, with the pass budget checked between. */
const END_BATCH = 200;

/** Index changes one pass may find missing before it raises the drift alarm. */
const DRIFT_ALARM_THRESHOLD = 100;

export type ScheduleDriftKind =
    | 'applied'
    | 'repaired'
    | 'tombstoned'
    | 'orphaned'
    | 'finished'
    | 'forgotten';

export interface ScheduleReconcileReport {
    /** Another node held the region's reconcile. */
    skipped: boolean;
    /** The index has not completed its first full cycle. */
    rebuilding: boolean;
    incrementalRows: number;
    fullRows: number;
    swept: number;
    /** Tombstones dropped past their retention. */
    expired: number;
    /** Rows deleted past their retention. */
    purged: number;
    cycleCompleted: boolean;
    drift: Record<ScheduleDriftKind, number>;
}

/** What the reconcile needs from the layers around it. */
export interface ScheduleReconcileHost {
    index: ScheduleIndexStore;
    store: ScheduleStore;
    namespace: string;
    region: string;
    /**
     * End rows in SQL, subscription rows included, each only while it is still
     * at the version this pass read; `orphan` also needs it to have no
     * subscription row. Returns the rows now ended.
     */
    endRows(
        rows: readonly ScheduleRow[],
        reason: ScheduleEndReason,
        options: { orphan?: boolean },
    ): Promise<ScheduleRow[]>;
    alarm(id: string, message: string, details: Record<string, unknown>): void;
}

export interface ScheduleReconcileOptions {
    page?: number;
    budgetMs?: number;
    /** Monotonic ms, for the pass budget. */
    clock?: () => number;
}

const emptyDrift = (): Record<ScheduleDriftKind, number> => ({
    applied: 0,
    repaired: 0,
    tombstoned: 0,
    orphaned: 0,
    finished: 0,
    forgotten: 0,
});

export class ScheduleReconciler {
    readonly #host: ScheduleReconcileHost;
    readonly #page: number;
    readonly #budgetMs: number;
    readonly #clock: () => number;

    constructor(
        host: ScheduleReconcileHost,
        options: ScheduleReconcileOptions = {},
    ) {
        this.#host = host;
        this.#page = options.page ?? RECONCILE_PAGE;
        this.#budgetMs = options.budgetMs ?? RECONCILE_PASS_BUDGET_MS;
        this.#clock = options.clock ?? (() => performance.now());
    }

    /** One pass, as this region's only reconcile; skipped if another holds it. */
    async pass(): Promise<ScheduleReconcileReport> {
        const report = await this.#host.index.withReconcileLock(
            RECONCILE_LOCK_TTL_MS,
            () => this.#pass(),
        );
        return (
            report ?? {
                skipped: true,
                rebuilding: false,
                incrementalRows: 0,
                fullRows: 0,
                swept: 0,
                expired: 0,
                purged: 0,
                cycleCompleted: false,
                drift: emptyDrift(),
            }
        );
    }

    async #pass(): Promise<ScheduleReconcileReport> {
        const { index } = this.#host;
        const deadline = this.#clock() + this.#budgetMs;
        const built =
            (await index.isBuilt()) && (await index.getSyncCursor()) !== null;
        const report: ScheduleReconcileReport = {
            skipped: false,
            rebuilding: !built,
            incrementalRows: 0,
            fullRows: 0,
            swept: 0,
            expired: 0,
            purged: 0,
            cycleCompleted: false,
            drift: emptyDrift(),
        };
        if (built)
            await this.#incremental(deadline - FULL_DIFF_RESERVE_MS, report);
        await this.#fullDiff(deadline, built, report);

        for (const [kind, count] of Object.entries(report.drift))
            if (count > 0) scheduleReconcile.add(count, { kind });
        const drift = Object.values(report.drift).reduce((a, b) => a + b, 0);
        if (built && drift > DRIFT_ALARM_THRESHOLD)
            this.#host.alarm(
                'events_schedule_reconcile_drift',
                'A schedule reconcile pass found many index entries out of step with the schedule table',
                { ...report.drift },
            );
        return report;
    }

    /**
     * Rows changed since the cursor. A scan that runs out of time leaves its
     * position, and the next pass carries on from there rather than starting
     * over inside the overlap. Each pass reads at least one page.
     */
    async #incremental(
        deadline: number,
        report: ScheduleReconcileReport,
    ): Promise<void> {
        const { index, store, namespace, region } = this.#host;
        const synced = (await index.getSyncCursor())!;
        const resumed = await index.getSyncScan();
        let cursor = resumed
            ? { updatedAt: resumed.updatedAt, id: resumed.id }
            : { updatedAt: synced - RECONCILE_OVERLAP_MS, id: 0 };
        let newest = resumed ? resumed.newest : synced;
        for (let pages = 0; pages === 0 || this.#clock() < deadline; pages++) {
            const { rows, last, more } = await store.changedSince(
                namespace,
                region,
                cursor,
                this.#page,
            );
            if (!(await this.#applyRows(rows, report, true, deadline))) return;
            report.incrementalRows += rows.length;
            if (last) {
                cursor = last;
                newest = Math.max(newest, last.updatedAt);
            }
            if (!more) {
                await index.setSyncCursor(newest);
                await index.setSyncScan(null);
                return;
            }
            await index.setSyncScan({ ...cursor, newest });
        }
    }

    async #fullDiff(
        deadline: number,
        built: boolean,
        report: ScheduleReconcileReport,
    ): Promise<void> {
        const { index, store, namespace, region } = this.#host;
        let cursor: ScheduleFullDiffCursor = (await index.getFullCursor()) ?? {
            afterId: 0,
            cycleStart: await index.now(),
            phase: 'rows',
            partition: 0,
            scan: '0',
        };
        // Steady state takes about a page per pass; a rebuild runs to the budget.
        let room = built ? this.#page : Number.POSITIVE_INFINITY;
        // At least one step a pass, so the full diff always moves.
        for (
            let steps = 0;
            room > 0 && (steps === 0 || this.#clock() < deadline);
            steps++
        ) {
            if (cursor.phase === 'rows') {
                // A row past retention is the purge's; its tombstone may
                // already be forgotten, and applying it would make a new one.
                const { rows, nextId } = await store.listRegionPage(
                    namespace,
                    region,
                    cursor.afterId,
                    this.#page,
                    (await index.now()) - EVENTS_SCHEDULE_TOMBSTONE_TTL_MS,
                );
                // A page whose ends ran out of time is read again next pass.
                if (!(await this.#applyRows(rows, report, built, deadline)))
                    return;
                report.fullRows += rows.length;
                room -= Math.max(rows.length, 1);
                cursor =
                    nextId === null
                        ? { ...cursor, phase: 'sweep', partition: 0, scan: '0' }
                        : { ...cursor, afterId: nextId };
            } else if (cursor.phase === 'purge') {
                const purged = await store.purgeDeletedBefore(
                    namespace,
                    region,
                    (await index.now()) - EVENTS_SCHEDULE_TOMBSTONE_TTL_MS,
                    PURGE_BATCH,
                );
                report.purged += purged;
                room -= Math.max(purged, 1);
                if (purged < PURGE_BATCH) {
                    await this.#completeCycle(cursor, built, report);
                    return;
                }
            } else {
                const { cursor: scan, entries } = await index.scanDefs(
                    cursor.partition,
                    cursor.scan,
                    SWEEP_SCAN_COUNT,
                );
                await this.#sweep(entries, report);
                report.swept += entries.length;
                room -= Math.max(entries.length, 1);
                if (scan !== '0') cursor = { ...cursor, scan };
                else if (cursor.partition + 1 < SCHEDULE_PARTITIONS)
                    cursor = {
                        ...cursor,
                        partition: cursor.partition + 1,
                        scan: '0',
                    };
                else cursor = { ...cursor, phase: 'purge' };
            }
            await index.setFullCursor(cursor);
        }
    }

    async #completeCycle(
        cursor: ScheduleFullDiffCursor,
        built: boolean,
        report: ScheduleReconcileReport,
    ): Promise<void> {
        const { index } = this.#host;
        if (!built) {
            // Rows changed while the cycle ran have `updated_at` past its
            // start, so the incremental pass picks them up.
            await index.setSyncCursor(cursor.cycleStart - RECONCILE_OVERLAP_MS);
            await index.markBuilt();
        }
        report.cycleCompleted = true;
        await index.setFullCursor({
            afterId: 0,
            cycleStart: await index.now(),
            phase: 'rows',
            partition: 0,
            scan: '0',
        });
    }

    /**
     * Bring the index in line with these rows. Rows this pass ends in SQL (an
     * orphan, a schedule with nothing left to fire, a lost soft delete) are the
     * reconcile's own lifecycle writes, once per row, in bounded batches with
     * the deadline checked between them. `false` when it stopped short.
     */
    async #applyRows(
        rows: readonly ScheduleSyncRow[],
        report: ScheduleReconcileReport,
        countApplied: boolean,
        deadline: number,
    ): Promise<boolean> {
        if (rows.length === 0) return true;
        const { index } = this.#host;
        const now = await index.now();
        const wallNow = Date.now();
        const changes: ScheduleIndexChange[] = [];
        const orphans: ScheduleRow[] = [];
        const finishing: ScheduleRow[] = [];
        const revoked: ScheduleRow[] = [];
        // Ended rows whose subscription row a failed write left behind.
        const leftovers: ScheduleRow[] = [];

        for (const row of rows) {
            const state = rowStateOf(row);
            if (state.kind === 'ended') {
                changes.push(endedChange(row.uid, row.version));
                if (
                    row.kind !== 'deferred' &&
                    row.sub !== null &&
                    row.sub.suspendedAt === null
                )
                    leftovers.push(row);
            } else if (state.kind === 'pending') {
                // A create still under way has no subscription row yet; the
                // create indexes it, or the orphan rule ends it.
                if (isScheduleOrphan(row, wallNow)) orphans.push(row);
            } else if (state.kind === 'revoked') revoked.push(row);
            else {
                const change = liveChange(row, row.sub, state.state, now);
                if (change) changes.push(change);
                else finishing.push(row);
            }
        }

        const results = await index.apply(changes);
        const byUid = new Map(rows.map((row) => [row.uid, row]));
        const overTombstone: ScheduleRow[] = [];
        results.forEach((result, i) => {
            if (result === 1 && countApplied) report.drift.applied++;
            if (result === 2) report.drift.repaired++;
            if (result === 3) {
                report.drift.tombstoned++;
                const row = byUid.get(changes[i].id);
                if (row) overTombstone.push(row);
            }
        });

        const ending: Array<{
            rows: ScheduleRow[];
            reason: ScheduleEndReason;
            drift?: ScheduleDriftKind;
        }> = [
            { rows: orphans, reason: 'orphaned', drift: 'orphaned' },
            { rows: finishing, reason: 'ended', drift: 'finished' },
            { rows: revoked, reason: 'permission_revoked', drift: 'finished' },
            // The index decided these ended and the SQL step was lost.
            { rows: overTombstone, reason: 'removed' },
            { rows: leftovers, reason: 'ended' },
        ];
        for (const { rows: group, reason, drift } of ending) {
            for (let at = 0; at < group.length; at += END_BATCH) {
                if (this.#clock() >= deadline) return false;
                const done = await this.#host.endRows(
                    group.slice(at, at + END_BATCH),
                    reason,
                    { orphan: reason === 'orphaned' },
                );
                if (drift)
                    report.drift[drift] += done.filter(
                        (row) => row.endReason === reason,
                    ).length;
                if (done.length > 0)
                    await index.apply(
                        done.map((row) => endedChange(row.uid, row.version)),
                    );
            }
        }
        return true;
    }

    /**
     * Index members against the table: tombstones past retention go, and a live
     * member the table no longer has goes on its second sighting.
     */
    async #sweep(
        entries: ReadonlyArray<[string, string]>,
        report: ScheduleReconcileReport,
    ): Promise<void> {
        const { index, store, namespace } = this.#host;
        const live: string[] = [];
        for (const [id, raw] of entries) {
            const entry = parseDefEntry(raw);
            if (entry?.state === 'ended') {
                if (
                    await index.forgetTombstone(
                        id,
                        EVENTS_SCHEDULE_TOMBSTONE_TTL_MS,
                    )
                )
                    report.expired++;
            } else live.push(id);
        }
        if (live.length === 0) return;
        const present = await store.existingUids(namespace, live);
        for (const id of live) {
            if (present.has(id)) continue;
            if (await index.forgetAbsent(id, FULL_DIFF_ABSENT_MIN_MS))
                report.drift.forgotten++;
        }
    }
}
