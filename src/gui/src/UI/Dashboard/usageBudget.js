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

const nonNegative = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * @typedef {Object} UsageBudget
 * @property {number} used - Allowance-charged spend, in the server's units.
 * @property {number} capacity - The monthly plan allowance.
 * @property {number} percent - `used` as a whole-number share of `capacity`.
 * @property {number} barPercent - The share clamped to 0-100, for a bar width.
 */

/**
 * The monthly plan meter. Capacity is the plan's allowance and `used` is the
 * month's allowance-charged spend (`usage.allowanceUsed`; records from before
 * the split was tracked fall back to the month total, capped at the
 * allowance). Add-on credits are a separate pool — see
 * `addonCreditsRemaining`.
 *
 * @param {Object | null | undefined} usage - `usage` from `getMonthlyUsage()`.
 * @param {Object | null | undefined} allowanceInfo - Its `allowanceInfo`
 *   sibling.
 * @returns {UsageBudget}
 */
export const usageBudget = (usage, allowanceInfo) => {
    const capacity = nonNegative(allowanceInfo?.monthUsageAllowance);
    const total = nonNegative(usage?.total);
    // Allowance-charged spend is a subset of spend, so a reported value past
    // the total is corrupt (a raced or repeated server write) — same clamp
    // the server applies when it computes `remaining`.
    const used = Math.min(
        Number.isFinite(usage?.allowanceUsed)
            ? Math.max(0, usage.allowanceUsed)
            : Math.min(total, capacity),
        total,
    );
    const share = capacity ? (used / capacity) * 100 : 0;
    return {
        used,
        capacity,
        percent: Math.round(share),
        barPercent: Math.max(0, Math.min(100, share)),
    };
};

/**
 * Unspent add-on credit, which only pays for usage once the monthly allowance
 * is spent and carries across months. Null when the account has never had any.
 *
 * @param {Object | null | undefined} allowanceInfo
 * @returns {number | null}
 */
export const addonCreditsRemaining = (allowanceInfo) => {
    const addons = allowanceInfo?.addons ?? {};
    const purchased = nonNegative(addons.purchasedCredits);
    if ( ! (purchased > 0) ) return null;
    return Math.max(0, purchased - nonNegative(addons.consumedPurchaseCredits));
};
