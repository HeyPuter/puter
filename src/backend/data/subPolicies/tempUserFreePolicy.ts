import { DEFAULT_TEMP_SUBSCRIPTION } from '../../services/metering/consts.js';
import { toMicroCents } from '../../services/metering/utils.js';

export const TEMP_USER_FREE = {
    id: DEFAULT_TEMP_SUBSCRIPTION,
    monthUsageAllowance: toMicroCents(0.25),
    monthlyStorageAllowance: 100 * 1024 * 1024, // 100MiB
} as const;
