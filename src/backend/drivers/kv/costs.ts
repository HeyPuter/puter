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
 * Share of an uncached read's rate charged for one the read cache served. It
 * still costs us a lookup, a metering write, and the memory the entry occupies
 * — just not the capacity a read of the underlying store consumes.
 */
export const KV_CACHED_READ_RATE_SHARE = 0.1;

// Microcents per underlying DynamoDB capacity unit, as reported by
// SystemKVStore.KVUsage. Cost is `KV_COSTS[op] * usage.<op>`.
export const KV_COSTS = {
    'kv:read': 17,
    'kv:write': 90,
    // 10% of `kv:read` — kept as a literal so the reported rate is exactly this
    // and not a float artifact of the multiplication. The unit count is the one
    // the equivalent uncached read consumed.
    'kv:read:cached': 1.7,
} as const;
