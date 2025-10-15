import { toMicroCents } from "../utils";

export const TEMP_USER_FREE = {
    id: 'temp_free',
    monthUsageAllowence: toMicroCents(0.25),
    monthlyStorageAllowence: 100 * 1024 * 1024, // 100MiB
};