import { toMicroCents } from '../../services/metering/utils.js';

// Microcents per byte. Egress roughly matches S3 data-transfer-out
// (~$0.12/GiB); cached egress is CloudFront-backed (~$0.10/GiB).
// Ingress and deletes are currently free.
export const FS_COSTS = {
    'filesystem:ingress:bytes': 0,
    'filesystem:delete:bytes': 0,
    'filesystem:egress:bytes': toMicroCents(0.12 / 1024 / 1024 / 1024),
    'filesystem:cached-egress:bytes': toMicroCents(0.1 / 1024 / 1024 / 1024),
} as const;
