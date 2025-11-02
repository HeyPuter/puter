import { toMicroCents } from '../utils';

export const TEMP_USER_FREE = {
    id: 'temp_free',
    monthUsageAllowance: toMicroCents(0.25),
    monthlyStorageAllowance: 100 * 1024 * 1024, // 100MiB
} as const;