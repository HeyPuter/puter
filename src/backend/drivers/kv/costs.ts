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

// Microcents per underlying DynamoDB capacity unit, as reported by
// SystemKVStore.KVUsage. Cost is `KV_COSTS[op] * usage.<op>`.
export const KV_COSTS = {
    'kv:read': 50,
    'kv:write': 250,
    // 10% of `kv:read`: a cached read still costs a lookup, a metering write
    // and cache memory, but not store capacity. The unit count is the one the
    // equivalent uncached read consumed.
    'kv:read:cached': 5,
} as const;
