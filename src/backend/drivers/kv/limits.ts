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

// Per-call caps on the public KV driver. Enforced here rather than in the
// store, whose internal callers batch past them.

/** Keys one array `get` may name. */
export const KV_MAX_GET_KEYS = 1000;

/** Items one `batchPut` may write. */
export const KV_MAX_BATCH_PUT_ITEMS = 1000;

/**
 * Largest `list` page. A larger `limit` is lowered to this rather than refused;
 * the cursor carries the rest. Matches the SDK's own page size.
 */
export const KV_MAX_LIST_LIMIT = 1000;
