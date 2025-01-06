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

const APIError = require("../../api/APIError");
const BaseService = require("../../services/BaseService");

/**
 * @typedef {Object} ErrorSpec
 * @property {string} code - The error code
 * @property {string} status - HTTP status code
 * @property {function} message - A function that generates an error message
 */

/**
 * The APIErrorService class provides a mechanism for registering and managing
 * error codes and messages which may be sent to clients.
 * 
 * This allows for a single source-of-truth for error codes and messages that
 * are used by multiple services.
 */
class APIErrorService extends BaseService {
    _construct () {
        this.codes = {
            ...this.constructor.codes,
        };
    }

    // Hardcoded error codes from before this service was created
    static codes = APIError.codes;
    
    /**
     * Registers API error codes.
     * 
     * @param {Object.<string, ErrorSpec>} codes - A map of error codes to error specifications
     */
    register (codes) {
        for ( const code in codes ) {
            this.codes[code] = codes[code];
        }
    }
    
    create (code, fields) {
        const error_spec = this.codes[code];
        if ( ! error_spec ) {
            return new APIError(500, 'Missing error message.', null, {
                code,
            });
        }
        
        return new APIError(error_spec.status, error_spec.message, null, {
            ...fields,
            code,
        });
    }
}

module.exports = APIErrorService;
