import { toMicroCents } from '../utils';

export const REGISTERED_USER_FREE = {
    id: 'user_free',
    monthUsageAllowance: toMicroCents(1.99),
    monthlyStorageAllowance: 100 * 1024 * 1024, // 100MiB
} as const;
