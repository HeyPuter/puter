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

import type {
    ScheduleIndexChange,
    ScheduleIndexDef,
} from '../../stores/events/ScheduleIndexStore.js';
import type { ScheduleRow } from '../../stores/events/ScheduleStore.js';
import {
    firstSlotAtOrAfter,
    recoverOwed,
    spreadOffsetMs,
    type SlotDef,
} from './scheduleSlots.js';

/**
 * Turning schedule rows into due-index changes. The index mirrors the row and
 * its subscription row; when a schedule fires next is computed from what is
 * mirrored here.
 */

/** The handler a schedule runs, from the subscription row it owns. */
export interface ScheduleHandlerRef {
    handlerName: string | null;
    context: string | null;
}

export const indexDefFor = (
    row: ScheduleRow,
    sub: ScheduleHandlerRef | null,
): ScheduleIndexDef => ({
    rowId: row.id,
    kind: row.kind,
    startAt: row.startAt,
    everyMs: row.everyMs,
    cron: row.cron,
    tz: row.tz,
    endsAt: row.endsAt,
    createdAt: row.createdAt,
    subId: row.subId,
    holderUserId: row.holderUserId,
    appUid: row.appUid,
    handlerName: sub?.handlerName ?? null,
    context: sub?.context ?? null,
    handlerDepth: row.handlerDepth,
    offsetMs: spreadOffsetMs(row.uid, row.kind, row.minGapMs),
    action: row.action,
});

export const slotDefOf = (def: ScheduleIndexDef): SlotDef => ({
    kind: def.kind,
    startAt: def.startAt,
    everyMs: def.everyMs,
    cron: def.cron,
    tz: def.tz,
    endsAt: def.endsAt,
});

export const endedChange = (
    uid: string,
    version: number | null,
): ScheduleIndexChange => ({
    id: uid,
    version,
    state: 'ended',
    def: null,
    score: 0,
    owed: null,
});

/**
 * The slot an index entry built without run state starts from (see
 * {@link recoverOwed}); `null` when there is nothing left to fire.
 */
export const recoveredOwed = (
    def: ScheduleIndexDef,
    now: number,
): number | null =>
    recoverOwed(slotDefOf(def), def.createdAt, now, def.offsetMs);

/**
 * A live entry for `row` as of `now`, due at its recovered slot, or `null` when
 * it has nothing left to fire.
 */
export const liveChange = (
    row: ScheduleRow,
    sub: ScheduleHandlerRef | null,
    state: string,
    now: number,
): ScheduleIndexChange | null => {
    const def = indexDefFor(row, sub);
    const owed = recoveredOwed(def, now);
    if (owed === null) return null;
    return {
        id: row.uid,
        version: row.version,
        state,
        def,
        score: owed + def.offsetMs,
        owed,
    };
};

/**
 * A resumed entry: due at the next slot at or after `now`, keeping the `owed`
 * the index already holds, so the first run reports what was skipped. `null`
 * when the schedule ended while it was parked.
 */
export const resumedChange = (
    row: ScheduleRow,
    sub: ScheduleHandlerRef | null,
    now: number,
): ScheduleIndexChange | null => {
    const def = indexDefFor(row, sub);
    const next = firstSlotAtOrAfter(slotDefOf(def), now - def.offsetMs);
    if (next === null) return null;
    return {
        id: row.uid,
        version: row.version,
        state: 'active',
        def,
        score: next + def.offsetMs,
        owed: recoveredOwed(def, now) ?? next,
    };
};
