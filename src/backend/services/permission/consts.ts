/**
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

export const MANAGE_PERM_PREFIX = 'manage';
export const PERM_KEY_PREFIX = 'perm';

/**
 * De-facto placeholder permission for permission rewrites that do not grant
 * any access.
 */
export const PERMISSION_FOR_NOTHING_IN_PARTICULAR =
    'permission-for-nothing-in-particular';

/** TTL (seconds) for redis-cached permission scan readings. */
export const PERMISSION_SCAN_CACHE_TTL_SECONDS = 20;

/**
 * TTL (seconds) for the per-actor cache-generation counter. A grant/revoke
 * bumps this counter, which is folded into the scan/check cache keys so all
 * of that actor's cached readings are orphaned at once (cluster-safe — a
 * single-key INCR, no pattern scan). Must be comfortably longer than
 * {@link PERMISSION_SCAN_CACHE_TTL_SECONDS} so the counter never lapses back
 * to 0 while same-generation cache entries are still live (which would
 * revive stale readings). Refreshed on every bump.
 */
export const PERMISSION_CACHE_GENERATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * TTL (seconds) for flat user-permission entries written by the scan-path
 * cache warm (`validateUserPerms`), as opposed to entries written by an
 * explicit grant, which are authoritative and permanent. A warm is derived
 * from a SQL traversal, so a warm that races a concurrent revoke (its KV
 * write landing after the revoke's flat delete) can re-materialize a
 * just-revoked grant. The expiry bounds that failure to this window —
 * after it lapses the next scan re-derives from SQL, which the revoke
 * deletes synchronously — instead of letting it persist indefinitely.
 */
export const FLAT_PERM_WARM_TTL_SECONDS = 60;

/**
 * TTL (seconds) for the per-node in-process cache of the generation
 * counter. Permission checks are very hot, so reading the counter from
 * Redis on every check would add a round-trip to the hottest path. A tiny
 * local cache collapses repeated reads (including the recursive
 * issuer-scan and `checkMany` fan-out) to in-memory lookups. The authoritative
 * counter still lives in Redis: a bump on any node propagates to the others
 * within this window, so this is the cross-node revocation lag (the bumping
 * node itself updates its local copy immediately and is consistent at once).
 * Keep it short.
 */
export const PERMISSION_CACHE_GENERATION_LOCAL_TTL_SECONDS = 2;

/**
 * Sentinel grant for a "full API access" access token: the token may do
 * anything its issuing user can do via the API (filesystem, drivers, KV, AI,
 * apps, workers — resolved against the issuer at check time in
 * `PermissionService.#scanAccessToken`). It does NOT unlock account
 * management: access-token actors are still rejected by the
 * `requireUserActor` / session-cookie gates that protect change-password,
 * change-email, change-username, 2FA, sync-cookie, token minting, etc.
 *
 * Only a plain user actor may mint a token carrying this grant — never an
 * app-under-user actor (which must not be able to escalate to full access).
 *
 * Chosen over `'*'`, which already appears as an audit-log "revoke all" label.
 */
export const FULL_API_ACCESS = 'full-api-access';
