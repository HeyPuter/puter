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
 * Usage renders in credits, a display unit the SERVER scales amounts into
 * before they leave the API (a deployment-config multiplier the client never
 * sees). A response says which unit it carries: `allowanceInfo.unit ===
 * 'credits'` means every monetary field is already in credits; absent means
 * raw amounts from a deployment with no multiplier, rendered as dollars.
 */

/** Whether a `getMonthlyUsage()` response reports credits. */
export const usageIsCredits = (allowanceInfo) =>
    allowanceInfo?.unit === 'credits';

/**
 * Credits as the raw number users see: whole credits once the amount has any
 * size, decimals only while fractions are all there is to show. Never renders
 * a nonzero amount as "0" — a cost that exists shows as at least "<0.01".
 *
 * @param {number} credits
 * @returns {string}
 */
export const formatCredits = (credits) => {
    const value = Number.isFinite(credits) ? credits : 0;
    if (value <= 0) return '0';
    if (value >= 100) {
        return Math.round(value).toLocaleString('en-US');
    }
    if (value >= 1) {
        // Trim trailing zeros so "2.50" reads as "2.5" and "9.00" as "9".
        return String(Number(value.toFixed(2)));
    }
    return value < 0.01 ? '<0.01' : String(Number(value.toFixed(2)));
};

/** Dollar rendering for deployments that report raw (unscaled) amounts. */
export const formatDollarsFromMicrocents = (microcents) => {
    const mc = Number.isFinite(microcents) ? microcents : 0;
    return window.number_format(mc / 100_000_000, {
        decimals: 2,
        prefix: '$',
    });
};
