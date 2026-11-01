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
import { EVENTS_SCHEDULE_CRON_SCAN_RUNS } from '../../controllers/events/limits.js';
import { DURABLE_CONTEXT_MAX_BYTES } from '../../stores/events/DurableSubscriptionStore.js';
import { isHttpError } from '../../core/http/HttpError.js';
import {
    validateScheduleRequest,
    type ScheduleRequest,
} from './scheduleOptions.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PAID = MIN;
const FREE = 15 * MIN;
const at = (iso: string): number => Date.parse(iso);
const NOW = Date.parse('2026-10-30T12:00:00.250Z');
const NOW_UP = Date.parse('2026-10-30T12:00:01Z');

const create = (request: ScheduleRequest, minIntervalMs = PAID) =>
    validateScheduleRequest(
        { handlerName: 'tick', ...request },
        { now: NOW, minIntervalMs },
    );

const refusal = async (
    request: ScheduleRequest,
    minIntervalMs = PAID,
): Promise<{ status: number; code: string | undefined }> => {
    try {
        await create(request, minIntervalMs);
    } catch (err) {
        if (isHttpError(err))
            return { status: err.statusCode, code: err.legacyCode };
        throw err;
    }
    throw new Error('expected the request to be refused');
};

describe('choosing a kind', () => {
    it.each([
        ['none', {}],
        ['every and cron', { every: '1h', cron: '@daily' }],
        ['every and at', { every: '1h', at: NOW + HOUR }],
        ['cron and at', { cron: '@daily', at: NOW + HOUR }],
    ])('refuses %s', async (_label, request) => {
        expect(await refusal(request)).toEqual({
            status: 400,
            code: 'events_schedule_invalid',
        });
    });

    it('ignores kinds sent as null', async () => {
        expect(
            (await create({ every: '1h', cron: null, at: null })).everyMs,
        ).toBe(HOUR);
    });
});

describe('the handler and context', () => {
    it('needs a handler name', async () => {
        expect(await refusal({ every: '1h', handlerName: undefined })).toEqual({
            status: 400,
            code: 'events_handler_required',
        });
    });

    it('refuses a handler hash that is not a digest', async () => {
        expect((await refusal({ every: '1h', handlerHash: 'nope' })).code).toBe(
            'bad_request',
        );
    });

    it('stores context as JSON, up to 4 KB', async () => {
        expect(
            (await create({ every: '1h', context: { team: 'design' } }))
                .context,
        ).toBe('{"team":"design"}');
        expect(
            await refusal({
                every: '1h',
                context: { blob: 'x'.repeat(DURABLE_CONTEXT_MAX_BYTES) },
            }),
        ).toEqual({ status: 413, code: 'events_context_too_large' });
    });
});

describe('an `at` one-shot', () => {
    it('rounds up to a whole second and has no rate or gap', async () => {
        expect(await create({ at: NOW + HOUR + 1 })).toMatchObject({
            kind: 'once',
            startAt: NOW_UP + HOUR,
            endsAt: NOW_UP + HOUR,
            firstSlot: NOW_UP + HOUR,
            ratePerHour: 0,
            minGapMs: null,
        });
    });

    it('takes ISO-8601 too', async () => {
        expect((await create({ at: '2026-11-01T18:30:00Z' })).startAt).toBe(
            Date.parse('2026-11-01T18:30:00Z'),
        );
    });

    it.each([
        ['in the past', NOW - MIN],
        ['less than a second out', NOW + 500],
        ['more than 366 days out', NOW + 367 * DAY],
        ['unparseable', 'tomorrow'],
        ['a boolean', true],
    ])('refuses a time %s', async (_label, value) => {
        expect((await refusal({ at: value })).code).toBe(
            'events_schedule_invalid',
        );
    });

    it('takes no startAt, expiresAt or maxRuns', async () => {
        for (const extra of [
            { startAt: NOW + HOUR },
            { expiresAt: NOW + DAY },
            { maxRuns: 1 },
        ])
            expect((await refusal({ at: NOW + HOUR, ...extra })).code).toBe(
                'events_schedule_invalid',
            );
    });
});

