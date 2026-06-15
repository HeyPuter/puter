/**
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

import {
    parsePhoneNumberFromString,
    type CountryCode,
} from 'libphonenumber-js';

export interface ParsedPhone {
    /** E.164 form, e.g. "+14155550123" — the format Prelude requires. */
    e164: string;
    /** ISO 3166-1 alpha-2 region (e.g. 'US'), or undefined if undetermined. */
    country?: string;
}

/**
 * Parse + validate raw user-entered phone input, returning its E.164 form and
 * country. Returns `null` when the input isn't a valid number — callers should
 * treat that as a 400 (bad phone). `defaultCountry` lets a local-format number
 * (no "+") be interpreted (e.g. "(415) 555-0123" with 'US').
 *
 * @param input Raw phone string from the client.
 * @param defaultCountry ISO 3166-1 alpha-2 region for local-format numbers.
 */
export function parsePhone(
    input: unknown,
    defaultCountry?: string,
): ParsedPhone | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    const parsed = parsePhoneNumberFromString(
        trimmed,
        defaultCountry as CountryCode | undefined,
    );
    if (!parsed || !parsed.isValid()) return null;

    return { e164: parsed.number, country: parsed.country };
}

/**
 * Sanitize raw user-entered phone input to a validated E.164 string, or `null`
 * if invalid. Thin wrapper over {@link parsePhone} for callers that only need
 * the number.
 */
export function sanitizePhone(
    input: unknown,
    defaultCountry?: string,
): string | null {
    return parsePhone(input, defaultCountry)?.e164 ?? null;
}
