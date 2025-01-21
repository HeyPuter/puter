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

// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
const { PermissionUtil } = require("../auth/PermissionService");
const BaseService = require("../BaseService");

// DO WE HAVE enough information to get the policy for the newer drivers?
// - looks like it: service:<name of service>:<name of trait>


/**
* Class representing the DriverUsagePolicyService.
* This service manages the retrieval and application of usage policies
* for drivers, handling permission checks and policy interpretation
* using the provided service architecture.
*/
class DriverUsagePolicyService extends BaseService {
    /**
    * Retrieves the usage policies for a given option.
    * 
    * This method takes an option containing a path and returns the corresponding
    * policies. Note that the implementation is not final and may include cascading
    * monthly usage logic in the future.
    * 
    * @param {Object} option - The option for which policies are to be retrieved.
    * @param {Array} option.path - The path representing the request to get policies.
    * @returns {Promise<Array>} A promise that resolves to the policies associated with the given option.
    */
    async get_policies_for_option_ (option) {
        // NOT FINAL: before implementing cascading monthly usage,
        // this return will be removed and the code below it will
        // be uncommented
        return option.path;
        /*
        const svc_systemData = this.services.get('system-data');
        const svc_su = this.services.get('su');
        
        const policies = await Promise.all(option.path.map(async path_node => {
            const policy = await svc_su.sudo(async () => {
                return await svc_systemData.interpret(option.data);
            });
            return {
                ...path_node,
                policy,
            };
        }));
        return policies;
        */
    }
    

    /**
     * Selects the best option from the provided list of options.
     * 
     * This method assumes that the options array is not empty and will 
     * return the first option found. It does not perform any sorting 
     * or decision-making beyond this.
     *
     * @param {Array} options - An array of options to select from.
     * @returns {Object} The best option from the provided list.
     */
    async select_best_option_ (options) {
        return options[0];
    }

    // TODO: DRY: This is identical to the method of the same name in
    // DriverService, except after the line with a comment containing
    // the string "[DEVIATION]".
    /**
    * Retrieves the effective policy for a given actor, service name, and trait name.
    * This method checks for permissions associated with the provided actor and then generates 
    * a list of policies based on the permissions read. If no policies are found, it returns 
    * `undefined`. Otherwise, it selects the best option and retrieves the corresponding 
    * policies.
    *
    * @param {Object} parameters - The parameters for the method.
    * @param {string} parameters.actor - The actor for which the policy is being requested.
    * @param {string} parameters.service_name - The name of the service to which the policy applies.
    * @param {string} parameters.trait_name - The name of the trait for which the effective policy is needed.
    * @returns {Object|undefined} - Returns the effective policy object or `undefined` if no policies are available.
    */
    async get_effective_policy ({ actor, service_name, trait_name }) {
        const svc_permission = this.services.get('permission');
        const reading = await svc_permission.scan(
            actor,
            PermissionUtil.join('service', service_name, 'ii', trait_name),
        );
        const options = PermissionUtil.reading_to_options(reading);
        if ( options.length <= 0 ) {
            return undefined;
        }
        const option = await this.select_best_option_(options);
        const policies = await this.get_policies_for_option_(option);
        
        // NOT FINAL: For now we apply monthly usage logic
        // to the first holder of the permission. Later this
        // will be changed so monthly usage can cascade across
        // multiple actors. I decided not to implement this
        // immediately because it's a hefty time sink and it's
        // going to be some time before we can offer this feature
        // to the end-user either way.
        
        let effective_policy = null;
        for ( const policy of policies ) {
            if ( policy.holder ) {
                effective_policy = policy;
                break;
            }
        }

        // === [DEVIATION] In DriverService, this is part of call_new_ ===
        const svc_systemData = this.services.get('system-data');
        const svc_su = this.services.get('su');
        /**
        * Retrieves and interprets the effective policy for a given holder.
        * Utilizes system data and super-user privileges to interpret the policy data.
        * 
        * @param {Object} effective_policy - The policy object for the current holder.
        * @returns {Promise<Object>} - The interpreted policy object after applying the necessary logic.
        */
        effective_policy = await svc_su.sudo(async () => {
            return await svc_systemData.interpret(effective_policy.data);
        });
        
        effective_policy = effective_policy.policy;

        return effective_policy;
    }
}

module.exports = {
    DriverUsagePolicyService,
};
