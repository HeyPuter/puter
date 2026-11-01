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

import { describe, expect, it, vi } from 'vitest';
import {
    EVENTS_SCHEDULE_CRON_MAX_LENGTH,
    EVENTS_SCHEDULE_CRON_SCAN_RUNS,
    EVENTS_SCHEDULE_MISSED_CAP,
} from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import {
    canonicalTimeZone,
    CRON_NICKNAMES,
    parseCron,
    scanCron,
} from './scheduleCron.js';
import {
    countSlots,
    firstSlotAtOrAfter,
    latestSlotAtOrBefore,
    nextSlotAfter,
    type SlotDef,
} from './scheduleSlots.js';

const built = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('croner', async (importOriginal) => {
    const actual = await importOriginal<typeof import('croner')>();
    class RecordingCron extends actual.Cron {
        constructor(pattern: string, options: Record<string, unknown>) {
            built.push(options);
            super(pattern, options);
        }
    }
    return { ...actual, Cron: RecordingCron };
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (iso: string): number => Date.parse(iso);

const def = (
    pattern: string,
    tz = 'UTC',
    over: Partial<SlotDef> = {},
): SlotDef => ({
    kind: 'recurring',
    startAt: at('2020-01-01T00:00:00Z'),
    everyMs: null,
    cron: pattern,
    tz,
    endsAt: null,
    ...over,
});

/** The first `n` slots at or after `from`. */
const slots = (d: SlotDef, from: number, n: number): string[] => {
    const out: string[] = [];
    let s = firstSlotAtOrAfter(d, from);
    while (s !== null && out.length < n) {
        out.push(new Date(s).toISOString());
        s = nextSlotAfter(d, s);
    }
    return out;
};

const codeOf = (run: () => unknown): string | undefined => {
    try {
        run();
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

const NOW = at('2026-10-30T00:00:00Z');

describe('parsing a cron expression', () => {
    it('takes 5 fields and normalizes whitespace', () => {
        expect(parseCron('  0  9 * *   1-5 ', 'UTC')).toBe('0 9 * * 1-5');
    });

    it('takes the standard nicknames', () => {
        for (const nickname of CRON_NICKNAMES)
            expect(parseCron(nickname, 'UTC')).toBe(nickname);
    });

    it.each([
        ['a seconds field', '0 0 9 * * 1-5'],
        ['a year field', '0 0 0 1 1 * 2027'],
        ['too few fields', '0 9 * *'],
        ['a bare date', '2026-11-01T00:00:00Z'],
        ['an unknown nickname', '@reboot'],
        ['`?`, which reads the clock at parse time', '0 9 ? * *'],
        ['an out-of-range value', '0 25 * * *'],
        ['garbage', 'every day'],
        ['an empty string', '   '],
        ['a non-string', 42],
    ])('refuses %s', (_label, pattern) => {
        expect(codeOf(() => parseCron(pattern, 'UTC'))).toBe(
            'events_schedule_invalid',
        );
    });

    it('caps the length', () => {
        const long = `0 0 1 1 ${'1,'.repeat(70)}1`;
        expect(long.length).toBeGreaterThan(EVENTS_SCHEDULE_CRON_MAX_LENGTH);
        expect(codeOf(() => parseCron(long, 'UTC'))).toBe(
            'events_schedule_invalid',
        );
    });
});

describe('the time zone', () => {
    it('defaults to UTC', () => {
        expect(canonicalTimeZone(undefined)).toBe('UTC');
        expect(canonicalTimeZone(null)).toBe('UTC');
    });

    it('is stored by its canonical name', () => {
        expect(canonicalTimeZone('US/Eastern')).toBe('America/New_York');
        expect(canonicalTimeZone('america/new_york')).toBe('America/New_York');
    });

    it.each([['Mars/Base'], ['+01:00'], [''], [42]])('refuses %s', (tz) => {
        expect(codeOf(() => canonicalTimeZone(tz))).toBe(
            'events_schedule_invalid',
        );
    });

    it('is always handed to croner, UTC included', () => {
        built.length = 0;
        parseCron('17 3 * * *', 'UTC');
        parseCron('17 3 * * *', 'America/New_York');
        parseCron('@weekly', 'Australia/Sydney');
        expect(built.length).toBeGreaterThanOrEqual(3);
        for (const options of built) {
            expect(typeof options.timezone).toBe('string');
            expect(options.domAndDow).toBe(false);
            expect(options.mode).toBe('5-part');
        }
        expect(built.map((o) => o.timezone)).toEqual(
            expect.arrayContaining([
                'UTC',
                'America/New_York',
                'Australia/Sydney',
            ]),
        );
    });
});

describe('cron slots', () => {
    it('reads the hour in the schedule`s zone, across a DST change', () => {
        const weekdays = def('0 9 * * 1-5', 'America/New_York');
        expect(slots(weekdays, at('2026-10-30T00:00:00Z'), 2)).toEqual([
            '2026-10-30T13:00:00.000Z',
            '2026-11-02T14:00:00.000Z',
        ]);
    });

    it('runs a time skipped by spring forward once, after the jump', () => {
        const d = def('30 2 * * *', 'America/New_York');
        expect(slots(d, at('2027-03-13T12:00:00Z'), 2)).toEqual([
            '2027-03-14T07:00:00.000Z',
            '2027-03-15T06:30:00.000Z',
        ]);
        const localDay = countSlots(
            d,
            at('2027-03-14T05:00:00Z'),
            at('2027-03-15T04:00:00Z'),
            10,
        );
        expect(localDay.count).toBe(1);
    });

    it('runs a time repeated by fall back once', () => {
        const d = def('30 1 * * *', 'America/New_York');
        expect(slots(d, at('2026-10-31T12:00:00Z'), 2)).toEqual([
            '2026-11-01T05:30:00.000Z',
            '2026-11-02T06:30:00.000Z',
        ]);
        expect(
            countSlots(
                d,
                at('2026-11-01T04:00:00Z'),
                at('2026-11-02T05:00:00Z'),
                10,
            ).count,
        ).toBe(1);
    });

    it('follows DST in the southern hemisphere', () => {
        // Sydney moves to AEDT (UTC+11) on 2026-10-04 and back to AEST
        // (UTC+10) on 2027-04-04.
        const d = def('0 9 * * *', 'Australia/Sydney');
        expect(slots(d, at('2026-10-02T12:00:00Z'), 3)).toEqual([
            '2026-10-02T23:00:00.000Z',
            '2026-10-03T22:00:00.000Z',
            '2026-10-04T22:00:00.000Z',
        ]);
        expect(slots(d, at('2027-04-02T12:00:00Z'), 3)).toEqual([
            '2027-04-02T22:00:00.000Z',
            '2027-04-03T23:00:00.000Z',
            '2027-04-04T23:00:00.000Z',
        ]);
    });

    it('finds the next leap day', () => {
        expect(slots(def('0 0 29 2 *'), at('2026-10-30T00:00:00Z'), 1)).toEqual(
            ['2028-02-29T00:00:00.000Z'],
        );
    });

    it('skips months without a 31st', () => {
        expect(slots(def('0 0 31 * *'), at('2026-11-01T00:00:00Z'), 3)).toEqual(
            [
                '2026-12-31T00:00:00.000Z',
                '2027-01-31T00:00:00.000Z',
                '2027-03-31T00:00:00.000Z',
            ],
        );
    });

    it('combines day-of-month and day-of-week with OR', () => {
        expect(slots(def('0 0 13 * 5'), at('2026-11-01T00:00:00Z'), 5)).toEqual(
            [
                '2026-11-06T00:00:00.000Z',
                '2026-11-13T00:00:00.000Z',
                '2026-11-20T00:00:00.000Z',
                '2026-11-27T00:00:00.000Z',
                '2026-12-04T00:00:00.000Z',
            ],
        );
        // A 13th that isn't a Friday still runs.
        expect(
            firstSlotAtOrAfter(def('0 0 13 * 5'), at('2026-12-12T00:00:01Z')),
        ).toBe(at('2026-12-13T00:00:00Z'));
    });

    it('rounds a time between seconds up before matching', () => {
        const d = def('0 9 * * *');
        expect(firstSlotAtOrAfter(d, at('2026-11-01T08:59:59Z') + 500)).toBe(
            at('2026-11-01T09:00:00Z'),
        );
        expect(firstSlotAtOrAfter(d, at('2026-11-01T09:00:00Z') + 1)).toBe(
            at('2026-11-02T09:00:00Z'),
        );
    });

    it('never returns a slot before startAt', () => {
        const d = def('0 9 * * *', 'UTC', {
            startAt: at('2026-11-05T12:00:00Z'),
        });
        expect(firstSlotAtOrAfter(d, at('2026-11-01T00:00:00Z'))).toBe(
            at('2026-11-06T09:00:00Z'),
        );
        expect(latestSlotAtOrBefore(d, at('2026-11-05T23:00:00Z'))).toBeNull();
    });

    it('looks back from endsAt once the end has passed', () => {
        const d = def('0 9 * * *', 'UTC', {
            endsAt: at('2026-11-03T10:00:00Z'),
        });
        expect(latestSlotAtOrBefore(d, at('2026-12-01T00:00:00Z'))).toBe(
            at('2026-11-03T09:00:00Z'),
        );
        expect(nextSlotAfter(d, at('2026-11-03T09:00:00Z'))).toBeNull();
    });

    it('counts a slot at exactly the lookup time', () => {
        const d = def('0 9 * * *');
        expect(latestSlotAtOrBefore(d, at('2026-11-01T09:00:00Z'))).toBe(
            at('2026-11-01T09:00:00Z'),
        );
        expect(latestSlotAtOrBefore(d, at('2026-11-01T09:00:00Z') - 1)).toBe(
            at('2026-10-31T09:00:00Z'),
        );
    });

    it('gives up looking back past the reverse lookup window', () => {
        const leap = def('0 0 29 2 *');
        expect(latestSlotAtOrBefore(leap, at('2028-03-01T00:00:00Z'))).toBe(
            at('2028-02-29T00:00:00Z'),
        );
        // The last one is over 400 days back.
        expect(
            latestSlotAtOrBefore(leap, at('2027-06-01T00:00:00Z')),
        ).toBeNull();
    });

    it('caps a count of missed runs', () => {
        const minutely = def('* * * * *');
        expect(
            countSlots(
                minutely,
                at('2026-11-01T00:00:00Z'),
                at('2026-11-03T00:00:00Z'),
                EVENTS_SCHEDULE_MISSED_CAP,
            ),
        ).toEqual({ count: EVENTS_SCHEDULE_MISSED_CAP, capped: true });
    });
});

describe('scanning a cron at create', () => {
    it('finds the smallest gap between runs', () => {
        expect(scanCron('0-4 9 * * *', 'UTC', NOW).minGapMs).toBe(MIN);
        // Spring forward makes one day 23 hours long.
        expect(scanCron('0 9 * * *', 'America/New_York', NOW).minGapMs).toBe(
            23 * HOUR,
        );
    });

    it('finds the worst-case runs in any one hour', () => {
        expect(scanCron('* * * * *', 'UTC', NOW).peakPerHour).toBe(60);
        expect(scanCron('*/7 * * * *', 'UTC', NOW).peakPerHour).toBe(9);
        expect(scanCron('0,59 * * * *', 'UTC', NOW).peakPerHour).toBe(2);
        expect(scanCron('0 9 * * *', 'UTC', NOW).peakPerHour).toBe(1);
    });

    it('stops at the run cap', () => {
        const scan = scanCron('*/2 * * * *', 'UTC', NOW, {
            nth: EVENTS_SCHEDULE_CRON_SCAN_RUNS + 1,
        });
        expect(scan.nth).toBeNull();
        expect(
            scanCron('*/2 * * * *', 'UTC', NOW, {
                nth: EVENTS_SCHEDULE_CRON_SCAN_RUNS,
            }).nth,
        ).toBe(NOW + (EVENTS_SCHEDULE_CRON_SCAN_RUNS - 1) * 2 * MIN);
    });
});
