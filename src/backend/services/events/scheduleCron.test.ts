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
    EVENTS_SCHEDULE_SCAN_CONCURRENCY,
    EVENTS_SCHEDULE_SCAN_QUEUE,
} from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import {
    canonicalTimeZone,
    CRON_NICKNAMES,
    cronFirstAtOrAfter,
    cronLatestAtOrBefore,
    parseCron,
    rememberCron,
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
const stepped = vi.hoisted(() => ({ nextRuns: 0 }));

vi.mock('croner', async (importOriginal) => {
    const actual = await importOriginal<typeof import('croner')>();
    class RecordingCron extends actual.Cron {
        constructor(pattern: string, options: Record<string, unknown>) {
            built.push(options);
            super(pattern, options);
        }

        override nextRun(prev?: Date | string | null): Date | null {
            stepped.nextRuns++;
            return super.nextRun(prev);
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

    it('takes month and day names in their fields, in any case', () => {
        expect(parseCron('0 0 * JAN-MAR mon-fri', 'UTC')).toBe(
            '0 0 * JAN-MAR mon-fri',
        );
        expect(parseCron('*/15 9-17 1,15 * SUN', 'UTC')).toBe(
            '*/15 9-17 1,15 * SUN',
        );
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
        [
            'a `+` day of week, which would switch the days to AND',
            '0 0 13 * +5',
        ],
        ['`L`', '0 0 L * *'],
        ['`W`', '0 0 1W * *'],
        ['`#`', '0 0 * * 5#2'],
        ['a month name outside the month field', '0 0 JAN * *'],
        ['a day name outside the day field', '0 MON * * *'],
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

    it('runs a list in the repeated hour twice at fall back', () => {
        // One minute and one hour value runs once; a list follows each
        // occurrence of the local time, so both 01:00 and 01:30 repeat.
        const d = def('0,30 1 * * *', 'America/New_York');
        const day = [at('2026-11-01T04:00:00Z'), at('2026-11-02T05:00:00Z')];
        expect(slots(d, day[0], 4)).toEqual([
            '2026-11-01T05:00:00.000Z',
            '2026-11-01T05:30:00.000Z',
            '2026-11-01T06:00:00.000Z',
            '2026-11-01T06:30:00.000Z',
        ]);
        expect(countSlots(d, day[0], day[1], 10).count).toBe(4);
        expect(latestSlotAtOrBefore(d, at('2026-11-01T06:45:00Z'))).toBe(
            at('2026-11-01T06:30:00Z'),
        );
        expect(latestSlotAtOrBefore(d, at('2026-11-01T05:45:00Z'))).toBe(
            at('2026-11-01T05:30:00Z'),
        );
    });

    it('skips a list in the missing hour at spring forward', () => {
        const d = def('0,30 2 * * *', 'America/New_York');
        expect(slots(d, at('2027-03-13T12:00:00Z'), 2)).toEqual([
            '2027-03-15T06:00:00.000Z',
            '2027-03-15T06:30:00.000Z',
        ]);
        expect(
            countSlots(
                d,
                at('2027-03-14T05:00:00Z'),
                at('2027-03-15T04:00:00Z'),
                10,
            ).count,
        ).toBe(0);
        expect(latestSlotAtOrBefore(d, at('2027-03-15T00:00:00Z'))).toBe(
            at('2027-03-13T07:30:00Z'),
        );
    });

    it('scans a list across both changes the same way', async () => {
        const fallBack = await scanCron(
            '0,30 1 * * *',
            'America/New_York',
            at('2026-10-31T12:00:00Z'),
        );
        expect(fallBack.minGapMs).toBe(30 * MIN);
        expect(fallBack.peakPerHour).toBe(2);
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
    it('finds the smallest gap between runs', async () => {
        expect((await scanCron('0-4 9 * * *', 'UTC', NOW)).minGapMs).toBe(MIN);
        // Spring forward makes one day 23 hours long.
        expect(
            (await scanCron('0 9 * * *', 'America/New_York', NOW)).minGapMs,
        ).toBe(23 * HOUR);
    });

    it('finds the worst-case runs in any one hour', async () => {
        expect((await scanCron('* * * * *', 'UTC', NOW)).peakPerHour).toBe(60);
        expect((await scanCron('*/7 * * * *', 'UTC', NOW)).peakPerHour).toBe(9);
        expect((await scanCron('0,59 * * * *', 'UTC', NOW)).peakPerHour).toBe(
            2,
        );
        expect((await scanCron('0 9 * * *', 'UTC', NOW)).peakPerHour).toBe(1);
    });

    it('stops at the run cap', async () => {
        const scan = await scanCron('*/2 * * * *', 'UTC', NOW, {
            nth: EVENTS_SCHEDULE_CRON_SCAN_RUNS + 1,
        });
        expect(scan.nth).toBeNull();
        expect(
            (
                await scanCron('*/2 * * * *', 'UTC', NOW, {
                    nth: EVENTS_SCHEDULE_CRON_SCAN_RUNS,
                })
            ).nth,
        ).toBe(NOW + (EVENTS_SCHEDULE_CRON_SCAN_RUNS - 1) * 2 * MIN);
    });

    it('stops at the first gap under the plan minimum', async () => {
        stepped.nextRuns = 0;
        const scan = await scanCron('*/3 * * * *', 'UTC', NOW, {
            minIntervalMs: 15 * MIN,
        });
        expect(scan.minGapMs).toBe(3 * MIN);
        expect(stepped.nextRuns).toBeLessThan(5);
    });

    it('reuses a complete scan started the same day', async () => {
        const from = at('2026-12-01T03:00:00Z');
        const first = await scanCron('*/4 * * * *', 'UTC', from);
        stepped.nextRuns = 0;
        const again = await scanCron('*/4 * * * *', 'UTC', from + HOUR + 1);
        expect(stepped.nextRuns).toBe(1);
        expect(again).toEqual({
            first: from + HOUR + 4 * MIN,
            minGapMs: first.minGapMs,
            peakPerHour: first.peakPerHour,
            nth: null,
        });
    });

    it('never reuses a scan cut short by the plan minimum', async () => {
        const from = at('2026-12-02T03:00:00Z');
        await scanCron('*/5 * * * *', 'UTC', from, { minIntervalMs: HOUR });
        const full = await scanCron('*/5 * * * *', 'UTC', from);
        expect(full.peakPerHour).toBe(12);
    });

    it('refuses a scan past the queue as busy', async () => {
        const from = at('2026-12-03T00:00:00Z');
        const runs = Array.from(
            {
                length:
                    EVENTS_SCHEDULE_SCAN_CONCURRENCY +
                    EVENTS_SCHEDULE_SCAN_QUEUE +
                    1,
            },
            // `nth` skips the result cache, so every one has to walk.
            () => scanCron('0 0 * * *', 'UTC', from, { nth: 1 }),
        );
        const settled = await Promise.allSettled(runs);
        const refused = settled.filter((r) => r.status === 'rejected');
        expect(refused).toHaveLength(1);
        const reason = (refused[0] as PromiseRejectedResult).reason;
        expect(isHttpError(reason) && reason.statusCode).toBe(503);
        expect(isHttpError(reason) && reason.legacyCode).toBe(
            'events_schedule_busy',
        );
        // The gate is free again afterwards.
        await expect(
            scanCron('0 0 * * *', 'UTC', from, { nth: 1 }),
        ).resolves.toMatchObject({ nth: from });
    });
});

describe('the instance cache', () => {
    it('keeps nothing for an expression that was only validated', async () => {
        const pattern = '11 4 * * *';
        parseCron(pattern, 'UTC');
        await scanCron(pattern, 'UTC', NOW, { nth: 1 });
        built.length = 0;
        cronFirstAtOrAfter(pattern, 'UTC', NOW);
        expect(built).toHaveLength(1);
    });

    it('reuses the instance of a schedule that exists', () => {
        const pattern = '12 4 * * *';
        rememberCron(pattern, 'UTC');
        built.length = 0;
        cronFirstAtOrAfter(pattern, 'UTC', NOW);
        cronLatestAtOrBefore(pattern, 'UTC', NOW);
        expect(built).toHaveLength(0);
    });
});
