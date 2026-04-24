// Microcents per byte of TURN egress (matches v1 ≈$5/GB).
export const PEER_COSTS = {
    'turn:egress-bytes': 0.5, // 0.5 microcents per byte = $0.005 per GB
} as const;
