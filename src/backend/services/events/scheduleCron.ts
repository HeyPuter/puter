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

import { Cron, type CronOptions } from 'croner';
import {
    EVENTS_SCHEDULE_CRON_MAX_LENGTH,
    EVENTS_SCHEDULE_CRON_SCAN_MS,
    EVENTS_SCHEDULE_CRON_SCAN_RUNS,
    EVENTS_SCHEDULE_SCAN_CONCURRENCY,
    EVENTS_SCHEDULE_SCAN_QUEUE,
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import { BoundedTtlMap } from '../../util/boundedTtlMap.js';

/**
 * Cron expressions for schedules: parsing, validation and walking runs in a
 * time zone. Every expression is 5 fields or a nickname in the standard
 * grammar, read in an IANA zone, with day-of-month and day-of-week combined by
 * OR as in Vixie cron.
 *
 * Across a DST change every lookup follows croner: an expression with one
 * minute and one hour value runs once (shifted past a spring-forward gap, once
 * in a fall-back overlap); a list, range or step that lands in the changing
 * hour is skipped in the gap and runs twice in the overlap.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A 5-field expression can't fire more often than this in any hour. */
const MAX_RUNS_PER_HOUR = 60;

export const CRON_NICKNAMES: readonly string[] = [
    '@yearly',
    '@annually',
    '@monthly',
    '@weekly',
    '@daily',
    '@midnight',
    '@hourly',
];

const MONTH_NAMES = /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/gi;
const DAY_NAMES = /SUN|MON|TUE|WED|THU|FRI|SAT/gi;
/** What a field may hold once names are taken out: no croner extensions. */
const FIELD_SYNTAX = /^[0-9*,/-]+$/;

/**
 * Built instances, by (expression, zone). One costs tens of KB, so only
 * schedules that exist are kept: {@link rememberCron} is called once a create
 * succeeds or a schedule is run, never by validation.
 */
const CRON_CACHE_MAX_ENTRIES = 256;
const CRON_CACHE_TTL_MS = 10 * 60 * 1000;

/** Create-scan results, by (expression, zone, day the scan starts). */
const SCAN_CACHE_MAX_ENTRIES = 1_000;
const SCAN_CACHE_TTL_MS = DAY_MS;

/** Runs a scan walks before letting other work run. */
const SCAN_CHUNK_RUNS = 500;

const invalid = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'events_schedule_invalid' });

const busy = (): HttpError =>
    new HttpError(
        503,
        'Too many schedules are being checked right now; try again shortly',
        { legacyCode: 'events_schedule_busy' },
    );

/**
 * What every instance is built with. `timezone` is always set, `UTC` included,
 * and `domAndDow: false` is passed rather than left to croner's default.
 */
const cronOptions = (tz: string): CronOptions => ({
    timezone: tz,
    paused: true,
    mode: '5-part',
    domAndDow: false,
});

const cronKey = (pattern: string, tz: string): string => `${tz} ${pattern}`;

const crons = new BoundedTtlMap<string, Cron>({
    maxEntries: CRON_CACHE_MAX_ENTRIES,
    ttlMs: CRON_CACHE_TTL_MS,
});

/** The kept instance for an expression, or a new one that isn't kept. */
const cronFor = (pattern: string, tz: string): Cron =>
    crons.get(cronKey(pattern, tz)) ?? new Cron(pattern, cronOptions(tz));

/** Keep an instance for a schedule that exists, so its lookups reuse it. */
export const rememberCron = (pattern: string, tz: string): void => {
    const key = cronKey(pattern, tz);
    if (!crons.has(key)) crons.set(key, new Cron(pattern, cronOptions(tz)));
};

/**
 * The canonical IANA name for `value`, or `UTC` when it is absent. A UTC offset
 * such as `+01:00` is refused: it isn't a zone and has no DST rules.
 */
export const canonicalTimeZone = (value: unknown): string => {
    if (value === undefined || value === null) return 'UTC';
    if (typeof value !== 'string' || value.length === 0 || value.length > 64)
        throw invalid('tz must be an IANA time zone name');
    let resolved: string;
    try {
        resolved = new Intl.DateTimeFormat('en-US', {
            timeZone: value,
        }).resolvedOptions().timeZone;
    } catch {
        throw invalid(`Unknown time zone: ${value}`);
    }
    if (/^[+-]/.test(resolved))
        throw invalid('tz must be an IANA time zone name, not an offset');
    return resolved;
};