describe('an `every` schedule', () => {
    it.each([
        ['30s', 30 * SEC],
        ['15m', 15 * MIN],
        ['6h', 6 * HOUR],
        ['1d', DAY],
        ['2w', 14 * DAY],
        [90_000, 90 * SEC],
    ])('reads %s', async (every, ms) => {
        expect((await create({ every }, 0)).everyMs).toBe(ms);
    });

    it.each([
        ['a fraction of a second', 1_500],
        ['zero', 0],
        ['a negative number', -60_000],
        ['zero seconds', '0s'],
        ['an unknown unit', '5y'],
        ['more than 366 days', '367d'],
        ['a decimal', '1.5h'],
        ['an object', { h: 1 }],
    ])('refuses %s', async (_label, every) => {
        expect((await refusal({ every }, 0)).code).toBe(
            'events_schedule_invalid',
        );
    });

    it('first runs one interval after create', async () => {
        expect(await create({ every: '1h' })).toMatchObject({
            startAt: NOW_UP + HOUR,
            firstSlot: NOW_UP + HOUR,
            minGapMs: HOUR,
            ratePerHour: 1000,
            endsAt: null,
        });
    });

    it('rates by runs per hour times 1000, rounded up', async () => {
        expect((await create({ every: '1m' })).ratePerHour).toBe(60_000);
        expect((await create({ every: 7 * MIN })).ratePerHour).toBe(8572);
        expect((await create({ every: '1d' })).ratePerHour).toBe(42);
    });

    it('holds the interval to the plan minimum', async () => {
        expect(await refusal({ every: '5m' }, FREE)).toEqual({
            status: 400,
            code: 'events_schedule_too_frequent',
        });
        expect((await create({ every: '15m' }, FREE)).everyMs).toBe(FREE);
        expect((await create({ every: '1m' }, PAID)).everyMs).toBe(MIN);
    });

    it('keeps a past startAt aligned, firing first at or after create', async () => {
        const spec = await create({
            every: '1d',
            startAt: '2026-01-01T00:00:00Z',
        });
        expect(spec.startAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
        expect(spec.firstSlot).toBe(Date.parse('2026-10-31T00:00:00Z'));
    });

    it('starts at a future startAt', async () => {
        expect(
            (await create({ every: '1h', startAt: '2026-11-02T00:00:00Z' }))
                .firstSlot,
        ).toBe(Date.parse('2026-11-02T00:00:00Z'));
    });

    it('refuses a startAt more than 366 days away', async () => {
        expect(
            (await refusal({ every: '1h', startAt: NOW + 367 * DAY })).code,
        ).toBe('events_schedule_never_fires');
    });

    it('ends at the maxRuns-th run, or expiresAt, whichever is first', async () => {
        expect((await create({ every: '1h', maxRuns: 3 })).endsAt).toBe(
            NOW_UP + 3 * HOUR,
        );
        expect(
            (
                await create({
                    every: '1h',
                    maxRuns: 3,
                    expiresAt: NOW + 2 * HOUR,
                })
            ).endsAt,
        ).toBe(NOW_UP + 2 * HOUR);
        expect(
            (
                await create({
                    every: '1h',
                    maxRuns: 2,
                    expiresAt: NOW + 5 * HOUR,
                })
            ).endsAt,
        ).toBe(NOW_UP + 2 * HOUR);
    });

    it.each([[0], [100_001], [1.5], ['3']])(
        'refuses maxRuns %s',
        async (maxRuns) => {
            expect((await refusal({ every: '1h', maxRuns })).code).toBe(
                'events_schedule_invalid',
            );
        },
    );

    it('refuses a schedule that ends before it first runs', async () => {
        expect(
            (await refusal({ every: '1h', expiresAt: NOW + 30 * MIN })).code,
        ).toBe('events_schedule_never_fires');
        expect(
            (await refusal({ every: '1h', expiresAt: NOW - DAY })).code,
        ).toBe('events_schedule_never_fires');
    });
});

describe('creating a cron schedule', () => {
    const CRON_NOW = at('2026-10-30T00:00:00Z');
    const createCron = (request: ScheduleRequest, minIntervalMs = PAID) =>
        validateScheduleRequest(
            { handlerName: 'tick', ...request },
            { now: CRON_NOW, minIntervalMs },
        );
    const codeOf = async (
        run: () => Promise<unknown>,
    ): Promise<string | undefined> => {
        try {
            await run();
        } catch (err) {
            if (isHttpError(err)) return err.legacyCode;
            throw err;
        }
        return undefined;
    };

    it('stores the canonical zone and the computed rates', async () => {
        const spec = await createCron({
            cron: '0 9 * * 1-5',
            tz: 'US/Eastern',
        });
        expect(spec).toMatchObject({
            kind: 'recurring',
            cron: '0 9 * * 1-5',
            tz: 'America/New_York',
            startAt: CRON_NOW,
            endsAt: null,
            ratePerHour: 1000,
            firstSlot: at('2026-10-30T13:00:00Z'),
        });
    });

    it('defaults the zone to UTC', async () => {
        expect((await createCron({ cron: '@daily' })).tz).toBe('UTC');
    });

    it('says an expression never runs before checking maxRuns', async () => {
        expect(
            await codeOf(() => createCron({ cron: '0 0 30 2 *', maxRuns: 1 })),
        ).toBe('events_schedule_never_fires');
    });

    it('refuses an expression that never runs', async () => {
        expect(await codeOf(() => createCron({ cron: '0 0 30 2 *' }))).toBe(
            'events_schedule_never_fires',
        );
    });

    it('refuses a first run more than 366 days away', async () => {
        expect(await codeOf(() => createCron({ cron: '0 0 29 2 *' }))).toBe(
            'events_schedule_never_fires',
        );
    });

    it('refuses runs closer together than the plan allows', async () => {
        expect(
            await codeOf(() => createCron({ cron: '0-4 9 * * *' }, FREE)),
        ).toBe('events_schedule_too_frequent');
        expect(await createCron({ cron: '0-4 9 * * *' }, PAID)).toMatchObject({
            minGapMs: MIN,
            ratePerHour: 5000,
        });
    });

    it('rates a schedule by its busiest hour', async () => {
        expect((await createCron({ cron: '* * * * *' })).ratePerHour).toBe(
            60_000,
        );
        expect((await createCron({ cron: '*/7 * * * *' })).ratePerHour).toBe(
            9_000,
        );
    });

    it('ends at the maxRuns-th run', async () => {
        expect(
            (await createCron({ cron: '0 9 * * *', maxRuns: 3 })).endsAt,
        ).toBe(at('2026-11-01T09:00:00Z'));
    });

    it('refuses maxRuns past the scan, or past the cap', async () => {
        expect(
            await codeOf(() =>
                createCron({
                    cron: '*/2 * * * *',
                    maxRuns: EVENTS_SCHEDULE_CRON_SCAN_RUNS + 1,
                }),
            ),
        ).toBe('events_schedule_invalid');
        expect(
            await codeOf(() =>
                createCron({ cron: '0 9 * * *', maxRuns: 100_001 }),
            ),
        ).toBe('events_schedule_invalid');
    });

    it('takes the earlier of expiresAt and maxRuns', async () => {
        expect(
            (
                await createCron({
                    cron: '0 9 * * *',
                    maxRuns: 10,
                    expiresAt: '2026-11-02T00:00:00Z',
                })
            ).endsAt,
        ).toBe(at('2026-11-02T00:00:00Z'));
    });

    it('starts no earlier than startAt', async () => {
        expect(
            (
                await createCron({
                    cron: '0 9 * * *',
                    startAt: '2026-11-05T12:00:00Z',
                })
            ).firstSlot,
        ).toBe(at('2026-11-06T09:00:00Z'));
    });

    it('refuses tz without cron', async () => {
        expect(await codeOf(() => createCron({ every: '1h', tz: 'UTC' }))).toBe(
            'events_schedule_invalid',
        );
    });
});

describe('time values', () => {
    it.each([
        ['a date, as UTC midnight', '2026-11-01', at('2026-11-01T00:00:00Z')],
        ['a UTC time', '2026-11-01T18:30:00Z', at('2026-11-01T18:30:00Z')],
        [
            'milliseconds',
            '2026-11-01T18:30:00.250Z',
            at('2026-11-01T18:30:01Z'),
        ],
        ['an offset', '2026-11-01T18:30:00+02:00', at('2026-11-01T16:30:00Z')],
        ['minutes only', '2026-11-01T18:30Z', at('2026-11-01T18:30:00Z')],
        [
            'whole epoch ms',
            at('2026-11-01T18:30:00Z'),
            at('2026-11-01T18:30:00Z'),
        ],
    ])('reads %s', async (_label, value, ms) => {
        expect((await create({ at: value })).startAt).toBe(ms);
    });

    it.each([
        ['a US-style date', '11/01/2026'],
        [
            'a time with no zone, read in the server`s zone',
            '2026-11-01T18:30:00',
        ],
        ['a day the month doesn`t have', '2026-02-30'],
        ['hour 24', '2026-11-01T24:00:00Z'],
        ['a lowercase separator', '2026-11-01t18:30:00z'],
        ['an offset past a day', '2026-11-01T18:30:00+24:00'],
        ['epoch ms past what is stored exactly', 1e100],
        ['fractional epoch ms', at('2026-11-01T18:30:00Z') + 0.5],
        ['a negative time', -1000],
        ['a negative time that rounds up to zero', -1],
    ])('refuses %s', async (_label, value) => {
        expect((await refusal({ every: '1h', expiresAt: value })).code).toBe(
            'events_schedule_invalid',
        );
    });
});
