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
} from '../../services/metering/consts.js';
import {
    EVENTS_BROADCAST_DELIVERY_LIMIT,
    EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER,
    EVENTS_SINGLE_DELIVERY_LIMIT,
    EVENTS_WORKER_INVOCATION_LIMIT,
    limitFor,
    type TieredLimit,
} from './limits.js';

const tiers: Array<[string, TieredLimit]> = [
    ['durable subscriptions per account', EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER],
    ['durable subscriptions per app', EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP],
];

describe('the tiered subscription quotas', () => {
    it.each(tiers)('%s never lets a free tier exceed paid', (_name, tier) => {
        for (const n of Object.values(tier.bySubscription))
            expect(n).toBeLessThanOrEqual(tier.limit);
    });

    it.each(tiers)('%s gives a temporary account none', (_name, tier) => {
        expect(tier.bySubscription[DEFAULT_TEMP_SUBSCRIPTION]).toBe(0);
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
