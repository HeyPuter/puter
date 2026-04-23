// Microcents per underlying DynamoDB capacity unit, as reported by
// SystemKVStore.KVUsage. Cost is `KV_COSTS[op] * usage.<op>`.
export const KV_COSTS = {
    'kv:read': 63,
    'kv:write': 125,
} as const;
