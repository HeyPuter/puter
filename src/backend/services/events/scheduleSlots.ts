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

import murmurhash from 'murmurhash';
import type { ScheduleKind } from '../../stores/events/types.js';
import {
    EVENTS_SCHEDULE_ONESHOT_SPREAD_MS,
    EVENTS_SCHEDULE_SPREAD_MAX_MS,
} from '../../controllers/events/limits.js';
import {
    cronCount,
    cronFirstAtOrAfter,
    cronLatestAtOrBefore,
} from './scheduleCron.js';

/**
 * When a schedule runs, as a pure function of its definition and a time. A
 * definition never changes after create, so the next run is computed rather
 * than stored. Times are epoch ms; slots fall on whole seconds.
 */

export interface SlotDef {
    kind: ScheduleKind;
    /** First allowed slot: the `every` origin, or a one-shot's only slot. */
    startAt: number;
    everyMs: number | null;
    cron: string | null;
    /** Canonical IANA zone; `UTC` by default. */
    tz: string;
    /** Last allowed slot, inclusive. A one-shot's equals `startAt`. */
    endsAt: number | null;
}

export const ceilToSecond = (ms: number): number => Math.ceil(ms / 1000) * 1000;

const isOneShot = (def: SlotDef): boolean => def.kind !== 'recurring';

const within = (def: SlotDef, slot: number | null): number | null =>
    slot !== null && def.endsAt !== null && slot > def.endsAt ? null : slot;

/** The first slot at or after `t`, or `null` once the schedule has ended. */
export const firstSlotAtOrAfter = (def: SlotDef, t: number): number | null => {
    if (isOneShot(def)) return t <= def.startAt ? def.startAt : null;
    if (def.cron !== null)
        return within(
            def,
            cronFirstAtOrAfter(def.cron, def.tz, Math.max(t, def.startAt)),
        );
    const every = def.everyMs!;
    if (t <= def.startAt) return within(def, def.startAt);
    const k = Math.ceil((t - def.startAt) / every);
    return within(def, def.startAt + k * every);
};

/** The slot after `slot`; `null` for a one-shot or past the end. */
export const nextSlotAfter = (def: SlotDef, slot: number): number | null =>
    isOneShot(def) ? null : firstSlotAtOrAfter(def, slot + 1000);

/** The latest slot at or before `t`, honoring `endsAt`. */
export const latestSlotAtOrBefore = (
    def: SlotDef,
    t: number,
): number | null => {
    const until = def.endsAt === null ? t : Math.min(t, def.endsAt);
    if (until < def.startAt) return null;
    if (isOneShot(def)) return def.startAt;
    if (def.cron !== null) {
        const latest = cronLatestAtOrBefore(def.cron, def.tz, until);
        return latest === null || latest < def.startAt ? null : latest;
    }
    const every = def.everyMs!;
    return def.startAt + Math.floor((until - def.startAt) / every) * every;
};

/** Slots `s` with `from <= s < to`, counting no further than `cap`. */
export const countSlots = (
    def: SlotDef,
    from: number,
    to: number,
    cap: number,
): { count: number; capped: boolean } => {
    const end = def.endsAt === null ? to : Math.min(to, def.endsAt + 1);
    const start = Math.max(from, def.startAt);
    if (end <= start) return { count: 0, capped: false };
    if (isOneShot(def))
        return cap < 1
            ? { count: 0, capped: true }
            : { count: 1, capped: false };
    if (def.cron !== null) return cronCount(def.cron, def.tz, start, end, cap);

    const first = firstSlotAtOrAfter({ ...def, endsAt: null }, start)!;
    const count = first >= end ? 0 : Math.ceil((end - first) / def.everyMs!);
    return count > cap
        ? { count: cap, capped: true }
        : { count, capped: false };
};

/**
 * How far past its slot a schedule's runs are spread, from its id, so many
 * schedules sharing a slot don't all fire at once. Stable across nodes and
 * rebuilds.
 */
export const spreadOffsetMs = (
    scheduleId: string,
    kind: ScheduleKind,
    minGapMs: number | null,
): number => {
    const window =
        kind === 'recurring'
            ? Math.min(
                  EVENTS_SCHEDULE_SPREAD_MAX_MS,
                  Math.floor((minGapMs ?? 0) / 10),
              )
            : EVENTS_SCHEDULE_ONESHOT_SPREAD_MS;
    if (window < 1000) return 0;
    return Math.floor((murmurhash.v3(scheduleId) % window) / 1000) * 1000;
};

/**
 * The next slot to fire for a schedule the due index has no run state for (a
 * rebuild, or a row it never saw): the latest slot already due, so it fires
 * once rather than being skipped, else the next one. `null` when the schedule
 * has nothing left to fire.
 */
export const recoverOwed = (
    def: SlotDef,
    createdAt: number,
    now: number,
    offsetMs: number,
): number | null => {
    if (isOneShot(def)) return def.startAt;
    const t = now - offsetMs;
    const latest = latestSlotAtOrBefore(def, t);
    if (latest !== null && latest >= Math.max(def.startAt, createdAt))
        return latest;
    return firstSlotAtOrAfter(def, Math.max(t, createdAt));
};
