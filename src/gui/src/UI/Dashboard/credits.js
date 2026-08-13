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
 * Usage renders in credits, a display unit layered over the microcents the
 * server stores and returns. The rate comes from the server
 * (`allowanceInfo.creditsPerDollar`) so a deployment can rescale it in config
 * without a client release; this default only covers a server that predates
 * the field.
 */
export const DEFAULT_CREDITS_PER_DOLLAR = 2000;

/** The display rate from a `getMonthlyUsage()` response, or the default. */
export const creditsRate = (allowanceInfo) => {
    const rate = allowanceInfo?.creditsPerDollar;
    return Number.isFinite(rate) && rate > 0
        ? rate
        : DEFAULT_CREDITS_PER_DOLLAR;
};

export const creditsFromMicrocents = (microcents, rate) => {
    const mc = Number.isFinite(microcents) ? microcents : 0;
    return (mc * rate) / 100_000_000;
};

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

/** `formatCredits` straight from a microcent amount. */
export const formatCreditsFromMicrocents = (microcents, rate) =>
    formatCredits(creditsFromMicrocents(microcents, rate));
