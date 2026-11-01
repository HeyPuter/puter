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
    EVENTS_SCHEDULE_CRON_SCAN_MS,
    EVENTS_SCHEDULE_MAX_AHEAD_MS,
    EVENTS_SCHEDULE_MAX_RUNS,
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import { assertDurableContext } from '../../stores/events/DurableSubscriptionStore.js';
import { canonicalTimeZone, parseCron, scanCron } from './scheduleCron.js';
import {
    ceilToSecond,
    firstSlotAtOrAfter,
    type SlotDef,
} from './scheduleSlots.js';
import {
    parseContext,
    parseHandlerHash,
    parseHandlerName,
} from './requestParsing.js';

/**
 * Validation of a schedule create: the options as a caller sends them, turned
 * into a definition the slot math and the store take. Plan-dependent numbers
 * are passed in, so this stays pure.
 */

/** Options of `POST /events/schedules`, as received. */
export interface ScheduleRequest {
    every?: unknown;
    cron?: unknown;
    tz?: unknown;
    at?: unknown;
    startAt?: unknown;
    expiresAt?: unknown;
    maxRuns?: unknown;
    handlerName?: unknown;
    handlerHash?: unknown;
    context?: unknown;
}

/** A validated schedule, ready to store. */
export interface ScheduleSpec extends SlotDef {
    kind: 'recurring' | 'once';
    /** Smallest gap between runs; `null` for a one-shot. */
    minGapMs: number | null;
    /** Worst-case runs in any hour, times 1000; `0` for a one-shot. */
    ratePerHour: number;
    /** The first slot due after create. */
    firstSlot: number;
    handlerName: string;
    handlerHash: string | null;
    context: string | null;
}

// -- Errors -----------------------------------------------------------

const scheduleInvalid = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'events_schedule_invalid' });

const scheduleNeverFires = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'events_schedule_never_fires' });

const scheduleTooFrequent = (minIntervalMs: number): HttpError =>
    new HttpError(
        400,
        `A schedule may not run more often than every ${minIntervalMs / 1000} seconds on this plan`,
        { legacyCode: 'events_schedule_too_frequent' },
    );

const handlerRequired = (): HttpError =>
    new HttpError(400, 'A schedule needs a handlerName', {
        legacyCode: 'events_handler_required',
    });

// -- Fields -----------------------------------------------------------

const EVERY_UNIT_MS: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

const present = (value: unknown): boolean =>
    value !== undefined && value !== null;

/**
 * A date (`2026-11-01`, read as UTC midnight) or a date and time with `Z` or an
 * offset. A time without a zone is refused: it would be read in whatever zone
 * the server runs in.
 */
const ISO_TIME =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** Epoch ms of a strict ISO-8601 string, or `NaN`. Calendar overflow is refused. */
const parseIso = (value: string): number => {
    const match = ISO_TIME.exec(value);
    if (!match) return Number.NaN;
    const [, y, mo, d, h = '0', mi = '0', sec = '0', frac = '0', zone] = match;
    const fields = [y, mo, d, h, mi, sec].map(Number);
    const local = Date.UTC(
        fields[0],
        fields[1] - 1,
        fields[2],
        fields[3],
        fields[4],
        fields[5],
        Number(frac.padEnd(3, '0')),
    );
    const back = new Date(local);
    if (
        back.getUTCFullYear() !== fields[0] ||
        back.getUTCMonth() !== fields[1] - 1 ||
        back.getUTCDate() !== fields[2] ||
        back.getUTCHours() !== fields[3] ||
        back.getUTCMinutes() !== fields[4] ||
        back.getUTCSeconds() !== fields[5]
    )
        return Number.NaN;
    if (zone === undefined || zone === 'Z') return local;
    const sign = zone.startsWith('-') ? -1 : 1;
    const [oh, om] = zone.slice(1).split(':').map(Number);
    if (oh > 23 || om > 59) return Number.NaN;
    return local - sign * (oh * 60 + om) * 60_000;
};

/**
 * A strict ISO-8601 string or whole epoch ms, rounded up to the next whole
 * second. Past `MAX_SAFE_INTEGER` no engine stores it exactly.
 */
const parseTime = (value: unknown, field: string): number | null => {
    if (!present(value)) return null;
    const ms =
        typeof value === 'number'
            ? Number.isSafeInteger(value)
                ? value
                : Number.NaN
            : typeof value === 'string'
              ? parseIso(value)
              : Number.NaN;
    const rounded = ceilToSecond(ms);
    if (!Number.isSafeInteger(rounded) || rounded < 0)
        throw scheduleInvalid(
            `${field} must be an ISO-8601 time with a zone, or whole epoch milliseconds`,
        );
    return rounded;
};

/** Milliseconds, or `<n>(s|m|h|d|w)`; a whole number of seconds. */
const parseEvery = (value: unknown): number => {
    let ms: number;
    if (typeof value === 'number') ms = value;
    else if (typeof value === 'string') {
        const match = /^([1-9]\d{0,9})([smhdw])$/.exec(value.trim());
        if (!match)
            throw scheduleInvalid(
                'every must be milliseconds or a duration like `6h`',
            );
        ms = Number(match[1]) * EVERY_UNIT_MS[match[2]];
    } else throw scheduleInvalid('every must be a number or a string');

    if (!Number.isSafeInteger(ms) || ms <= 0 || ms % 1000 !== 0)
        throw scheduleInvalid('every must be a whole number of seconds');
    if (ms > EVENTS_SCHEDULE_MAX_AHEAD_MS)
        throw scheduleInvalid('every may not exceed 366 days');
    return ms;
};

