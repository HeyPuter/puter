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

import type { RouteRateLimit } from '../../core/http/types';

// -- Shared event limits ---------------------------------------------
//
// One cheap write can fan out into (matched subscriptions × connected
// sockets), and every number here caps a term of that product. Storage quota
// and the FS write limits bound how many events can be *produced*; nothing
// else bounds how many deliveries one of them turns into.
//
// The verbs arrive over the socket rather than over HTTP, so these are not
// mounted as route gates — they are spent imperatively at the point each one
// protects, with the `scope` naming the counter the same way a route gate
// would. Every number below is published in `rate-limits-and-quotas.md`.

/** Per-user sliding window, spent imperatively via `checkRateLimit`. */
const userWindow = (
    scope: string,
    limit: number,
    window = 60_000,
): RouteRateLimit => ({ scope, limit, window, key: 'user' });

// -- Subscription surface --------------------------------------------

/**
 * Live subscriptions one socket may hold.
 *
 * Session subscriptions are Redis set members keyed to a socket that can go
 * away without saying so, so the cap is really on how much a disconnect can
 * leave behind. A client watching more than a few dozen distinct anchors wants
 * one subscription on their common parent instead.
 */
export const EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET = 50;

/**
 * Durable subscriptions one account may hold, across every app.
 *
 * These are table rows that keep costing after the client that made them is
 * gone — a delivery each time their anchor changes, and a cache entry in every
 * region that sees a write. Counted over the holder index. Per-plan tiering
 * arrives with the metering that prices them.
 */
export const EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER = 500;

/**
 * Subscribe + unsubscribe calls per minute, per user.
 *
 * Both resolve a path and take a write, so a loop over them is a write loop.
 * Sized like the sharing verbs, which are the closest existing analogue: a
 * client sets its subscriptions up once and then leaves them alone.
 */
export const EVENTS_SUBSCRIBE_LIMIT = userWindow('events:subscribe', 60);

/**
 * Subscription listings per minute, per user. Reads an index and returns one
 * page, so it is budgeted well above the verbs that write.
 */
export const EVENTS_LIST_LIMIT = userWindow('events:list', 120);

// -- Dispatch fan-out ------------------------------------------------

/**
 * Subscriptions one event may deliver to before dispatch stops and reports a
 * gap. The amplification ceiling: without it, one write costs as many
 * deliveries as an account cared to register.
 */
export const EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT = 50;

/**
 * Broadcast deliveries per minute, per subscription.
 *
 * Ten a second sustained is far past what a UI can render and well past what a
 * human is watching for; a subscription over it is looping, and the gap marker
 * tells it so rather than letting it silently miss events.
 */
export const EVENTS_BROADCAST_DELIVERY_LIMIT = userWindow(
    'events:delivery',
    600,
);

/**
 * Filter evaluations one event may spend. Lives with the matcher because the
 * primitive that enforces it does; re-exported here so every published number
 * is readable in one place.
 */
export { FILTER_EVALUATIONS_PER_EVENT } from '../../services/events/matcher.js';

// -- Coalescing ------------------------------------------------------

/**
 * Debounce window per (subscription, subject). A multipart upload or a
 * recursive delete is one intent that lands as many writes; this is what makes
 * it arrive as one event.
 */
export const EVENTS_COALESCE_WINDOW_MS = 250;
