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

import type { DeliveryClass } from './registry.js';

// Microcents per delivered event. Cost is `EVENTS_COSTS[usageType] * units`.
//
// Rated per delivery class rather than blended: a `single` is leased, acked and
// queued where a broadcast copy is a socket write. The handler run itself is
// the worker's to meter, and a subscription that sits idle costs nothing —
// quotas, not a standing charge, bound how many an account may hold.
export const EVENTS_COSTS = {
    'events:delivery:broadcast': 10,
    'events:delivery:single': 100,
} as const;

export type EventsUsageType = keyof typeof EVENTS_COSTS;

export const DELIVERY_USAGE_TYPES: Record<DeliveryClass, EventsUsageType> = {
    broadcast: 'events:delivery:broadcast',
    single: 'events:delivery:single',
};

/** What one line of each type is counted in, for the published rate table. */
export const EVENTS_COST_UNITS: Record<EventsUsageType, string> = {
    'events:delivery:broadcast': 'delivery',
    'events:delivery:single': 'delivery',
};
