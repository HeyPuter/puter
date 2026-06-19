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

import { getCountries, getCountryCallingCode } from 'libphonenumber-js';

// The country list for the SMS phone-verification dropdown is derived at
// runtime from libphonenumber-js (the authoritative set of dialable countries
// and their calling codes) and Intl.DisplayNames (localized country names).
// Nothing is hand-maintained, so the list can never drift out of sync with the
// parsing/validation logic that uses the same library.

/**
 * Convert a two-letter ISO 3166-1 alpha-2 country code into its flag emoji by
 * mapping each ASCII letter to its regional-indicator symbol. Returns an empty
 * string for malformed input so callers can safely concatenate the result.
 *
 * @global
 * @param {string} iso - Two-letter country code, e.g. "US".
 * @returns {string} The flag emoji, or '' if the code is not two ASCII letters.
 */
const flag_emoji_for = (iso) => {
    if (typeof iso !== 'string' || iso.length !== 2) return '';
    const base = 0x1f1e6; // regional indicator symbol letter A
    const cc = iso.toUpperCase();
    const a = cc.charCodeAt(0) - 65;
    const b = cc.charCodeAt(1) - 65;
    if (a < 0 || a > 25 || b < 0 || b > 25) return '';
    return String.fromCodePoint(base + a) + String.fromCodePoint(base + b);
};

// Cache the assembled list per locale — building it touches ~245 countries.
const _list_cache = {};

/**
 * The full list of dialable countries for the given locale, each entry:
 *   { iso: 'US', dial: '+1', name: 'United States', flag: '🇺🇸' }
 * Sorted by localized name. Cached per locale. Always returns an array (empty
 * only in the extremely unlikely event libphonenumber yields nothing).
 *
 * @global
 * @param {string} [locale] - BCP-47 locale for country names (defaults to 'en').
 * @returns {Array<{ iso: string, dial: string, name: string, flag: string }>}
 */
const get_country_list = (locale) => {
    const key = locale || 'en';
    if (_list_cache[key]) return _list_cache[key];

    let display_names = null;
    try {
        display_names = new Intl.DisplayNames([key, 'en'], { type: 'region' });
    } catch (_) {
        try {
            display_names = new Intl.DisplayNames(['en'], { type: 'region' });
        } catch (__) {
            display_names = null;
        }
    }

    let isos = [];
    try {
        isos = getCountries();
    } catch (_) {
        isos = [];
    }

    const list = [];
    for (const iso of isos) {
        let dial = '';
        try {
            dial = '+' + getCountryCallingCode(iso);
        } catch (_) {
            continue; // skip anything without a usable calling code
        }
        let name = iso;
        try {
            name = (display_names && display_names.of(iso)) || iso;
        } catch (_) {
            name = iso;
        }
        list.push({ iso, dial, name, flag: flag_emoji_for(iso) });
    }

    try {
        list.sort((a, b) => a.name.localeCompare(b.name, key));
    } catch (_) {
        list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }

    _list_cache[key] = list;
    return list;
};

export { get_country_list, flag_emoji_for };
