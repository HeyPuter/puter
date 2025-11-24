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
const APIError = require('../../../api/APIError.js');

/**
 * api_error_handler() is an express error handler for API errors.
 * It adheres to the express error handler signature and should be
 * used as the last middleware in an express app.
 *
 * Since Express 5 is not yet released, this function is used by
 * eggspress() to handle errors instead of as a middleware.
 *
 * @param {*} err
 * @param {*} req
 * @param {*} res
 * @param {*} next
 * @returns
 */
module.exports = function api_error_handler (err, req, res, next) {
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
        err.hasOwnProperty('message')
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
            body: req.body,
            headers: req.headers,
        });
    }

    req.__error_handled = true;

    // Other errors should provide as little information
    // to the client as possible for security reasons.
    return res.send(500, 'Internal Server Error');
};
