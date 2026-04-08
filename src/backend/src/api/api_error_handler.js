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
const APIError = require('./APIError');
const REDACTED_BODY_KEYS = new Set(['thumbnail', 'thumbnailData', 'base64']);
const MAX_LOG_STRING_LENGTH = 2048;

const sanitizeAlarmBody = (value, key, seen = new WeakSet()) => {
    if ( value === null || value === undefined ) {
        return value;
    }

    if ( typeof value === 'string' ) {
        const isRedactedKey = typeof key === 'string' && REDACTED_BODY_KEYS.has(key);
        const isDataUrl = value.startsWith('data:');
        if ( isRedactedKey || isDataUrl ) {
            return `[redacted:${value.length}]`;
        }

        if ( value.length > MAX_LOG_STRING_LENGTH ) {
            return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated:${value.length}]`;
        }
        return value;
    }

    if ( typeof value !== 'object' ) {
        return value;
    }

    if ( seen.has(value) ) {
        return '[circular]';
    }
    seen.add(value);

    if ( Array.isArray(value) ) {
        return value.map((item) => sanitizeAlarmBody(item, key, seen));
    }

    const output = {};
    for ( const [entryKey, entryValue] of Object.entries(value) ) {
        output[entryKey] = sanitizeAlarmBody(entryValue, entryKey, seen);
    }
    return output;
};

/**
 * api_error_handler() is an express error handler for API errors.
 * It adheres to the express error handler signature and should be
 * used as the last middleware in an express app.
 *
 * Since Express 5 is not yet released, this function is used by
 * eggspress() to handle errors instead of as a middleware.
 *
 * @todo remove this function and use express error handling
 * when Express 5 is released
 *
 * @param {*} err
 * @param {*} req
 * @param {*} res
 * @param {*} next
 * @returns
 */
module.exports = function (err, req, res, next) {
    if ( res.headersSent ) {
        console.error('error after headers were sent:', err);
        return next(err);
    }

    // API errors might have a response to help the
    // developer resolve the issue.
    if ( err instanceof APIError ) {
        return err.write(res);
    }

    if (
        typeof err === 'object' &&
        !(err instanceof Error) &&
        Object.prototype.hasOwnProperty.call(err, 'message')
    ) {
        const apiError = APIError.create(400, err);
        return apiError.write(res);
    }

    console.error('internal server error:', err);

    const services = globalThis.services;
    if ( services && services.has('alarm') ) {
        const alarm = services.get('alarm');
        alarm.create('api_error_handler', err.message, {
            error: err,
            url: req.url,
            method: req.method,
            body: sanitizeAlarmBody(req.body, undefined),
            headers: req.headers,
        });
    }

    req.__error_handled = true;

    // Other errors should provide as little information
    // to the client as possible for security reasons.
    return res.send(500, 'Internal Server Error');
};
