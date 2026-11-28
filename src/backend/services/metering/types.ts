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
    /**
     * Spend neither pool covered, run up by requests a backer let go below zero
     * (see `UsageHeadroom.overdraft`). Owed: it comes off the balance, and
     * later credit pays it first. Below zero when a payoff ran twice.
     */
    overdrawn?: number;
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
     * Overdrawn spend this month's allowance paid off. Counts against the
     * allowance beside `allowanceUsed`.
     */
    overdraftSettled?: number;
    /** Claim counter for that payoff; 1 for the winner, higher for racers. */
    overdraftSettledClaim?: number;
    /**
     * Claim for the month's recurring charges (`MONTHLY_CHARGE_CLAIM`): the
     * token of the attempt that took it, or a claim count on older records.
     */
    monthlyChargesApplied?: number;
    /**
     * How many distinct detail types the totals item has admitted this month
     * (sharded months only) — bookkeeping for the cap, never returned to a
     * caller.
     */
    detailPaths?: number;
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

/**
 * What an actor has to spend and how much of it running operations hold.
 * `version` marks the balance as read, so a conditional hold can tell that it
 * changed since; null when the cache couldn't answer.
 */
export interface UsageHeadroom {
    /** Negative for an actor that owes overdrawn spend. */
    balance: number;
    held: number;
    version?: string | null;
    /**
     * How far below zero a backer lets the actor run. A hold taken within this
     * headroom may use it, and the spend past the balance is recorded as owed.
     */
    overdraft?: number;
}

/** For paths that take no hold but still release one. */
export const NO_CREDIT_HOLD: CreditHold = { release: async () => {} };
