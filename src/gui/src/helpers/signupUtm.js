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
 * Campaign `utm_*` params from the page a visitor landed on, sent with
 * whichever signup they end up making. Kept for the tab's session so a reload
 * or in-app navigation that drops the query doesn't lose them. The backend
 * re-checks every value.
 */

export const SIGNUP_UTM_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
];

const STORAGE_KEY = 'signup_utm';
const MAX_LENGTH = 255;

/**
 * The `utm_*` values in `params` (URLSearchParams or a plain object) as
 * `{ utm_source: ... }`, or null when there are none.
 */
export function readSignupUtm(params) {
    if (!params || typeof params !== 'object') return null;
    const get =
        typeof params.get === 'function'
            ? (key) => params.get(key)
            : (key) => params[key];
    const utm = {};
    for (const key of SIGNUP_UTM_PARAMS) {
        const value = get(key);
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed && trimmed.length <= MAX_LENGTH) utm[key] = trimmed;
    }
    return Object.keys(utm).length > 0 ? utm : null;
}

/**
 * The page's utm params, saved to `storage` for later loads; with none on the
 * page, the ones saved earlier this session.
 */
export function rememberSignupUtm(params, storage) {
    const fromPage = readSignupUtm(params);
    try {
        if (fromPage) {
            storage?.setItem(STORAGE_KEY, JSON.stringify(fromPage));
            return fromPage;
        }
        const saved = storage?.getItem(STORAGE_KEY);
        return saved ? readSignupUtm(JSON.parse(saved)) : null;
    } catch {
        return fromPage;
    }
}

/** `utm` as `&key=value` pairs to append to a query string, or ''. */
export function signupUtmQuery(utm) {
    return utm ? `&${new URLSearchParams(utm).toString()}` : '';
}
