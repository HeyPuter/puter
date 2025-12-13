// METADATA // {"ai-commented":{"service":"claude"}}
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
const BaseService = require('./BaseService');

/**
* RegistrantService class handles the registration and initialization of property types and object mappings
* in the system registry. It extends BaseService and provides functionality to populate the registry with
* property types and their mappings, ensuring type validation and proper inheritance relationships.
* @extends BaseService
*/
class RegistrantService extends BaseService {
    /**
     * If population fails, marks the system as invalid through system validation.
     */
    async _init () {
        // Legacy OM registration removed; keep service for compatibility.
        const svc_systemValidation = this.services.get('system-validation');
        svc_systemValidation.mark_valid?.('om-registration-skipped');
    }
    /**
    * Initializes the registrant service by populating the registry.
    * Attempts to populate the registry with property types and mappings.
    * If population fails, an error is thrown
    * @throws {Error} Propagates any errors from registry population for system validation
    * @returns {Promise<void>}
    */
    async _populate_registry () {
        // OM has been removed; nothing to populate.
    }
}

module.exports = {
    RegistrantService,
};
