export interface UsageAddons {
    purchasedCredits: number;
    consumedPurchaseCredits: number;
    purchasedStorage: number;
    rateDiscounts: {
        [usageType: string]: number | string;
    };
}

export interface UsageRecord {
    cost: number;
    count: number;
    units: number;
}

export type UsageByType = { total: number } & Partial<Record<Exclude<string, 'total'>, UsageRecord>>;

export interface AppTotals {
    total: number;
    count: number;
}
