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
 * @param dollars
 * @returns Microcents
 */
export const toMicroCents = (dollars: number): number =>
    dollars * 1_000_000 * 100;

/**
 * The deployment's credits display rate, or null when none is configured.
 * Credits are a display unit only — metering stores and charges microcents;
 * every credit figure a client shows is derived from this rate at read time, so
 * changing it never touches stored balances. The rate lives exclusively in
 * deployment config: there is no default, and a deployment without one renders
 * usage in dollars instead.
 */
export const creditsPerDollarFrom = (config: {
    creditsPerDollar?: number;
}): number | null => {
    const rate = config.creditsPerDollar;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
        ? rate
        : null;
};
