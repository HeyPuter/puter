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
import type { ScheduleRow } from '../../stores/events/ScheduleStore.js';
import { resumedChange } from './scheduleIndex.js';
import { spreadOffsetMs } from './scheduleSlots.js';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-02T10:00:00Z');

/** A schedule id whose spread is at least `atLeast`. */
const spreadId = (atLeast: number): string => {
    for (let i = 0; ; i++)
        if (spreadOffsetMs(`spread-${i}`, 'recurring', HOUR) >= atLeast)
            return `spread-${i}`;
};

const row = (uid: string, over: Partial<ScheduleRow> = {}): ScheduleRow =>
    ({
        id: 1,
        uid,
        namespace: 'ns',
        kind: 'recurring',
        subId: 'sub',
        holderUserId: 1,
        appUid: 'app',
        region: 'local',
        startAt: T0,
        everyMs: HOUR,
        cron: null,
        tz: 'UTC',
        endsAt: null,
        ratePerHour: 1000,
        minGapMs: HOUR,
        handlerDepth: 0,
        action: null,
        payload: null,
        state: 'active',
        sendToken: null,
        sendUntil: null,
        endReason: null,
        version: 3,
        deletedAt: null,
        createdAt: T0 - HOUR,
        updatedAt: T0 - HOUR,
        ...over,
    }) as ScheduleRow;

describe('a resume', () => {
    it('fires the first slot at or after now, even inside the last one`s spread', () => {
        const uid = spreadId(10_000);
        const offset = spreadOffsetMs(uid, 'recurring', HOUR);
        const change = resumedChange(row(uid), null, T0 + 5000)!;
        expect(change.score).toBe(T0 + HOUR + offset);
        expect(change.state).toBe('active');
    });

    it('has nothing to fire once the schedule ended while parked', () => {
        expect(
            resumedChange(row('ended', { endsAt: T0 }), null, T0 + 5000),
        ).toBeNull();
    });
});
