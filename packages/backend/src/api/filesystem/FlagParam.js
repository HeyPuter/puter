/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const APIError = require('../../api/APIError');

module.exports = class FlagParam {
    constructor (srckey, options) {
        this.srckey = srckey;
        this.options = options ?? {};
        this.optional = this.options.optional ?? false;
        this.default = this.options.default ?? false;
    }

    async consolidate ({ req, getParam }) {
        const log = globalThis.services.get('log-service').create('flag-param');

        const value = getParam(this.srckey);
        if ( value === undefined || value === '' ) {
            if ( this.optional ) return this.default;
            throw APIError.create('field_missing', null, {
                key: this.srckey,
            });
        }

        if ( typeof value === 'string' ) {
            if (
                value === 'true' || value === '1' || value === 'yes'
            ) return true;

            if (
                value === 'false' || value === '0' || value === 'no'
            ) return false;

            throw APIError.create('field_invalid', null, {
                key: this.srckey,
                expected: 'boolean',
            });
        }

        if ( typeof value === 'boolean' ) {
            return value;
        }

        log.debug('tried boolean', { value })
        throw APIError.create('field_invalid', null, {
            key: this.srckey,
            expected: 'boolean',
        });
    }
}
