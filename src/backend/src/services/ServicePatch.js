// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const { AdvancedBase } = require("@heyputer/putility");


/**
* Class ServicePatch
* 
* This class extends the AdvancedBase class and provides functionality 
* to apply patches to service methods dynamically. The patching mechanism 
* ensures that the methods defined in the PATCH_METHODS static object 
* are replaced with their respective patch implementations while maintaining 
* a reference to the original service methods for potential fallback or 
* additional processing.
*/
class ServicePatch extends AdvancedBase {
    patch ({ original_service }) {
        const patch_methods = this._get_merged_static_object('PATCH_METHODS');
        for ( const k in patch_methods ) {
            if ( typeof patch_methods[k] !== 'function' ) {
                throw new Error(`Patch method ${k} to ${original_service.service_name} ` +
                    `from ${this.constructor.name} ` +
                    `is not a function.`)
            }

            const patch_method = patch_methods[k];

            const patch_arguments = {
                that: original_service,
                original: original_service[k].bind(original_service),
            };

            original_service[k] = (...a) => {
                return patch_method.call(this, patch_arguments, ...a);
            }
        }
    }
}

module.exports = ServicePatch;
