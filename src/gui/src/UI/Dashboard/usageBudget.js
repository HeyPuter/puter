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

/**
 * @typedef {Object} UsageBudget
 * @property {number} used - Allowance-charged spend net of unspent top-up, in
 *   the server's units. Negative when top-up credit exceeds the spend.
 * @property {number} capacity - The monthly plan allowance.
 * @property {number} percent - `used` as a whole-number share of `capacity`.
 *   Negative when `used` is.
 * @property {number} barPercent - The share clamped to 0-100, for a bar width.
 */

/**
 * The numbers the usage cards show, anchored to the monthly plan.
 *
 * Capacity is the plan's monthly allowance, always — the bar answers "how much
 * of my plan have I used", so its denominator must not move with purchases.
 * `used` is the month's allowance-charged spend (`usage.allowanceUsed`; records
 * from before the split was tracked fall back to the month total, capped at the
 * allowance), minus whatever top-up credit is still unspent. Unspent credit
 * therefore reads as headroom — spend a little with a large credit balance and
 * the share is negative — rather than inflating the plan's capacity.
 *
 * @param {Object | null | undefined} usage - `usage` from `getMonthlyUsage()`.
 * @param {Object | null | undefined} allowanceInfo - Its `allowanceInfo`
 *   sibling.
 * @returns {UsageBudget}
 */
export const usageBudget = (usage, allowanceInfo) => {
    const capacity = Number.isFinite(allowanceInfo?.monthUsageAllowance)
        ? Math.max(0, allowanceInfo.monthUsageAllowance)
        : 0;
    const total = Number.isFinite(usage?.total) ? Math.max(0, usage.total) : 0;
    // Allowance-charged spend is a subset of spend, so a reported value past
    // the total is corrupt (a raced or repeated server write) — same clamp
    // the server applies when it computes `remaining`. Without it the two
    // surfaces disagree: the bar overstates while remaining stays right.
    const allowanceUsed = Math.min(
        Number.isFinite(usage?.allowanceUsed)
            ? Math.max(0, usage.allowanceUsed)
            : Math.min(total, capacity),
        total,
    );
    const addons = allowanceInfo?.addons ?? {};
    const purchased = Number.isFinite(addons.purchasedCredits)
        ? addons.purchasedCredits
        : 0;
    const consumed = Number.isFinite(addons.consumedPurchaseCredits)
        ? addons.consumedPurchaseCredits
        : 0;
    const creditRemaining = Math.max(0, purchased - consumed);

    const used = allowanceUsed - creditRemaining;
    const share = capacity ? (used / capacity) * 100 : 0;
    return {
        used,
        capacity,
        percent: Math.round(share),
        barPercent: Math.max(0, Math.min(100, share)),
    };
};
