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
 * A meter's share as a whole percent. 100% reads as spent, so a meter with
 * anything left shows 99% at most.
 *
 * @param {number} share - The share, 0-100 (or past 100 when overspent).
 * @returns {number}
 */
export const meterPercent = (share) => (share < 100 ? Math.min(99, Math.round(share)) : Math.round(share));

/**
 * @typedef {Object} UsageBudget
 * @property {number} used - Spend charged to it, in the server's units.
 * @property {number} capacity - What the meter is out of: the monthly plan allowance, or the add-on credit bought.
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
    // `overdraftSettled` is overdrawn spend the allowance paid off. It is
    // charged to the allowance beside `allowanceUsed`, outside that clamp.
    const used = Math.min(
        Number.isFinite(usage?.allowanceUsed)
            ? Math.max(0, usage.allowanceUsed)
            : Math.min(total, capacity),
        total,
    ) + nonNegative(usage?.overdraftSettled);
    const share = capacity ? (used / capacity) * 100 : 0;
    return {
        used,
        capacity,
        percent: meterPercent(share),
        barPercent: Math.max(0, Math.min(100, share)),
    };
};

/**
 * Unspent add-on credit, which only pays for usage once the monthly allowance
 * is spent and carries across months. Negative for an account that spent more
 * than it had: it owes the difference (`addons.overdrawn`), which its next
 * credits pay first. Null when the account has never had any and owes nothing.
 *
 * @param {Object | null | undefined} allowanceInfo
 * @returns {number | null}
 */
export const addonCreditsRemaining = (allowanceInfo) => {
    const addons = allowanceInfo?.addons ?? {};
    const purchased = nonNegative(addons.purchasedCredits);
    // Below zero is credit the account is owed back, and spendable.
    const owed = Number.isFinite(addons.overdrawn) ? addons.overdrawn : 0;
    if ( ! (purchased > 0) && owed === 0 ) return null;
    return Math.max(0, purchased - nonNegative(addons.consumedPurchaseCredits)) - owed;
};

/**
 * What is left of the month's plan allowance, never below zero.
 *
 * @param {Object | null | undefined} usage - `usage` from `getMonthlyUsage()`.
 * @param {Object | null | undefined} allowanceInfo - Its `allowanceInfo` sibling.
 * @returns {number}
 */
export const monthlyBalance = (usage, allowanceInfo) => {
    const { used, capacity } = usageBudget(usage, allowanceInfo);
    return Math.max(0, capacity - used);
};

/**
 * `getMonthlyUsage()` resolves with whatever body the server answered, an
 * error included. Throws unless that body is a usage report, so a failed
 * request isn't shown as a month with nothing used.
 *
 * @param {Object | null | undefined} res - What `getMonthlyUsage()` resolved with.
 * @returns {Object} `res`, once checked.
 */
export const monthlyUsageOrThrow = (res) => {
    if ( res === null || typeof res?.usage !== 'object' || res.usage === null ) {
        throw new Error(res?.message || 'Usage report unavailable');
    }
    return res;
};
