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

const BaseService = require("../BaseService");


/**
* Class representing a VirtualGroupService.
* This service extends the BaseService and provides methods to manage virtual groups,
* allowing for the registration of membership implicators and the retrieval of virtual group data.
*/
class VirtualGroupService extends BaseService {
    _construct () {
        this.groups_ = {};
        this.membership_implicators_ = [];
    }
    
    /**
     * Registers a function that reports one or more groups that an actor
     * should be considered a member of.
     * 
     * @note this only applies to virtual groups, not persistent groups.
     * 
     * @param {*} implicator 
     */
    register_membership_implicator (implicator) {
        this.membership_implicators_.push(implicator);
    }
    
    add_group (group) {
        this.groups_[group.id] = group;
    }
    
    /**
    * Retrieves a list of virtual groups based on the provided actor,
    * utilizing registered membership implicators to determine group membership.
    * 
    * @param {Object} params - The parameters object.
    * @param {Object} params.actor - The actor to check against the membership implicators.
    * @returns {Array} An array of virtual group objects that the actor is a member of.
    */
    get_virtual_groups ({ actor }) {
        const groups_set = {};
        
        for ( const implicator of this.membership_implicators_ ) {
            const groups = implicator.run({ actor });
            for ( const group of groups ) {
                groups_set[group] = true;
            }
        }
        
        const groups = Object.keys(groups_set).map(
            id => this.groups_[id]);
        
        return groups;
    }
}

module.exports = { VirtualGroupService };