/**
 * Whether a 5-field expression uses only the standard grammar: numbers, `*`,
 * `,`, `-`, `/`, and three-letter month and day names in their fields. croner's
 * extensions (`L`, `W`, `#`, `?`, a `+` day-of-week) are refused; `+` would
 * switch the day fields to AND.
 */
const standardFields = (fields: string[]): boolean =>
    fields.every((field, i) => {
        let bare = field;
        if (i === 3) bare = bare.replace(MONTH_NAMES, '0');
        if (i === 4) bare = bare.replace(DAY_NAMES, '0');
        return FIELD_SYNTAX.test(bare);
    });

/**
 * A cron expression in the form it is stored: trimmed, single-spaced, and
 * checked to build.
 */
export const parseCron = (value: unknown, tz: string): string => {
    if (typeof value !== 'string') throw invalid('cron must be a string');
    const pattern = value.trim().replace(/\s+/g, ' ');
    if (pattern.length === 0) throw invalid('cron must not be empty');
    if (pattern.length > EVENTS_SCHEDULE_CRON_MAX_LENGTH)
        throw invalid(
            `cron may not exceed ${EVENTS_SCHEDULE_CRON_MAX_LENGTH} characters`,
        );
    if (pattern.startsWith('@')) {
        if (!CRON_NICKNAMES.includes(pattern.toLowerCase()))
            throw invalid(`Unknown cron nickname: ${pattern}`);
    } else {
        const fields = pattern.split(' ');
        if (fields.length !== 5)
            throw invalid('cron must have exactly 5 fields');
        if (!standardFields(fields))
            throw invalid(
                'cron may use only numbers, `*`, `,`, `-`, `/` and month and day names',
            );
    }
    try {
        cronFor(pattern, tz);
    } catch (err) {
        throw invalid(
            `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    return pattern;
};

const firstOf = (cron: Cron, t: number): number | null => {
    const from = Math.ceil(t / 1000) * 1000 - 1000;
    return cron.nextRun(new Date(from))?.getTime() ?? null;
};

const after = (cron: Cron, at: number): number | null =>
    cron.nextRun(new Date(at))?.getTime() ?? null;

/** First run at or after `t`. Runs fall on whole minutes. */
export const cronFirstAtOrAfter = (
    pattern: string,
    tz: string,
    t: number,
): number | null => firstOf(cronFor(pattern, tz), t);

/**
 * Latest run at or before `t`, looking back at most
 * {@link EVENTS_SCHEDULE_CRON_SCAN_MS}. croner finds the previous run in one
 * call rather than by stepping, so the window is the bound.
 */
export const cronLatestAtOrBefore = (
    pattern: string,
    tz: string,
    t: number,
): number | null => {
    const before = Math.floor(t / 1000) * 1000 + 1000;
    const [prev] = cronFor(pattern, tz).previousRuns(1, new Date(before));
    if (!prev) return null;
    const at = prev.getTime();
    return at < t - EVENTS_SCHEDULE_CRON_SCAN_MS ? null : at;
};

/** Runs `s` with `from <= s < to`, stopping at `cap`. */
export const cronCount = (
    pattern: string,
    tz: string,
    from: number,
    to: number,
    cap: number,
): { count: number; capped: boolean } => {
    const cron = cronFor(pattern, tz);
    let count = 0;
    let at = firstOf(cron, from);
    while (at !== null && at < to) {
        if (count >= cap) return { count, capped: true };
        count++;
        at = after(cron, at);
    }
    return { count, capped: false };
};

/** What a create needs to know about an expression's upcoming runs. */
export interface CronScan {
    /** First run at or after the scan start, or `null` if none in the scan. */
    first: number | null;
    /**
     * Smallest gap between consecutive runs seen, or `null` under two runs.
     * With `minIntervalMs`, the first gap under it, where the scan stopped.
     */
    minGapMs: number | null;
    /** Most runs seen in any one-hour window. */
    peakPerHour: number;
    /** The `nth` run, if one was asked for and the scan reached it. */
    nth: number | null;
}

interface ScanStats {
    empty: boolean;
    minGapMs: number | null;
    peakPerHour: number;
}

const scans = new BoundedTtlMap<string, ScanStats>({
    maxEntries: SCAN_CACHE_MAX_ENTRIES,
    ttlMs: SCAN_CACHE_TTL_MS,
});

let scanHold: Promise<void> | null = null;

/** Tests only: scans that hold a gate slot wait until the returned release. */
export const holdCronScans = (): (() => void) => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    scanHold = hold;
    return () => {
        if (scanHold === hold) scanHold = null;
        release();
    };
};

/** At most a few scans at once, a short queue behind them, `busy` past it. */
const scanGate = (() => {
    let running = 0;
    const waiting: Array<() => void> = [];
    return async <T>(work: () => Promise<T>): Promise<T> => {
        if (running < EVENTS_SCHEDULE_SCAN_CONCURRENCY) running++;
        else if (waiting.length >= EVENTS_SCHEDULE_SCAN_QUEUE) throw busy();
        else await new Promise<void>((resolve) => waiting.push(resolve));
        try {
            if (scanHold) await scanHold;
            return await work();
        } finally {
            // A waiter takes the slot over rather than releasing it.
            const next = waiting.shift();
            if (next) next();
            else running--;
        }
    };
})();

const yieldTurn = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

/**
 * Walk the runs from `from`, up to {@link EVENTS_SCHEDULE_CRON_SCAN_RUNS} runs
 * or {@link EVENTS_SCHEDULE_CRON_SCAN_MS}, whichever ends first.
 *
 * Stops early once the gap and peak are at what 5 fields allow and `nth` (if
 * asked) is found, or at the first gap under `minIntervalMs`. A complete scan's
 * gap and peak are kept for the day it started on, so a scan with no `nth`
 * usually walks nothing. Scans run behind a per-process gate and yield between
 * chunks.
 */
export const scanCron = async (
    pattern: string,
    tz: string,
    from: number,
    opts: { nth?: number; minIntervalMs?: number } = {},
): Promise<CronScan> => {
    const key = `${cronKey(pattern, tz)} ${Math.floor(from / DAY_MS)}`;
    const cached = opts.nth === undefined ? scans.get(key) : undefined;
    if (cached)
        return {
            first: cached.empty ? null : cronFirstAtOrAfter(pattern, tz, from),
            minGapMs: cached.minGapMs,
            peakPerHour: cached.peakPerHour,
            nth: null,
        };
    return scanGate(async () => {
        const { result, complete } = await walk(pattern, tz, from, opts);
        if (complete)
            scans.set(key, {
                empty: result.first === null,
                minGapMs: result.minGapMs,
                peakPerHour: result.peakPerHour,
            });
        return result;
    });
};

const walk = async (
    pattern: string,
    tz: string,
    from: number,
    opts: { nth?: number; minIntervalMs?: number },
): Promise<{ result: CronScan; complete: boolean }> => {
    const cron = cronFor(pattern, tz);
    const first = firstOf(cron, from);
    const result: CronScan = {
        first,
        minGapMs: null,
        peakPerHour: 0,
        nth: null,
    };
    if (first === null) return { result, complete: true };

    const until = from + EVENTS_SCHEDULE_CRON_SCAN_MS;
    const window: number[] = [];
    let prev: number | null = null;
    let at: number | null = first;
    for (let i = 1; at !== null && at <= until; i++) {
        if (prev !== null) {
            const gap = at - prev;
            if (result.minGapMs === null || gap < result.minGapMs)
                result.minGapMs = gap;
            if (opts.minIntervalMs !== undefined && gap < opts.minIntervalMs)
                return { result, complete: false };
        }
        window.push(at);
        while (window[0] <= at - HOUR_MS) window.shift();
        if (window.length > result.peakPerHour)
            result.peakPerHour = window.length;
        if (opts.nth === i) result.nth = at;

        const saturated =
            result.minGapMs === MINUTE_MS &&
            result.peakPerHour >= MAX_RUNS_PER_HOUR &&
            (opts.nth === undefined || result.nth !== null);
        if (saturated || i >= EVENTS_SCHEDULE_CRON_SCAN_RUNS) break;
        if (i % SCAN_CHUNK_RUNS === 0) await yieldTurn();

        prev = at;
        at = after(cron, at);
    }
    return { result, complete: true };
};
