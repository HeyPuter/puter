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
const { Mapping } = require("../om/definitions/Mapping");
const { PropType } = require("../om/definitions/PropType");
const { Context } = require("../util/context");
const BaseService = require("./BaseService");


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
        const svc_systemValidation = this.services.get('system-validation');
        try {
            await this._populate_registry();
        } catch ( e ) {
            svc_systemValidation.mark_invalid(
                'Failed to populate registry',
                e,
            );
        }
    }
    /**
    * Initializes the registrant service by populating the registry.
    * Attempts to populate the registry with property types and mappings.
    * If population fails, an error is thrown
    * @throws {Error} Propagates any errors from registry population for system validation
    * @returns {Promise<void>}
    */
    async _populate_registry () {
        const svc_registry = this.services.get('registry');

        // This context will be provided to the `create` methods
        // that transform the raw data into objects.
        /**
        * Populates the registry with property types and object mappings.
        * Loads property type definitions and mappings from configuration files,
        * validates them for duplicates and dependencies, and registers them
        * in the registry service.
        * 
        * @throws {Error} If duplicate property types are found or if a property type
        *                 references an undefined super type
        * @private
        */
        const ctx = Context.get().sub({
            registry: svc_registry,
        });

        // Register property types
        {
            const seen = new Set();

            const collection = svc_registry.register_collection('om:proptype');
            const data = require('../om/proptypes/__all__');
            for ( const k in data ) {
                if ( seen.has(k) ) {
                    throw new Error(`Duplicate property type "${k}"`);
                }
                if ( data[k].from && ! seen.has(data[k].from) ) {
                    throw new Error(`Super type "${data[k].from}" not found for property type "${k}"`);
                }
                collection.set(k, PropType.create(ctx, data[k], k));
                seen.add(k);
            }
        }

        // Register object mappings
        {
            const collection = svc_registry.register_collection('om:mapping');
            const data = require('../om/mappings/__all__');
            for ( const k in data ) {
                collection.set(k, Mapping.create(ctx, data[k]));
            }
        }
    }
}

module.exports = {
    RegistrantService,
};
