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

/** How long a monthly metering record is kept once configuration says nothing. */
export const DEFAULT_METERING_RETENTION_MONTHS = 3;

/**
 * How many full months past its own a metering record is kept, from config.
 * Unset or non-numeric falls back to the default; zero or negative turns
 * retention off (records are kept forever).
 */
export function resolveMeteringRetentionMonths(config: {
    meteringRetentionMonths?: number;
}): number {
    const configured = config?.meteringRetentionMonths;
    if (!Number.isFinite(configured)) return DEFAULT_METERING_RETENTION_MONTHS;
    const floored = Math.floor(configured as number);
    return floored < 1 ? 0 : floored;
}

/**
 * A metering key's trailing `:yyyy-mm`, so a value can be reasoned about as a
 * month.
 */
const MONTH_SUFFIX_RE = /:(\d{4})-(\d{2})$/;

/**
 * When a metering record should expire, as a Unix timestamp in seconds — the
 * shape `SystemKVStore`'s `ttl` attribute wants — or `undefined` when the key
 * isn't a monthly metering record or retention is off.
 *
 * A record is kept through its own month plus `months` full months after it:
 * `2026-09` with `months = 3` expires 2027-01-01T00:00Z. Relies on `Date.UTC`
 * rolling a month argument past 11 into the following year, so the month from
 * the key (1-indexed) can be added to `months` directly.
 */
export function meteringRecordExpiresAt(
    key: string,
    months: number,
): number | undefined {
    if (!(months > 0)) return undefined;
    if (!key.startsWith('metering:')) return undefined;

    const match = MONTH_SUFFIX_RE.exec(key);
    if (!match) return undefined;

    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return undefined;

    return Date.UTC(year, month + months, 1) / 1000;
}
