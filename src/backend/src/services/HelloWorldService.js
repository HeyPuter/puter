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

// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
const BaseService = require("./BaseService");


/**
* @class HelloWorldService
* @extends BaseService
* @description This class extends the BaseService and provides methods to get the version
* of the service and to generate a greeting message. The greeting message can be personalized
* based on the input subject.
*/
class HelloWorldService extends BaseService {
    static IMPLEMENTS = {
        ['version']: {
            /**
            * Returns the current version of the service.
            *
            * @returns {string} The version string.
            */
            get_version () {
                return 'v1.0.0';
            }
        },
        ['hello-world']: {
            /**
            * Greets the user with a customizable message.
            *
            * @param {Object} options - The options object.
            * @param {string} [options.subject] - The subject of the greeting. If not provided, defaults to "World".
            * @returns {string} The greeting message.
            */
            async greet ({ subject }) {
                if ( subject ) {
                    return `Hello, ${subject}!`;
                }
                return `Hello, World!`;
            }
        },
    }
}

module.exports = { HelloWorldService };
