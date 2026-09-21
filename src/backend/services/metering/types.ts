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
     * The part of `total` charged to the monthly allowance; spend past it draws
     * down purchased credits instead. Absent on records from before the split,
     * where readers count `total` against the allowance, capped at it.
     */
    allowanceUsed?: number;
    /**
     * Claim counter for folding the pre-split baseline into `allowanceUsed`; 1
     * for the winner, higher for racers.
     */
    allowanceUsedBaselined?: number;
    /**
     * Claim counter for the month's recurring charges (`MONTHLY_CHARGE_CLAIM`);
     * same semantics.
     */
    monthlyChargesApplied?: number;
} & Partial<Record<Exclude<string, 'total'>, UsageRecord>>;

export interface AppTotals {
    total: number;
    count: number;
}

/**
 * Budget committed to an in-flight operation. Release on every path out; an
 * unreleased hold expires on its own.
 */
export interface CreditHold {
    release(): Promise<void>;
    /**
     * Push the deadline out for a long-running operation. Absent on the no-op
     * hold.
     */
    extend?(): Promise<void>;
}

/** For paths that take no hold but still release one. */
export const NO_CREDIT_HOLD: CreditHold = { release: async () => {} };
