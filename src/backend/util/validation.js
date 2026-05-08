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

import { HttpError } from '../core/http/HttpError.js';

/**
 * Small input validation utilities for driver methods.
 * Throws HttpError(400, ...) on failure. Returns the value on success.
 */

export function validateString(
    value,
    { key, maxLen, regex, required = true, allowEmpty = false } = {},
) {
    if (value === undefined || value === null) {
        if (required)
            throw new HttpError(400, `Missing \`${key}\``, {
                legacyCode: 'bad_request',
            });
        return value;
    }
    if (typeof value !== 'string') {
        throw new HttpError(400, `\`${key}\` must be a string`, {
            legacyCode: 'bad_request',
        });
    }
    if (!allowEmpty && value.length === 0) {
        throw new HttpError(400, `\`${key}\` must not be empty`, {
            legacyCode: 'bad_request',
        });
    }
    if (maxLen && value.length > maxLen) {
        throw new HttpError(
            400,
            `\`${key}\` must be at most ${maxLen} characters`,
            { legacyCode: 'bad_request' },
        );
    }
    if (regex && !regex.test(value)) {
        throw new HttpError(400, `\`${key}\` has an invalid format`, {
            legacyCode: 'bad_request',
        });
    }
    return value;
}

export function validateUrl(
    value,
    {
        key,
        maxLen = 3000,
        required = true,
        // Default allowlist is http(s) only — anything else is an XSS/SSRF
        // primitive when the value is later consumed as `iframe.src`,
        // `window.location`, a server-side fetch, etc. `new URL()` alone
        // happily parses `javascript:alert(1)`, `data:text/html,…`,
        // `file:///etc/passwd`, and `vbscript:`; callers that need
        // something exotic must opt in explicitly.
        protocols = ['http:', 'https:'],
    } = {},
) {
    if (value === undefined || value === null) {
        if (required)
            throw new HttpError(400, `Missing \`${key}\``, {
                legacyCode: 'bad_request',
            });
        return value;
    }
    validateString(value, { key, maxLen, required });
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new HttpError(400, `\`${key}\` must be a valid URL`, {
            legacyCode: 'bad_request',
        });
    }
    if (!protocols.includes(parsed.protocol)) {
        throw new HttpError(
            400,
            `\`${key}\` must use one of the following protocols: ${protocols.join(', ')}`,
            { legacyCode: 'bad_request' },
        );
    }
    return value;
}

export function validateBool(value, { key, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required)
            throw new HttpError(400, `Missing \`${key}\``, {
                legacyCode: 'bad_request',
            });
        return value;
    }
    return Boolean(value);
}

export function validateJsonObject(value, { key, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required)
            throw new HttpError(400, `Missing \`${key}\``, {
                legacyCode: 'bad_request',
            });
        return value;
    }
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            throw new HttpError(400, `\`${key}\` must be valid JSON`, {
                legacyCode: 'bad_request',
            });
        }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, `\`${key}\` must be an object`, {
            legacyCode: 'bad_request',
        });
    }
    return value;
}

export function validateArrayOfStrings(value, { key, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required)
            throw new HttpError(400, `Missing \`${key}\``, {
                legacyCode: 'bad_request',
            });
        return value;
    }
    if (!Array.isArray(value)) {
        throw new HttpError(400, `\`${key}\` must be an array`, {
            legacyCode: 'bad_request',
        });
    }
    for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
            throw new HttpError(400, `\`${key}[${i}]\` must be a string`, {
                legacyCode: 'bad_request',
            });
        }
    }
    return value;
}
