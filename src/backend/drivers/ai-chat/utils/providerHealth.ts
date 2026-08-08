/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

/**
 * Short-lived memory of which (provider, model) routes are currently failing,
 * so requests skip past a route that just broke instead of paying its timeout
 * again on every call.
 *
 * Deliberately process-local and short-lived: it is a latency optimisation, not
 * a circuit breaker. Nothing is ever hard-blocked — routing only _prefers_
 * healthy routes, and an entry expires on its own without any probe or reset
 * path to get wrong.
 */

import { kv } from '../../../util/kvSingleton.js';

/** How long a route stays marked after a route-level failure. */
export const UNHEALTHY_TTL_SEC = 10 * 60;

const routeKey = (provider: string, modelId: string) =>
    `aiChat:unhealthyRoute:${provider}:${modelId}`;

/**
 * Mark `modelId` as currently unserveable by `provider`.
 *
 * Only for failures that say something about the route itself — upstream 5xx,
 * rate limits, bad credentials, transport errors. A request the upstream
 * refused on its merits (a 400, an oversized prompt) says nothing about whether
 * the next caller will be served, and must not mark anything.
 */
export const markRouteUnhealthy = (provider: string, modelId: string): void => {
    kv.set(routeKey(provider, modelId), 1, { EX: UNHEALTHY_TTL_SEC });
};

export const isRouteUnhealthy = (provider: string, modelId: string): boolean =>
    kv.get(routeKey(provider, modelId)) !== undefined;

/** Test seam — drops every mark. */
export const clearUnhealthyRoutes = (): void => {
    for (const key of kv.keys('aiChat:unhealthyRoute:*')) {
        kv.del(key);
    }
};
