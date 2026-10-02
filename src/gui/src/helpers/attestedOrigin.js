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

// Same allow-list the backend enforces in util/validation.js (separate bundles).
const ATTESTED_PROTOCOLS = [
    'http:',
    'https:',
    'chrome-extension:',
    'moz-extension:',
    'safari-extension:',
    'safari-web-extension:',
];

/**
 * Whether an origin names something an app can be identified by — false for
 * the `"null"` and `"file://"` of a sandboxed iframe or a local page.
 *
 * @param {string|null|undefined} origin - An origin string, or any URL on it.
 * @returns {boolean}
 */
export function isAttestedOrigin(origin) {
    if ( typeof origin !== 'string' || ! origin ) return false;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch (e) {
        return false;
    }
    // `new URL()` accepts the extension schemes with no authority at all.
    return ATTESTED_PROTOCOLS.includes(parsed.protocol) && !! parsed.hostname;
}

export default isAttestedOrigin;
