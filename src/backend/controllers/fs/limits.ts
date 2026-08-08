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
// Storage quota already bounds total bytes. These bound request *count*,
// which quota does not: small-file spam still costs object-store writes
// and fsentry rows, and metadata reads cost database time while being
// entirely free to the caller.

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

/** Per-IP window, for the signature-authenticated routes with no session. */
const ipWindow = (
    scope: string,
    limit: number,
    window = 60_000,
): RouteRateLimit => ({ scope, limit, window, key: 'ip' });

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
 * Unindexed scan across the user's tree, and unmetered — `FS_COSTS` prices
 * egress bytes only, so this is the cheapest way to occupy a database
 * connection. Tightest limit in the file.
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
 * Multipart handshake — several calls per upload, so roughly twice the write
 * budget. Signing is the half that costs us object-store calls.
 */
export const FS_MULTIPART_LIMIT = userWindow('fs:multipart', 600, 300, 120);

// -- Metadata mutations ----------------------------------------------

/** Mkdir / touch / rename / delete / move / copy / mkshortcut. */
export const FS_MUTATE_LIMIT = userWindow('fs:mutate', 300, 150, 60);

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
 * is doing the real work here; the window is secondary.
 */
export const FS_BATCH_LIMIT = userWindow('fs:batch', 60, 30, 10);
export const FS_BATCH_CONCURRENT = userConcurrent('fs:batch', 5, 2, 2);

// -- Signed-URL routes (no session to key on) ------------------------

export const FS_SIGNED_READ_LIMIT = ipWindow('fs:signed-read', 600);
export const FS_SIGNED_WRITE_LIMIT = ipWindow('fs:signed-write', 120);
export const FS_SIGNED_CONCURRENT: NonNullable<RouteOptions['concurrent']> = {
    scope: 'fs:signed',
    limit: 10,
    key: 'ip',
};

// -- WebDAV ----------------------------------------------------------

/**
 * One `router.use` fronts the whole DAV surface, so a single gate there covers
 * every verb. Desktop DAV clients are bursty — a lower ceiling shows up as
 * spurious failures in Finder / Explorer.
 */
export const DAV_LIMIT = userWindow('dav', 600, 300, 120);
export const DAV_CONCURRENT = userConcurrent('dav', 10, 5, 3);
