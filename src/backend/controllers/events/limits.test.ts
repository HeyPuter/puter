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

/**
 * The event limits, and the page that publishes them. An undisclosed limit is
 * one a developer meets as a service failure, so the numbers here and the
 * numbers on the page are held against each other.
 */

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
    ORG_SEAT_FREE_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import {
    EVENTS_BROADCAST_DELIVERY_LIMIT,
    EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER,
    EVENTS_KV_HANDLES_PER_APP,
    EVENTS_KV_HANDLES_PER_USER,
    EVENTS_KV_FILTER_EVALUATIONS_PER_EVENT,
    EVENTS_KV_MATCHED_SUBSCRIPTIONS_PER_EVENT,
    EVENTS_SINGLE_DELIVERY_LIMIT,
    EVENTS_WORKER_INVOCATION_LIMIT,
    limitFor,
    type TieredLimit,
} from './limits.js';

const tiers: Array<[string, TieredLimit]> = [
    ['durable subscriptions per account', EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER],
    ['durable subscriptions per app', EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP],
    ['live share handles per account', EVENTS_KV_HANDLES_PER_USER],
    ['live share handles per app', EVENTS_KV_HANDLES_PER_APP],
];

describe('the tiered subscription quotas', () => {
    it.each(tiers)('%s never lets a free tier exceed paid', (_name, tier) => {
        for (const n of Object.values(tier.bySubscription))
            expect(n).toBeLessThanOrEqual(tier.limit);
    });

    it.each(tiers)('%s gives a temporary account none', (_name, tier) => {
        expect(tier.bySubscription[DEFAULT_TEMP_SUBSCRIPTION]).toBe(0);
    });

    it('holds a free plan nobody enumerated to the free cap, not the paid one', () => {
        // A team seat resolves to `org_seat_free`, which no tier names. Falling
        // through to `limit` would give it more than an ordinary free account.
        for (const tier of tiers.map(([, t]) => t)) {
            expect(limitFor(tier, ORG_SEAT_FREE_SUBSCRIPTION)).toBe(
                tier.bySubscription[DEFAULT_FREE_SUBSCRIPTION],
            );
        }
    });

    it('still holds an unresolved or paid plan to the base', () => {
        for (const tier of tiers.map(([, t]) => t)) {
            expect(limitFor(tier, null)).toBe(tier.limit);
            expect(limitFor(tier, 'some-paid-tier')).toBe(tier.limit);
        }
    });

    it('keeps what one app may take below what the account may hold', () => {
        for (const plan of [
            null,
            DEFAULT_FREE_SUBSCRIPTION,
            DEFAULT_TEMP_SUBSCRIPTION,
        ]) {
            expect(
                limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP, plan),
            ).toBeLessThanOrEqual(
                limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER, plan),
            );
        }
    });

    it('keeps what one app may hold below what the account may hold, for share handles', () => {
        for (const plan of [
            null,
            DEFAULT_FREE_SUBSCRIPTION,
            DEFAULT_TEMP_SUBSCRIPTION,
        ]) {
            expect(
                limitFor(EVENTS_KV_HANDLES_PER_APP, plan),
            ).toBeLessThanOrEqual(limitFor(EVENTS_KV_HANDLES_PER_USER, plan));
        }
    });

    it('holds an unrecognised plan to the paid base', () => {
        expect(limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER, 'some_plan')).toBe(
            EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER.limit,
        );
        expect(limitFor(EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER, null)).toBe(
            EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER.limit,
        );
    });

    it('reads its structural maximum off the paid cap', () => {
        expect(EVENTS_DURABLE_SUBSCRIPTIONS_MAX).toBe(
            EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER.limit,
        );
    });
});

describe('the delivery budgets', () => {
    it('sets KV fan-out and filter work by the namespace owner tier', () => {
        for (const [plan, matched, evaluated] of [
            [null, 512, 2048],
            [DEFAULT_FREE_SUBSCRIPTION, 128, 512],
            [DEFAULT_TEMP_SUBSCRIPTION, 128, 512],
            [ORG_SEAT_FREE_SUBSCRIPTION, 128, 512],
        ] as const) {
            expect(
                limitFor(EVENTS_KV_MATCHED_SUBSCRIPTIONS_PER_EVENT, plan),
            ).toBe(matched);
            expect(
                limitFor(EVENTS_KV_FILTER_EVALUATIONS_PER_EVENT, plan),
            ).toBe(evaluated);
            expect(evaluated).toBeGreaterThanOrEqual(matched);
        }
    });

    it('pins the share-handle quotas by plan', () => {
        expect(EVENTS_KV_HANDLES_PER_USER.limit).toBe(512);
        expect(EVENTS_KV_HANDLES_PER_APP.limit).toBe(512);
        expect(
            limitFor(EVENTS_KV_HANDLES_PER_USER, DEFAULT_FREE_SUBSCRIPTION),
        ).toBe(200);
        expect(
            limitFor(EVENTS_KV_HANDLES_PER_APP, DEFAULT_FREE_SUBSCRIPTION),
        ).toBe(128);
    });

    it('keeps `single` well under broadcast — each one costs far more', () => {
        expect(EVENTS_SINGLE_DELIVERY_LIMIT.limit).toBeLessThan(
            EVENTS_BROADCAST_DELIVERY_LIMIT.limit,
        );
        expect(EVENTS_WORKER_INVOCATION_LIMIT.limit).toBeLessThan(
            EVENTS_SINGLE_DELIVERY_LIMIT.limit,
        );
    });

    it('pins an explicit scope on each, so two call sites share one counter', () => {
        for (const spec of [
            EVENTS_BROADCAST_DELIVERY_LIMIT,
            EVENTS_SINGLE_DELIVERY_LIMIT,
            EVENTS_WORKER_INVOCATION_LIMIT,
        ]) {
            expect(spec.scope).toBeTruthy();
            expect(spec.window).toBe(60_000);
        }
    });
});
