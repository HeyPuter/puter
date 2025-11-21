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
 * This middleware checks the subdomain, and if the subdomain doesn't
 * match it calls `next('route')` to skip the current route.
 * Be sure to use this before any middleware that might erroneously
 * block the request.
 *
 * @param {string|string[]} allowedSubdomains - The subdomain to allow;
 *    if an array, any of the subdomains in the array will be allowed.
 *
 * @returns {function} - An express middleware function
 */
const subdomain = allowedSubdomains => {
    if ( ! Array.isArray(allowedSubdomains) ) {
        allowedSubdomains = [allowedSubdomains];
    }
    return async (req, res, next) => {
        // Note: at the time of implementing this, there is a config
        // option called `experimental_no_subdomain` that is designed
        // to lie and tell us the subdomain is `api` when it's not.
        const actual_subdomain = require('../helpers').subdomain(req);
        if ( ! allowedSubdomains.includes(actual_subdomain) ) {
            next('route');
            return;
        }

        next();
    };
};

module.exports = subdomain;
