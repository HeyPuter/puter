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
    AsYouType,
    parsePhoneNumber,
    getExampleNumber,
} from 'libphonenumber-js';
import phoneExamples from 'libphonenumber-js/mobile/examples';

// Thin, defensive wrappers around libphonenumber-js used by the SMS
// phone-verification dialog. Every function swallows the library's throws
// (it throws on empty/garbage input) and returns a safe fallback, so the UI
// can call them on every keystroke without guarding each call site.

/**
 * Format a partially-typed national number for display as the user types,
 * e.g. "2015550123" → "(201) 555-0123" for US. Purely cosmetic: the value is
 * always re-parsed before submission, so a formatting miss can never corrupt
 * the number actually sent. Returns the original input on any error.
 *
 * @param {string} value - Raw input value.
 * @param {string} iso - Selected country (ISO 3166-1 alpha-2).
 * @returns {string}
 */
const format_phone_as_you_type = (value, iso) => {
    try {
        return new AsYouType(iso).input(value ?? '');
    } catch (_) {
        return value ?? '';
    }
};

/**
 * Parse a typed number against the selected country and report its canonical
 * E.164 form and whether it is a valid number. Accepts either a national
 * number (interpreted using `iso`) or a full international number (leading
 * "+", which overrides `iso`). libphonenumber correctly handles trunk
 * prefixes here — e.g. UK "07400 123456" → "+447400123456".
 *
 * @param {string} input - Raw input value.
 * @param {string} iso - Selected country (ISO 3166-1 alpha-2).
 * @returns {{ e164: string|null, is_valid: boolean }}
 */
const inspect_phone = (input, iso) => {
    const raw = (input ?? '').trim();
    if (!raw) return { e164: null, is_valid: false };
    try {
        const parsed = parsePhoneNumber(raw, iso);
        if (!parsed) return { e164: null, is_valid: false };
        return { e164: parsed.number, is_valid: parsed.isValid() };
    } catch (_) {
        return { e164: null, is_valid: false };
    }
};

/**
 * An example national-format number for a country, used as the field
 * placeholder so users see the expected shape. "" when unavailable.
 *
 * @param {string} iso - Country (ISO 3166-1 alpha-2).
 * @returns {string}
 */
const phone_example_for = (iso) => {
    try {
        const ex = getExampleNumber(iso, phoneExamples);
        return ex ? ex.formatNational() : '';
    } catch (_) {
        return '';
    }
};

/**
 * If the user typed or pasted a full international number (leading "+"),
 * detect which country it belongs to so the picker can follow along. Returns
 * an ISO code, or null when the input isn't international or is ambiguous.
 *
 * @param {string} input - Raw input value.
 * @returns {string|null}
 */
const detect_country_from_input = (input) => {
    const raw = (input ?? '').trim();
    if (!raw.startsWith('+')) return null;
    try {
        const parsed = parsePhoneNumber(raw);
        return parsed?.country ?? null;
    } catch (_) {
        return null;
    }
};

export {
    format_phone_as_you_type,
    inspect_phone,
    phone_example_for,
    detect_country_from_input,
};
