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
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import type { RouteOptions, RouteRateLimit } from '../../core/http/types';

// -- Shared filesystem limits ----------------------------------------
//
// The v2 controller and the legacy controller expose the same operations
// on separate route tables. Both import the specs below so a caller can't
// get two budgets for one operation by switching endpoints — the `scope`
// is what ties the counters together, and it only works if both sides
// pass the same one.
//
// The base `limit` is what subscribed tiers see; `bySubscription` carves
// out the free tiers beneath it. Any plan id not enumerated (a Stripe
// plan, the dev-only `unlimited`) falls through to the base, so new plans
// are generous by default rather than accidentally throttled.
//
// Storage quota already bounds total bytes, and egress and object-store
// requests are metered. These bound request *count*, which neither does:
// metadata reads cost database time while costing the caller almost
// nothing, and metering settles seconds behind the traffic, so a limit is
// what actually stops a runaway loop in the moment.

/** Per-user sliding window. Free tiers are carved out of the paid base. */
const userWindow = (
    scope: string,
    paid: number,
    free: number,
    temp: number,
    window = 60_000,
): RouteRateLimit => ({
    scope,
    limit: paid,
    window,
    key: 'user',
    bySubscription: {
        [DEFAULT_FREE_SUBSCRIPTION]: free,
        [DEFAULT_TEMP_SUBSCRIPTION]: temp,
    },
});

/**
 * In-flight cap. Nothing drops below 2 — a single slot turns any incidental
 * parallelism in a client (two tabs, a prefetch alongside a user action) into a
 * spurious 429 — and subscribed tiers keep enough headroom to actually
 * parallelise.
 */
const userConcurrent = (
    scope: string,
    paid: number,
    free: number,
    temp: number,
): NonNullable<RouteOptions['concurrent']> => ({
    scope,
    limit: paid,
    key: 'user',
    bySubscription: {
        [DEFAULT_FREE_SUBSCRIPTION]: free,
        [DEFAULT_TEMP_SUBSCRIPTION]: temp,
    },
});

/**
 * Per-network window, for the signature-authenticated routes with no session.
 *
 * `fingerprint` rather than `ip`: without an actor the only alternative is the
 * bare address, and an address is an aggregate — a household, an office, a
 * mobile carrier's gateway. Keying on it means one bucket for everyone behind
 * it, which is a shared cap that gets tighter the more real users are present.
 * The fingerprint folds in the headers a client can't vary per request without
 * also looking like a different client, so separate browsers behind one NAT get
 * separate buckets while a single client still can't mint fresh ones per call.
 */
const networkWindow = (
    scope: string,
    limit: number,
    window = 60_000,
): RouteRateLimit => ({ scope, limit, window, key: 'fingerprint' });

// -- Metadata reads --------------------------------------------------

/** Chattiest call in the GUI; high enough to only ever catch a loop. */
export const FS_STAT_LIMIT = userWindow('fs:stat', 1200, 600, 300);

/**
 * Desktop boot fans out hard, so the minute budget is generous — the short
 * second window is what actually catches a runaway loop before it has spent the
 * whole minute's allowance.
 */
export const FS_READDIR_LIMIT: RouteRateLimit[] = [
    userWindow('fs:readdir', 600, 300, 120),
    userWindow('fs:readdir-burst', 120, 60, 30, 10_000),
];

/**
 * Unindexed scan across the user's tree, and close to unmetered — a result set
 * is a few hundred bytes of egress against an arbitrary amount of database
 * work, so this is the cheapest way to occupy a connection. Tightest limit in
 * the file.
 */
export const FS_SEARCH_LIMIT = userWindow('fs:search', 60, 30, 10);
export const FS_SEARCH_CONCURRENT = userConcurrent('fs:search', 5, 2, 2);

/** Aggregation over the whole tree; the GUI needs it rarely. */
export const FS_DF_LIMIT = userWindow('fs:df', 60, 30, 15);

// -- Content transfer ------------------------------------------------

/**
 * Egress is billed, so cost is already bounded — the cap here is against
 * connection exhaustion, which is why the concurrency slot matters more than
 * the window.
 */
export const FS_READ_LIMIT = userWindow('fs:read', 600, 300, 120);
export const FS_READ_CONCURRENT = userConcurrent('fs:read', 10, 5, 3);

export const FS_WRITE_LIMIT = userWindow('fs:write', 300, 120, 30);
export const FS_WRITE_CONCURRENT = userConcurrent('fs:write', 15, 6, 3);

