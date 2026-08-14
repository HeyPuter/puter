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
 * @property {number} used - Month-to-date spend, in the server's units.
 * @property {number} capacity - The whole budget: spend plus what is left.
 * @property {number} percent - `used` as a whole-number share of `capacity`, 0-100.
 * @property {number} barPercent - The same share unrounded, for a bar width.
 */

/**
 * The three numbers the usage cards show, from the two the server reports.
 *
 * `remaining` is already netted: what is left of the monthly allowance plus
 * what is left of any purchased credit, with overage past the allowance
 * charged to the credit. So spend plus remaining IS the budget, and deriving
 * capacity that way can't contradict either input — "$3.00 of $12.00, 25%"
 * always adds up, whatever the mix.
 *
 * The share is taken against that whole budget rather than the monthly
 * allowance alone. Measured against the allowance, held credit subtracted from
 * spend, so an account that had bought credit and barely spent it read as a
 * negative percentage of its own plan.
 *
 * @param {number} totalUsage - Month-to-date spend.
 * @param {number} remaining - Server-netted budget left.
 * @returns {UsageBudget}
 */
export const usageBudget = (totalUsage, remaining) => {
    const used = Number.isFinite(totalUsage) ? Math.max(0, totalUsage) : 0;
    const left = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const capacity = used + left;
    const share = capacity ? (used / capacity) * 100 : 0;
    const barPercent = Math.max(0, Math.min(100, share));
    return {
        used,
        capacity,
        percent: Math.round(barPercent),
        barPercent,
    };
};
