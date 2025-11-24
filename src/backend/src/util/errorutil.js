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
const log_http_error = e => {
    console.log(`\x1B[31;1m${ e.message }\x1B[0m`);

    console.log('HTTP Method: ', e.config.method.toUpperCase());
    console.log('URL: ', e.config.url);

    if ( e.config.params ) {
        console.log('URL Parameters: ', e.config.params);
    }

    if ( e.config.method.toLowerCase() === 'post' && e.config.data ) {
        console.log('Post body: ', e.config.data);
    }

    console.log('Request Headers: ', JSON.stringify(e.config.headers, null, 2));

    if ( e.response ) {
        console.log('Response Status: ', e.response.status);
        console.log('Response Headers: ', JSON.stringify(e.response.headers, null, 2));
        console.log('Response body: ', e.response.data);
    }

    console.log(`\x1B[31;1m${ e.message }\x1B[0m`);
};

const better_error_printer = e => {
    if ( e.request ) {
        log_http_error(e);
        return;
    }

    console.error(e);
};

/**
 * This class is used to wrap an error when the error has
 * already been sent to ErrorService. This prevents higher-level
 * error handlers from sending it to ErrorService again.
 */
class ManagedError extends Error {
    constructor (source, extra = {}) {
        super(source?.message ?? source);
        this.source = source;
        this.name = `Managed(${source?.name ?? 'Error'})`;
        this.extra = extra;
    }
}

module.exports = {
    ManagedError,
    better_error_printer,

    // We export CompositeError from 'composite-error' here
    // in case we want to change the implementation later.
    // i.e. it's under the MIT license so it would be easier
    // to just copy the class to this file than maintain a fork.
    CompositeError: require('composite-error'),
};
