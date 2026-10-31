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

// Caps on the public KV driver. Enforced in the driver rather than the store,
// whose internal callers batch past them.

/** Keys one array `get` may name. */
export const KV_MAX_GET_KEYS = 1000;

/** Items one `batchPut` may write. */
export const KV_MAX_BATCH_PUT_ITEMS = 1000;

/**
 * Largest `list` page. A larger `limit` is lowered to this rather than refused;
 * the cursor carries the rest. Matches the SDK's own page size.
 */
export const KV_MAX_LIST_LIMIT = 1000;

/**
 * Storage capacity calls through share handles may spend in one owner's
 * namespace per window, every holder together. A namespace's keys share one
 * partition key, so this keeps holders to about a fifth of what that key can
 * serve and leaves the rest to the owner's own app.
 */
export const KV_HANDLE_NAMESPACE_BUDGET = { limit: 6_000, window: 10_000 };

/**
 * What a call spends from that budget: its read units, plus this many per write
 * unit, since a partition serves about that many reads per write. Every call
 * spends at least one.
 */
export const KV_HANDLE_WRITE_UNIT_WEIGHT = 3;
