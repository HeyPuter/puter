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

import { intlLocale } from '../../i18n/intlLocale.js';

/**
 * Usage renders in credits, a display unit the SERVER scales amounts into
 * before they leave the API (a deployment-config multiplier the client never
 * sees). A response says which unit it carries: `allowanceInfo.unit ===
 * 'credits'` means every monetary field is already in credits; absent means
 * raw amounts from a deployment with no multiplier, rendered as dollars.
 */

// In the dashboard's language: "5,000" reads as five in German.
const numberFormat = (options) => {
    try {
        return new Intl.NumberFormat(intlLocale(globalThis.window?.locale ?? 'en'), options);
    } catch {
        return new Intl.NumberFormat('en', options);
    }
};

/** Whether a `getMonthlyUsage()` response reports credits. */
export const usageIsCredits = (allowanceInfo) =>
    allowanceInfo?.unit === 'credits';

/**
 * Credits as the raw number users see: whole credits once the amount has any
 * size, decimals only while fractions are all there is to show. Never renders
 * a nonzero amount as "0" — a cost that exists shows as at least "<0.01".
 * Negative amounts (net usage with unspent top-up) keep their sign.
 *
 * @param {number} credits
 * @returns {string}
 */
export const formatCredits = (credits) => {
    const value = Number.isFinite(credits) ? credits : 0;
    if (value < 0) return `-${formatCredits(-value)}`;
    if (value <= 0) return '0';
    if (value < 0.01) return `<${numberFormat({}).format(0.01)}`;
    // Trailing zeros go, so 2.50 reads as "2.5" and 9.00 as "9".
    return numberFormat({ maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
};

/**
 * Dollar rendering for deployments that report raw (unscaled) amounts. Like
 * `formatCredits`, a nonzero amount under a cent shows as "<$0.01", not "$0.00".
 */
export const formatDollarsFromMicrocents = (microcents) => {
    const mc = Number.isFinite(microcents) ? microcents : 0;
    const dollars = mc / 100_000_000;
    const format = numberFormat({ style: 'currency', currency: 'USD' });
    if ( dollars !== 0 && Math.abs(dollars) < 0.005 ) return `${dollars < 0 ? '-' : ''}<${format.format(0.01)}`;
    return format.format(dollars);
};
