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
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';

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

/**
 * A cap that varies by plan, in the shape route gates already declare theirs
 * in: the base is what a subscribed account sees, and `bySubscription` carves
 * the free tiers out beneath it. A plan nobody enumerated falls through to the
 * base, so a new one is generous rather than accidentally throttled.
 */
export interface TieredLimit {
    limit: number;
    bySubscription: Record<string, number>;
}

const tiered = (paid: number, free: number, temp: number): TieredLimit => ({
    limit: paid,
    bySubscription: {
        [DEFAULT_FREE_SUBSCRIPTION]: free,
        [DEFAULT_TEMP_SUBSCRIPTION]: temp,
    },
});

/** The cap one plan sees. An unresolved plan is held to the base. */
export const limitFor = (
    tier: TieredLimit,
    subscriptionId: string | null,
): number =>
    (subscriptionId === null
        ? undefined
        : tier.bySubscription[subscriptionId]) ?? tier.limit;

/** The two counts a durable subscribe is held to, already resolved by plan. */
export interface SubscriptionQuota {
    perUser: number;
    perApp: number;
}

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
 * region that sees a write. Counted over the holder index. A temporary account
 * holds none: nothing outlives its connection to deliver to.
 */
export const EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER = tiered(500, 100, 0);

/**
 * Durable subscriptions one app may hold for one account.
 *
 * Below the per-account cap so that one app cannot spend an account's whole
 * budget: the account-wide number is what the watched-token set costs, and this
 * is what any single app may take of it.
 */
export const EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP = tiered(100, 25, 0);

/** Most rows any account can hold, whatever its plan — a read bound, not a gate. */
export const EVENTS_DURABLE_SUBSCRIPTIONS_MAX =
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER.limit;

/**
 * How long a suspended durable subscription is kept before it is deleted.
 *
 * A suspension caused by a revoked grant never resumes — consent to watch is
 * re-established by subscribing again — so the row survives only long enough
 * for its holder to see, in `list`, that it stopped and why.
 */
export const SUSPENDED_ROW_TTL_DAYS = 30;

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

/**
 * Delivery acknowledgements per minute, per user.
 *
 * One ack per `single` delivery, so this sits level with what one subscription
 * may be delivered — a client acking faster than that is acking things it was
 * never sent.
 */
export const EVENTS_ACK_LIMIT = userWindow('events:ack', 600);

/**
 * Share-handle mint + revoke calls per minute, per user.
 *
 * Each one issues or withdraws a grant and settles what stood on it, so it is
 * budgeted with the subscribe verbs rather than the listings.
 */
export const EVENTS_KV_HANDLE_LIMIT = userWindow('events:kvHandles', 60);

/**
 * Live share handles one account may hold out at a time. Each is a standing
 * grant on part of the account's data, and revoking marks rather than deletes,
 * so without a ceiling the rate limit alone lets the rows grow forever.
 */
export const EVENTS_KV_HANDLES_PER_USER = 200;

// -- Handler surface -------------------------------------------------

/**
 * Named handlers one app may have published.
 *
 * A handler is a row read on the delivery path, so the cap is on how many
 * distinct pieces of code an app asks the system to keep addressable — not on
 * how often it changes them. An app past this is describing events by name
 * where a `match` filter belongs.
 */
export const EVENTS_HANDLERS_PER_APP = 100;

/** Longest a serialized handler may be. */
export const EVENTS_HANDLER_SOURCE_MAX_BYTES = 64 * 1024;

/**
 * Longest an app's generated events worker may be, all handlers combined. Above
 * this a publish is refused with `events_worker_too_large` before it lands, and
 * a set that got here some other way fails its deploy instead of shipping a
 * script too big for the runtime to load.
 */
export const EVENTS_WORKER_SOURCE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Deploys one app's events worker may trigger per hour.
 *
 * A deploy provisions upstream, so a set that flaps — publish, remove,
 * republish — must not turn into an unbounded provisioning loop. Rehydration (a
 * namespace miss) counts the same as a publish-triggered deploy.
 */
export const EVENTS_WORKER_DEPLOYS_PER_HOUR = 30;

/**
 * Handlers one `publishAll` may carry. A build step publishes its whole set in
 * one call, and the set is capped by what an app may hold anyway.
 */
export const EVENTS_HANDLER_PUBLISH_BATCH = 50;

/**
 * Handler publishes and removals per minute, per user.
 *
 * A build step publishes its whole set in one call and a developer iterating
 * publishes a handful; level with the subscribe budget, which is the closest
 * analogue — a write a client makes deliberately, never in a loop.
 */
export const EVENTS_HANDLER_PUBLISH_LIMIT = userWindow(
    'events:handlers:publish',
    60,
);

/**
 * Missed-event fetches per minute, per user.
 *
 * A keyset page off one index, so it is budgeted like the other listings — a
 * client catching up after a disconnect walks a handful of pages once, not a
 * page per event.
 */
export const EVENTS_FETCH_LIMIT = userWindow('events:fetch', 120);

/** Rows one fetch page may carry. Defaults to a quarter of it. */
export const EVENTS_FETCH_LIMIT_CAP = 200;
export const EVENTS_FETCH_LIMIT_DEFAULT = 50;

