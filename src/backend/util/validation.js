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
        if (required) throw new HttpError(400, `Missing \`${key}\``);
        return value;
    }
    if (typeof value !== 'string') {
        throw new HttpError(400, `\`${key}\` must be a string`);
    }
    if (!allowEmpty && value.length === 0) {
        throw new HttpError(400, `\`${key}\` must not be empty`);
    }
    if (maxLen && value.length > maxLen) {
        throw new HttpError(
            400,
            `\`${key}\` must be at most ${maxLen} characters`,
        );
    }
    if (regex && !regex.test(value)) {
        throw new HttpError(400, `\`${key}\` has an invalid format`);
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
        if (required) throw new HttpError(400, `Missing \`${key}\``);
        return value;
    }
    validateString(value, { key, maxLen, required });
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new HttpError(400, `\`${key}\` must be a valid URL`);
    }
    if (!protocols.includes(parsed.protocol)) {
        throw new HttpError(
            400,
            `\`${key}\` must use one of the following protocols: ${protocols.join(', ')}`,
        );
    }
    return value;
}

export function validateBool(value, { key, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) throw new HttpError(400, `Missing \`${key}\``);
        return value;
    }
    return Boolean(value);
}

export function validateJsonObject(value, { key, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) throw new HttpError(400, `Missing \`${key}\``);
        return value;
    }
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            throw new HttpError(400, `\`${key}\` must be valid JSON`);
        }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, `\`${key}\` must be an object`);
    }
    return value;
}

export function validateArrayOfStrings(value, { key, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) throw new HttpError(400, `Missing \`${key}\``);
        return value;
    }
    if (!Array.isArray(value)) {
        throw new HttpError(400, `\`${key}\` must be an array`);
    }
    for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
            throw new HttpError(400, `\`${key}[${i}]\` must be a string`);
        }
    }
    return value;
}
