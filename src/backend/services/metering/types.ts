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
     * The part of `total` that was charged to the monthly subscription
     * allowance. The allowance is consumed first; spend past it draws down the
     * lifetime credit pool (`consumedPurchaseCredits`) instead, so the two
     * pools never bill the same spend. Living on the month record, it resets
     * with the month the way the allowance itself does. Absent on records from
     * before the split was tracked — readers fall back to counting `total`
     * against the allowance, capped at the allowance.
     */
    allowanceUsed?: number;
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

/**
 * Budget committed to an operation that hasn't finished yet.
 *
 * Released by the code that took it, on every path out — including failure. A
 * hold nobody releases expires on its own, so a lost release costs the account
 * the use of that budget for a while rather than forever.
 */
export interface CreditHold {
    release(): Promise<void>;
    /**
     * Push the hold's deadline out for an operation still running — a stream
     * can outlive the default TTL, and a hold that expires mid-operation
     * reopens the overspend window it was taken to close. Absent on the no-op
     * hold; callers renew with `hold.extend?.()`.
     */
    extend?(): Promise<void>;
}

/**
 * The hold that holds nothing — for paths that take no hold but still release
 * one.
 */
export const NO_CREDIT_HOLD: CreditHold = { release: async () => {} };
