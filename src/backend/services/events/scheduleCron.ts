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
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import { BoundedTtlMap } from '../../util/boundedTtlMap.js';

/**
 * Cron expressions for schedules: parsing, validation and walking runs in a
 * time zone. Every expression is 5 fields or a nickname, read in an IANA zone,
 * with day-of-month and day-of-week combined by OR as in Vixie cron.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

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

/** Instances kept, by (expression, zone). Paused instances hold no timer. */
const CRON_CACHE_MAX_ENTRIES = 10_000;

const invalid = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'events_schedule_invalid' });

/**
 * What every instance is built with. `timezone` is always set, `UTC` included,
 * and `domAndDow: false` is passed rather than left to croner's default.
 */
export const cronOptions = (tz: string): CronOptions => ({
    timezone: tz,
    paused: true,
    mode: '5-part',
    domAndDow: false,
});

const cache = new BoundedTtlMap<string, Cron>({
    maxEntries: CRON_CACHE_MAX_ENTRIES,
});

/** A built instance for a validated expression and zone. */
export const cronFor = (pattern: string, tz: string): Cron => {
    const key = `${tz} ${pattern}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const built = new Cron(pattern, cronOptions(tz));
    cache.set(key, built);
    return built;
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
 * A cron expression in the form it is stored: trimmed, single-spaced, and
 * checked to build. Refuses a seconds or year field (croner would read either),
 * and `?`, which croner fills in from the time the expression is parsed.
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
    } else if (pattern.split(' ').length !== 5) {
        throw invalid('cron must have exactly 5 fields');
    }
    if (pattern.includes('?')) throw invalid('cron may not use `?`');
    try {
        cronFor(pattern, tz);
    } catch (err) {
        throw invalid(
            `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    return pattern;
};

/** First run at or after `t`. Runs fall on whole minutes. */
export const cronFirstAtOrAfter = (
    pattern: string,
    tz: string,
    t: number,
): number | null => {
    const from = Math.ceil(t / 1000) * 1000 - 1000;
    const next = cronFor(pattern, tz).nextRun(new Date(from));
    return next ? next.getTime() : null;
};

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
    let count = 0;
    let at = cronFirstAtOrAfter(pattern, tz, from);
    const cron = cronFor(pattern, tz);
    while (at !== null && at < to) {
        if (count >= cap) return { count, capped: true };
        count++;
        at = cron.nextRun(new Date(at))?.getTime() ?? null;
    }
    return { count, capped: false };
};

/** What a create needs to know about an expression's upcoming runs. */
export interface CronScan {
    /** First run at or after the scan start, or `null` if none in the scan. */
    first: number | null;
    /** Smallest gap between consecutive runs seen, or `null` under two runs. */
    minGapMs: number | null;
    /** Most runs seen in any one-hour window. */
    peakPerHour: number;
    /** The `nth` run, if one was asked for and the scan reached it. */
    nth: number | null;
}

/**
 * Walk the runs from `from`, up to {@link EVENTS_SCHEDULE_CRON_SCAN_RUNS} runs
 * or {@link EVENTS_SCHEDULE_CRON_SCAN_MS}, whichever ends first. Stops early
 * once the gap and peak are at what 5 fields allow and `nth` (if asked) is
 * found: nothing later can change the answer.
 */
export const scanCron = (
    pattern: string,
    tz: string,
    from: number,
    opts: { nth?: number } = {},
): CronScan => {
    const cron = cronFor(pattern, tz);
    const first = cronFirstAtOrAfter(pattern, tz, from);
    const result: CronScan = {
        first,
        minGapMs: null,
        peakPerHour: 0,
        nth: null,
    };
    if (first === null) return result;

    const until = from + EVENTS_SCHEDULE_CRON_SCAN_MS;
    const window: number[] = [];
    let prev: number | null = null;
    let at: number | null = first;
    for (let i = 1; at !== null && at <= until; i++) {
        if (prev !== null) {
            const gap = at - prev;
            if (result.minGapMs === null || gap < result.minGapMs)
                result.minGapMs = gap;
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

        prev = at;
        at = cron.nextRun(new Date(at))?.getTime() ?? null;
    }
    return result;
};