/**
 * Multipart handshake — several calls per upload, so a multiple of the write
 * budget rather than a peer of it. Signing is the half that costs us
 * object-store calls.
 *
 * The multiple is what matters: a per-minute ceiling here divides down into a
 * much smaller number of files, and selecting a folder's worth of them is one
 * gesture. `FS_WRITE_LIMIT` and storage quota already bound what actually gets
 * written, so this only has to stay out of the way of a real upload.
 */
export const FS_MULTIPART_LIMIT = userWindow('fs:multipart', 2400, 1200, 600);

// -- Metadata mutations ----------------------------------------------

/**
 * Mkdir / touch / rename / delete / move / copy / mkshortcut.
 *
 * The desktop issues one call per item and does not pace them: emptying the
 * trash, deleting a multi-selection, or dragging a folder's worth of files
 * fires the whole set back to back. A minute budget in the low hundreds turns
 * an ordinary "select all, delete" into a partial failure, so the minute window
 * is sized to clear a bulk pass over a few hundred items on every tier — an
 * anonymous session gets a real desktop, so it needs a real bulk allowance too,
 * just a smaller one.
 *
 * The hour window is where the abuse ceiling actually lives. It allows a few of
 * those bulk passes per hour, which is more than a person driving a file
 * manager will ever need and well under what a script grinding metadata writes
 * would want.
 */
export const FS_MUTATE_LIMIT: RouteRateLimit[] = [
    userWindow('fs:mutate', 1200, 900, 600),
    userWindow('fs:mutate-sustained', 6000, 3000, 1800, 60 * 60_000),
];

/** Mints a URL that outlives the request, so worth its own budget. */
export const FS_SIGN_LIMIT = userWindow('fs:sign', 300, 150, 60);

/** Low-frequency GUI helpers. */
export const FS_HELPER_LIMIT = userWindow('fs:helper', 120, 60, 30);

/**
 * Puter.js polls this on a timer to decide whether to purge its FS cache. Same
 * ceiling for free and paid — it is a single cache read.
 */
export const FS_POLL_LIMIT = userWindow('fs:poll', 240, 240, 120);

// -- Legacy multipart upload -----------------------------------------

/**
 * `/batch` buffers every file fully into memory before any quota or storage
 * check runs, up to BATCH_MAX_FILES × BATCH_MAX_FILE_SIZE. The concurrency slot
 * is doing the real work here; the window is secondary, and sized to say so —
 * one upload is one call, so a per-minute ceiling in the tens is a cap on how
 * many files someone may upload rather than a bound on cost. What actually
 * bounds the memory this route can tie up is how many run at once.
 */
export const FS_BATCH_LIMIT = userWindow('fs:batch', 600, 300, 300);
export const FS_BATCH_CONCURRENT = userConcurrent('fs:batch', 5, 2, 2);

// -- Signed-URL routes (no session to key on) ------------------------
//
// The URL's own signature is what authorizes these; the limits below only
// bound what an unsigned flood can cost. Sized for what the routes are
// actually used for, which is content the browser fetches as a subresource:
// a gallery, a document's images, an app loading its own assets. A page
// opening a few dozen of those at once is ordinary, and every rejection here
// is a broken image rather than a slow one — so the ceiling clears a burst of
// real page loads and only catches something looping.

export const FS_SIGNED_READ_LIMIT = networkWindow('fs:signed-read', 3_000);
export const FS_SIGNED_WRITE_LIMIT = networkWindow('fs:signed-write', 600);
export const FS_SIGNED_CONCURRENT: NonNullable<RouteOptions['concurrent']> = {
    scope: 'fs:signed',
    // Above what a browser will open to one origin at once, so the in-flight
    // cap never decides the outcome for a single client — it is there for a
    // client that opens connections without closing them.
    limit: 60,
    key: 'fingerprint',
};

// -- WebDAV ----------------------------------------------------------

/**
 * One `router.use` fronts the whole DAV surface, so a single gate there covers
 * every verb. Desktop DAV clients are bursty — a lower ceiling shows up as
 * spurious failures in Finder / Explorer.
 *
 * Unlike everything above, the DAV gate runs before the request is
 * authenticated: there is no actor yet, so there is no subscription to resolve
 * a tier against and one ceiling applies to every caller. These are shaped to
 * say that — keyed on the network fingerprint the gate buckets on, with no
 * `bySubscription` map to imply a tiering that never happens.
 */
export const DAV_LIMIT: RouteRateLimit = {
    scope: 'dav',
    limit: 600,
    window: 60_000,
    key: 'fingerprint',
};
export const DAV_CONCURRENT: NonNullable<RouteOptions['concurrent']> = {
    scope: 'dav',
    limit: 10,
    key: 'fingerprint',
};
