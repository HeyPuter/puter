import { DEFAULT_FREE_SUBSCRIPTION } from '../../services/metering/consts.js';
import { toMicroCents } from '../../services/metering/utils.js';

export const REGISTERED_USER_FREE = {
    id: DEFAULT_FREE_SUBSCRIPTION,
    monthUsageAllowance: toMicroCents(0.25),
    monthlyStorageAllowance: 100 * 1024 * 1024, // 100MiB
} as const;