const parseMaxRuns = (value: unknown): number | null => {
    if (!present(value)) return null;
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > EVENTS_SCHEDULE_MAX_RUNS
    )
        throw scheduleInvalid(
            `maxRuns must be a whole number from 1 to ${EVENTS_SCHEDULE_MAX_RUNS}`,
        );
    return value;
};

const assertNotTooFar = (at: number, now: number, what: string): void => {
    if (at - now > EVENTS_SCHEDULE_MAX_AHEAD_MS)
        throw scheduleNeverFires(`${what} is more than 366 days away`);
};

// -- Validation -------------------------------------------------------

/**
 * Validate a create and compute everything stored with it. `minIntervalMs` is
 * the caller's plan minimum, checked against the smallest gap between runs.
 */
export const validateScheduleRequest = async (
    request: ScheduleRequest,
    opts: { now: number; minIntervalMs: number },
): Promise<ScheduleSpec> => {
    const { now, minIntervalMs } = opts;
    const kinds = [request.every, request.cron, request.at].filter(present);
    if (kinds.length !== 1)
        throw scheduleInvalid('Exactly one of every, cron or at is required');
    if (present(request.tz) && !present(request.cron))
        throw scheduleInvalid('tz is only valid with cron');

    const handlerName = parseHandlerName(request.handlerName);
    if (handlerName === null) throw handlerRequired();
    const handlerHash = parseHandlerHash(request.handlerHash);
    const context = parseContext(request.context);
    assertDurableContext(context);
    const handler = { handlerName, handlerHash, context };

    if (present(request.at)) {
        if ([request.startAt, request.expiresAt, request.maxRuns].some(present))
            throw scheduleInvalid('at takes no startAt, expiresAt or maxRuns');
        const at = parseTime(request.at, 'at')!;
        if (at < now + 1000)
            throw scheduleInvalid('at must be at least 1 second in the future');
        if (at - now > EVENTS_SCHEDULE_MAX_AHEAD_MS)
            throw scheduleInvalid('at may not be more than 366 days away');
        return {
            kind: 'once',
            startAt: at,
            everyMs: null,
            cron: null,
            tz: 'UTC',
            endsAt: at,
            minGapMs: null,
            ratePerHour: 0,
            firstSlot: at,
            ...handler,
        };
    }

    const startAt = parseTime(request.startAt, 'startAt');
    if (startAt !== null) assertNotTooFar(startAt, now, 'startAt');
    const expiresAt = parseTime(request.expiresAt, 'expiresAt');
    const maxRuns = parseMaxRuns(request.maxRuns);

    let def: SlotDef;
    let first: number | null;
    let minGapMs: number;
    let ratePerHour: number;
    let nth: number | null = null;

    if (present(request.every)) {
        const everyMs = parseEvery(request.every);
        if (everyMs < minIntervalMs) throw scheduleTooFrequent(minIntervalMs);
        def = {
            kind: 'recurring',
            startAt: startAt ?? ceilToSecond(now) + everyMs,
            everyMs,
            cron: null,
            tz: 'UTC',
            endsAt: null,
        };
        first = firstSlotAtOrAfter(def, now);
        minGapMs = everyMs;
        ratePerHour = Math.ceil(3_600_000_000 / everyMs);
        if (maxRuns !== null) nth = first! + (maxRuns - 1) * everyMs;
    } else {
        const tz = canonicalTimeZone(request.tz);
        const cron = parseCron(request.cron, tz);
        def = {
            kind: 'recurring',
            startAt: startAt ?? ceilToSecond(now),
            everyMs: null,
            cron,
            tz,
            endsAt: null,
        };
        const scan = await scanCron(cron, tz, Math.max(now, def.startAt), {
            minIntervalMs,
            ...(maxRuns !== null ? { nth: maxRuns } : {}),
        });
        first = scan.first;
        if (first === null)
            throw scheduleNeverFires('This schedule never runs');
        assertNotTooFar(first, now, 'The first run');
        // One run in the whole scan: its gap is at least the scan window.
        minGapMs = scan.minGapMs ?? EVENTS_SCHEDULE_CRON_SCAN_MS;
        if (minGapMs < minIntervalMs) throw scheduleTooFrequent(minIntervalMs);
        ratePerHour = scan.peakPerHour * 1000;
        if (maxRuns !== null) {
            if (scan.nth === null)
                throw scheduleInvalid(
                    'maxRuns reaches past the runs a cron schedule is checked over',
                );
            nth = scan.nth;
        }
    }
    if (first === null) throw scheduleNeverFires('This schedule never runs');
    assertNotTooFar(first, now, 'The first run');

    const ends = [expiresAt, nth].filter((v): v is number => v !== null);
    const endsAt = ends.length ? Math.min(...ends) : null;
    if (endsAt !== null && endsAt < first)
        throw scheduleNeverFires('This schedule ends before its first run');

    return {
        ...def,
        kind: 'recurring',
        endsAt,
        minGapMs,
        ratePerHour,
        firstSlot: first,
        ...handler,
    };
};
