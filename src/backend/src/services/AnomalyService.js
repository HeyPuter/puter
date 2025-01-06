// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const BaseService = require("./BaseService");

// Symbol used to indicate a denial of service instruction in anomaly handling.
const DENY_SERVICE_INSTRUCTION = Symbol('DENY_SERVICE_INSTRUCTION');


/**
* @class AnomalyService
* @extends BaseService
* @description The AnomalyService class is responsible for managing and processing anomaly detection types and configurations.
* It allows the registration of different types with associated handlers, enabling the detection of anomalies based on specified criteria.
*/
class AnomalyService extends BaseService {
    /**
    * AnomalyService class that extends BaseService and provides methods
    * for registering anomaly types and handling incoming data for those anomalies.
    * 
    * The register method allows the registration of different anomaly types 
    * and their respective configurations, including custom handlers for data 
    * evaluation. It supports two modes of operation: a direct handler or 
    * a threshold-based evaluation.
    */
    _construct () {
        this.types = {};
    }
    /**
     * Registers a new type with the service, including its configuration and handler.
     * 
     * @param {string} type - The name of the type to register.
     * @param {Object} config - The configuration object for the type.
     * @param {Function} [config.handler] - An optional handler function for the type.
     * @param {number} [config.high] - An optional threshold value; triggers the handler if exceeded.
     * 
     * @returns {void}
     */
    register (type, config) {
        const type_instance = {
            config,
        }
        if ( config.handler ) {
            type_instance.handler = config.handler;
        } else if ( config.high ) {
            type_instance.handler = data => {
                if ( data.value > config.high ) {
                    return new Set([DENY_SERVICE_INSTRUCTION]);
                }
            }
        }
        this.types[type] = type_instance;
    }
    /**
     * Creates a note of the specified type with the provided data.
     * See `groups_user_hour` in GroupService for an example.
     * 
     * @param {*} id - The identifier of the type to create a note for.
     * @param {*} data - The data to process with the type's handler.
     * @returns 
     */
    async note (id, data) {
        const type = this.types[id];
        if ( ! type ) return;
        
        return type.handler(data);
    }
}

module.exports = {
    AnomalyService,
    DENY_SERVICE_INSTRUCTION,
};
