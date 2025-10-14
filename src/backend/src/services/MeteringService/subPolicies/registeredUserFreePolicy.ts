import { toMicroCents } from "../utils";

export const REGISTERED_USER_FREE = {
    monthUsageAllowence: toMicroCents(0.50),
    monthlyStorageAllowence: 100 * 1024 * 1024, // 100MiB
};