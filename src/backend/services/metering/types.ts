/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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

/** One metered event: what was used, how much of it, and what it cost. */
export interface UsageInput {
    usageType: string;
    usageAmount: number;
    costOverride?: number;
}

export type UsageByType = {
    total: number;
    /**
     * Claim counter for the month's recurring charges — see
     * `MONTHLY_CHARGE_CLAIM`. Absent until the first read or write of the
     * month; 1 for whoever claimed it, higher for anyone who raced and lost.
     */
    monthlyChargesApplied?: number;
} & Partial<Record<Exclude<string, 'total'>, UsageRecord>>;

export interface AppTotals {
    total: number;
    count: number;
}
