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

import * as limits from './limits.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import type { RouteOptions, RouteRateLimit } from '../../core/http/types';

type Spec = RouteRateLimit | NonNullable<RouteOptions['concurrent']>;

const all = Object.entries(limits) as Array<[string, Spec | RouteRateLimit[]]>;
const flat: Array<[string, Spec]> = all.flatMap(([name, value]) =>
    Array.isArray(value)
        ? value.map((v, i): [string, Spec] => [`${name}[${i}]`, v])
        : [[name, value] as [string, Spec]],
);

const windows = flat.filter(([, s]) => 'window' in s) as Array<
    [string, RouteRateLimit]
>;
const concurrents = flat.filter(([, s]) => !('window' in s));

describe('filesystem limit specs', () => {
    // The whole point of this module is that the legacy and v2 controllers
    // import the same specs. That only ties the counters together if every
    // spec carries an explicit scope — without one the gate falls back to
    // the route path, and the two controllers get separate budgets.
    it.each(flat)('%s pins an explicit scope', (_name, spec) => {
        expect(spec.scope).toBeTruthy();
    });

    it.each(windows)('%s has a positive limit and window', (_name, spec) => {
        expect(spec.limit).toBeGreaterThan(0);
        expect(spec.window).toBeGreaterThan(0);
    });

    // Base is the paid value; the free tiers are carved out beneath it.
    // A free tier above the base would mean paying made you worse off.
    it.each(windows)('%s never lets a free tier exceed paid', (_name, spec) => {
        for (const n of Object.values(spec.bySubscription ?? {})) {
            expect(n).toBeLessThanOrEqual(spec.limit);
        }
    });

    it.each(windows)(
        '%s caps temp at or below registered-free',
        (_name, spec) => {
            const free = spec.bySubscription?.[DEFAULT_FREE_SUBSCRIPTION];
            const temp = spec.bySubscription?.[DEFAULT_TEMP_SUBSCRIPTION];
            if (free === undefined || temp === undefined) return;
            expect(temp).toBeLessThanOrEqual(free);
        },
    );

    // A single in-flight slot turns incidental client parallelism into a
    // spurious 429; paid tiers keep room to actually parallelise.
    it.each(concurrents)(
        '%s keeps concurrency at 5+ paid and 2+ for every tier',
        (_name, spec) => {
            expect(spec.limit).toBeGreaterThanOrEqual(5);
            for (const n of Object.values(spec.bySubscription ?? {})) {
                expect(n).toBeGreaterThanOrEqual(2);
            }
        },
    );

    it('gives search the tightest window of the read paths', () => {
        expect(limits.FS_SEARCH_LIMIT.limit).toBeLessThan(
            limits.FS_STAT_LIMIT.limit,
        );
        expect(limits.FS_SEARCH_LIMIT.limit).toBeLessThan(
            limits.FS_READ_LIMIT.limit,
        );
    });

    // The desktop deletes/moves one item per request with no batching and no
    // pacing, so a single "empty trash" or "select all, delete" has to fit
    // inside the minute window on every tier. The hour window is the abuse
    // ceiling that a minute window this wide can no longer be.
    it('gives mutations a bulk-sized minute window plus an hourly backstop', () => {
        const [minute, hourly] = limits.FS_MUTATE_LIMIT;
        expect(limits.FS_MUTATE_LIMIT).toHaveLength(2);
        expect(minute.window).toBe(60_000);
        expect(hourly.window).toBe(60 * 60_000);

        const tiers = (spec: RouteRateLimit) => [
            spec.limit,
            spec.bySubscription![DEFAULT_FREE_SUBSCRIPTION],
            spec.bySubscription![DEFAULT_TEMP_SUBSCRIPTION],
        ];

        // A few hundred items clears in one pass, anonymous included.
        for (const n of tiers(minute)) expect(n).toBeGreaterThanOrEqual(500);
        // Anonymous stays meaningfully tighter than paid on both windows.
        expect(tiers(minute)[2]).toBeLessThanOrEqual(minute.limit / 2);
        expect(tiers(hourly)[2]).toBeLessThanOrEqual(hourly.limit / 2);

        // The hour window has to bind rather than decorate: it allows a
        // handful of bulk passes an hour, not sixty minutes' worth.
        for (const [perMinute, perHour] of tiers(minute).map(
            (n, i): [number, number] => [n, tiers(hourly)[i]],
        )) {
            expect(perHour).toBeGreaterThan(perMinute);
            expect(perHour).toBeLessThanOrEqual(perMinute * 10);
        }
    });

    // The DAV gate is consumed imperatively, before the request has an actor:
    // it keys on the network fingerprint and reads only `limit` / `window`. A
    // `key: 'user'` or a `bySubscription` map here would describe tiering that
    // never happens.
    it('shapes the DAV specs the way the DAV gate consumes them', () => {
        expect(limits.DAV_LIMIT.key).toBe('fingerprint');
        expect(limits.DAV_CONCURRENT.key).toBe('fingerprint');
        expect(limits.DAV_LIMIT.bySubscription).toBeUndefined();
        expect(limits.DAV_CONCURRENT.bySubscription).toBeUndefined();
    });

    // With no session to key on, the alternative is the bare address — and an
    // address is a household, an office or a carrier gateway, so keying there
    // makes one bucket serve everyone behind it and tighten as more real users
    // arrive. The fingerprint separates clients within a network while still
    // being something one client can't vary per request.
    it('keys the signed-URL routes on the network fingerprint', () => {
        expect(limits.FS_SIGNED_READ_LIMIT.key).toBe('fingerprint');
        expect(limits.FS_SIGNED_WRITE_LIMIT.key).toBe('fingerprint');
        expect(limits.FS_SIGNED_CONCURRENT.key).toBe('fingerprint');
    });

    // These serve page subresources — a gallery, an app's own assets — so the
    // in-flight cap has to sit above what a browser opens to one origin at
    // once, or a normal page load is what trips it.
    it('leaves the signed-URL in-flight cap above a browser`s own parallelism', () => {
        expect(limits.FS_SIGNED_CONCURRENT.limit).toBeGreaterThan(30);
    });

    it('uses distinct scopes so counters cannot collide', () => {
        const scopes = flat
            .filter(([, s]) => 'window' in s)
            .map(([, s]) => s.scope);
        expect(new Set(scopes).size).toBe(scopes.length);
    });
});