/** Handler listings per minute, per user. Reads an index, so budgeted higher. */
export const EVENTS_HANDLER_LIST_LIMIT = userWindow(
    'events:handlers:list',
    120,
);

/**
 * Events worker listings per minute, per user. Same shape as the handler
 * listing.
 */
export const EVENTS_WORKER_LIST_LIMIT = userWindow('events:workers:list', 120);

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
 * `single` deliveries per minute, per subscription.
 *
 * A fifth of the broadcast budget: each one is leased, acknowledged and may run
 * an app's handler, so it costs an order of magnitude more than a socket copy.
 * Over it the event is not queued — a gap marker takes its place, so the
 * consumer learns it fell behind instead of inheriting a backlog it can never
 * work through.
 */
export const EVENTS_SINGLE_DELIVERY_LIMIT = userWindow(
    'events:delivery:single',
    120,
);

/**
 * Handler invocations per minute, per (account, app).
 *
 * The one term of the fan-out product that costs real compute, so it is capped
 * per app rather than per subscription — an app cannot widen it by holding more
 * subscriptions. A delivery that arrives over the budget is not failed: it
 * stays owed, and its lease is the backoff.
 */
export const EVENTS_WORKER_INVOCATION_LIMIT = userWindow(
    'events:worker:invoke',
    60,
);

/**
 * Filter evaluations one event may spend. Lives with the matcher because the
 * primitive that enforces it does; re-exported here so every published number
 * is readable in one place.
 */
export { FILTER_EVALUATIONS_PER_EVENT } from '../../services/events/matcher.js';

// -- Undelivered backlog ---------------------------------------------

/**
 * Deliveries one subscription may hold undelivered.
 *
 * A `single` delivery waits until something takes it, so a subscription whose
 * consumer is gone accumulates. Over the cap the oldest go and one gap marker
 * takes their place, which is what keeps "at-least-once" honest: what was lost
 * is visible rather than silent.
 */
export const EVENTS_PENDING_DELIVERIES_PER_SUBSCRIPTION = 10_000;

/**
 * Undelivered deliveries one region may hold across every subscription.
 *
 * The per-subscription cap bounds one backlog and nothing in aggregate —
 * multiply it by the subscriptions that can exist and the region's memory is
 * the only remaining limit. Over this, the oldest deliveries in the region are
 * shed first, each shedding subscription gets a gap marker, and an alarm says
 * it happened.
 */
export const EVENTS_REGION_PENDING_CEILING = 1_000_000;

// -- Handler retries -------------------------------------------------
//
// A handler that answers "not now" — a 5xx, a timeout, a 429 — is retried, and
// a handler that answers "no" is not. Retrying on a fixed cadence turns one
// broken deploy into a permanent load on whatever is failing, so the wait
// doubles per attempt up to a ceiling, and a run of failures stops the
// subscription rather than retrying it forever.

/** Wait before the first retry of a delivery a handler could not take. */
export const EVENTS_RETRY_BASE_MS = 2_000;

/** Longest wait between retries, however many have failed. */
export const EVENTS_RETRY_MAX_MS = 5 * 60 * 1000;

/**
 * Failures in a row before a subscription is suspended. Counted per
 * subscription and reset by the first delivery a handler takes, so an
 * occasional failure never accumulates into one.
 */
export const EVENTS_CONSECUTIVE_FAILURES = 5;

/**
 * How long a run of failures is remembered. Five failures at the capped wait
 * span well under this, so a counter nothing has touched for an hour describes
 * a run that ended.
 */
export const EVENTS_FAILURE_COUNTER_TTL_MS = 60 * 60 * 1000;

/** How long to hold a delivery whose handler has failed `attempts` times. */
export const deliveryBackoffMs = (attempts: number): number =>
    Math.min(
        EVENTS_RETRY_MAX_MS,
        EVENTS_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
    );

// -- Suspended backlog -----------------------------------------------
//
// A suspended subscription stops metering but keeps what it is owed, and that
// pair is a free memory hold: removing one widely-subscribed handler would
// otherwise turn every dependent into a full backlog nobody pays for. So a
// suspension trims to a much smaller cap and stamps an expiry, and the pending
// sweeper drops what is left over with a gap marker in its place.

/** Deliveries a suspended subscription may keep, whatever the reason. */
export const EVENTS_SUSPENDED_PENDING_CAP = 100;

/**
 * How long a backlog held for a handler that may come back is kept. A bad
 * deploy is recoverable within a day; past that the events are stale anyway.
 */
export const EVENTS_SUSPENDED_BACKLOG_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a backlog held for an account out of credit is kept. The resume
 * condition is a top-up, which is usually minutes.
 */
export const EVENTS_NO_CREDIT_BACKLOG_TTL_MS = 60 * 60 * 1000;

// -- Coalescing ------------------------------------------------------

/**
 * Debounce window per (subscription, subject). A multipart upload or a
 * recursive delete is one intent that lands as many writes; this is what makes
 * it arrive as one event.
 */
export const EVENTS_COALESCE_WINDOW_MS = 250;
