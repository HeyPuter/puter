import { DEFAULT_FREE_SUBSCRIPTION } from '../consts.js';
import { toMicroCents } from '../utils.js';

export const REGISTERED_USER_FREE = {
    id: DEFAULT_FREE_SUBSCRIPTION,
    monthUsageAllowance: toMicroCents(0.50),
    monthlyStorageAllowance: 100 * 1024 * 1024, // 100MiB
} as const;