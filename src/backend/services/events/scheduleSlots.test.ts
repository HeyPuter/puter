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

import { describe, expect, it } from 'vitest';
import {
    EVENTS_SCHEDULE_MISSED_CAP,
    EVENTS_SCHEDULE_ONESHOT_SPREAD_MS,
    EVENTS_SCHEDULE_SPREAD_MAX_MS,
} from '../../controllers/events/limits.js';
import {
    ceilToSecond,
    countSlots,
    firstSlotAtOrAfter,
    latestSlotAtOrBefore,
    nextSlotAfter,
    recoverOwed,
    spreadOffsetMs,
    type SlotDef,
} from './scheduleSlots.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-02T00:00:00Z');

const every = (everyMs: number, over: Partial<SlotDef> = {}): SlotDef => ({
    kind: 'recurring',
    startAt: T0,
    everyMs,
    cron: null,
    tz: 'UTC',
    endsAt: null,
    ...over,
});

const cron = (pattern: string, over: Partial<SlotDef> = {}): SlotDef => ({
    kind: 'recurring',
    startAt: T0,
    everyMs: null,
    cron: pattern,
    tz: 'UTC',
    endsAt: null,
    ...over,
});

const once = (at: number): SlotDef => ({
    kind: 'once',
    startAt: at,
    everyMs: null,
    cron: null,
    tz: 'UTC',
    endsAt: at,
});

describe('an `every` schedule', () => {
    const hourly = every(HOUR);

    it('starts at startAt, and lands on its grid after it', () => {
        expect(firstSlotAtOrAfter(hourly, T0 - DAY)).toBe(T0);
        expect(firstSlotAtOrAfter(hourly, T0)).toBe(T0);
        expect(firstSlotAtOrAfter(hourly, T0 + 1)).toBe(T0 + HOUR);
        expect(firstSlotAtOrAfter(hourly, T0 + 90 * MIN)).toBe(T0 + 2 * HOUR);
    });

    it('steps by its interval', () => {
        expect(nextSlotAfter(hourly, T0)).toBe(T0 + HOUR);
        expect(nextSlotAfter(hourly, T0 + 5 * HOUR)).toBe(T0 + 6 * HOUR);
    });

    it('finds the latest slot at or before a time', () => {
        expect(latestSlotAtOrBefore(hourly, T0 - 1)).toBeNull();
        expect(latestSlotAtOrBefore(hourly, T0)).toBe(T0);
        expect(latestSlotAtOrBefore(hourly, T0 + HOUR - 1)).toBe(T0);
        expect(latestSlotAtOrBefore(hourly, T0 + 3 * HOUR)).toBe(T0 + 3 * HOUR);
    });

    it('counts slots in a half-open range, and stops at the cap', () => {
        expect(countSlots(hourly, T0, T0 + 5 * HOUR, 100)).toEqual({
            count: 5,
            capped: false,
        });
        expect(countSlots(hourly, T0 + 1, T0 + 5 * HOUR + 1, 100)).toEqual({
            count: 5,
            capped: false,
        });
        expect(countSlots(hourly, T0, T0 + 5 * HOUR, 3)).toEqual({
            count: 3,
            capped: true,
        });
        expect(countSlots(hourly, T0 - DAY, T0, 100)).toEqual({
            count: 0,
            capped: false,
        });
    });

    it('caps `missed` for a schedule far behind', () => {
        const minutely = every(MIN);
        expect(
            countSlots(minutely, T0, T0 + 30 * DAY, EVENTS_SCHEDULE_MISSED_CAP),
        ).toEqual({ count: EVENTS_SCHEDULE_MISSED_CAP, capped: true });
    });

    it('honors a future startAt', () => {
        const later = every(HOUR, { startAt: T0 + 7 * DAY });
        expect(firstSlotAtOrAfter(later, T0)).toBe(T0 + 7 * DAY);
        expect(latestSlotAtOrBefore(later, T0 + DAY)).toBeNull();
        expect(countSlots(later, T0, T0 + 7 * DAY, 100).count).toBe(0);
    });

    describe('with an end', () => {
        const ending = every(HOUR, { endsAt: T0 + 2 * HOUR });

        it('includes the slot at endsAt and nothing after it', () => {
            expect(firstSlotAtOrAfter(ending, T0 + 2 * HOUR)).toBe(
                T0 + 2 * HOUR,
            );
            expect(firstSlotAtOrAfter(ending, T0 + 2 * HOUR + 1)).toBeNull();
            expect(nextSlotAfter(ending, T0 + HOUR)).toBe(T0 + 2 * HOUR);
            expect(nextSlotAfter(ending, T0 + 2 * HOUR)).toBeNull();
        });

        it('looks back no further than endsAt', () => {
            expect(latestSlotAtOrBefore(ending, T0 + 10 * HOUR)).toBe(
                T0 + 2 * HOUR,
            );
        });

        it('counts no slot past endsAt', () => {
            expect(countSlots(ending, T0, T0 + 10 * HOUR, 100).count).toBe(3);
        });
    });
});

