// METADATA // {"ai-commented":{"service":"xai"}}
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
* Represents an error that occurs within the Driver system of Puter.
* This class provides a structured way to handle, report, and serialize errors
* originating from various drivers or backend services in Puter.
* @class DriverError
*/
class DriverError {
    static create (source) {
        return new DriverError({ source });
    }
    constructor ({ source, message }) {
        this.source = source;
        this.message = source?.message || message;
    }


    /**
    * Serializes the DriverError instance into a standardized object format.
    * @returns {Object} An object with keys '$' for type identification and 'message' for error details.
    * @note The method uses a custom type identifier for compatibility with Puter's error handling system.
    */
    serialize () {
        return {
            $: 'heyputer:api/DriverError',
            message: this.message,
        };
    }
}

module.exports = {
    DriverError
};