describe('a one-shot', () => {
    const at = T0 + 3 * HOUR;
    const def = once(at);

    it('has exactly one slot', () => {
        expect(firstSlotAtOrAfter(def, T0)).toBe(at);
        expect(firstSlotAtOrAfter(def, at)).toBe(at);
        expect(firstSlotAtOrAfter(def, at + 1)).toBeNull();
        expect(nextSlotAfter(def, at)).toBeNull();
        expect(latestSlotAtOrBefore(def, at - 1)).toBeNull();
        expect(latestSlotAtOrBefore(def, at + DAY)).toBe(at);
        expect(countSlots(def, T0, at + 1, 10)).toEqual({
            count: 1,
            capped: false,
        });
        expect(countSlots(def, T0, at, 10).count).toBe(0);
    });

    it('a deferred row behaves the same', () => {
        const deferred: SlotDef = { ...def, kind: 'deferred' };
        expect(firstSlotAtOrAfter(deferred, T0)).toBe(at);
        expect(nextSlotAfter(deferred, at)).toBeNull();
    });
});

describe('rounding', () => {
    it('rounds up to the next whole second', () => {
        expect(ceilToSecond(T0)).toBe(T0);
        expect(ceilToSecond(T0 + 1)).toBe(T0 + 1000);
        expect(ceilToSecond(T0 + 999)).toBe(T0 + 1000);
        expect(ceilToSecond(T0 + 1000)).toBe(T0 + 1000);
    });
});

describe('recovering the slot to fire after the index lost it', () => {
    const created = T0 - 7 * DAY;

    it('fires an hourly schedule`s slot 20 minutes late, not the next one', () => {
        const hourly = every(HOUR, { startAt: created });
        expect(recoverOwed(hourly, created, T0 + 20 * MIN, 0)).toBe(T0);
    });

    it('fires a daily schedule`s slot 20 minutes late', () => {
        const daily = every(DAY, { startAt: created });
        expect(recoverOwed(daily, created, T0 + 20 * MIN, 0)).toBe(T0);
    });

    it('fires a monthly schedule`s slot 20 minutes late', () => {
        const monthly = cron('0 0 1 * *', { startAt: created - 90 * DAY });
        const first = Date.parse('2026-12-01T00:00:00Z');
        expect(
            recoverOwed(monthly, created - 90 * DAY, first + 20 * MIN, 0),
        ).toBe(first);
    });

    it('fires the last slot at or before endsAt once the end has passed', () => {
        const ended = every(HOUR, {
            startAt: created,
            endsAt: T0 - 30 * MIN,
        });
        expect(recoverOwed(ended, created, T0 + DAY, 0)).toBe(T0 - HOUR);
    });

    it('looks at the slot the spread has made due, not the clock', () => {
        const hourly = every(HOUR, { startAt: created });
        // 10 s past the slot with a 20 s offset: the slot isn't due yet.
        expect(recoverOwed(hourly, created, T0 + 10_000, 20_000)).toBe(
            T0 - HOUR,
        );
    });

    it('never recovers a slot from before the schedule was created', () => {
        const aligned = every(DAY, { startAt: T0 - 30 * DAY });
        const createdLate = T0 + HOUR;
        expect(recoverOwed(aligned, createdLate, T0 + 2 * HOUR, 0)).toBe(
            T0 + DAY,
        );
    });

    it('fires a pending one-shot at its time, even if it has passed', () => {
        expect(recoverOwed(once(T0), created, T0 + DAY, 0)).toBe(T0);
    });
});

describe('the spread offset', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `sched-${i}`);

    it('is stable for one schedule', () => {
        for (const id of ids)
            expect(spreadOffsetMs(id, 'recurring', HOUR)).toBe(
                spreadOffsetMs(id, 'recurring', HOUR),
            );
    });

    it('stays in whole seconds inside the window', () => {
        const seen = new Set<number>();
        for (const id of ids) {
            const offset = spreadOffsetMs(id, 'recurring', HOUR);
            expect(offset % 1000).toBe(0);
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset).toBeLessThan(EVENTS_SCHEDULE_SPREAD_MAX_MS);
            seen.add(offset);
        }
        // Spread over the window rather than piled on one second.
        expect(seen.size).toBeGreaterThan(20);
    });

    it('narrows to a tenth of a short gap', () => {
        for (const id of ids)
            expect(spreadOffsetMs(id, 'recurring', MIN)).toBeLessThan(6_000);
    });

    it('is zero when a tenth of the gap is under a second', () => {
        for (const id of ids)
            expect(spreadOffsetMs(id, 'recurring', 9_000)).toBe(0);
    });

    it('uses the one-shot window for a one-shot', () => {
        for (const id of ids)
            expect(spreadOffsetMs(id, 'once', null)).toBeLessThan(
                EVENTS_SCHEDULE_ONESHOT_SPREAD_MS,
            );
    });
});
