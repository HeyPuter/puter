// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
const BaseService = require("../BaseService");


/**
* Class representing a VirtualGroupService.
* This service extends the BaseService and provides methods to manage virtual groups,
* allowing for the registration of membership implicators and the retrieval of virtual group data.
*/
class VirtualGroupService extends BaseService {
    /**
    * Retrieves a list of virtual groups based on the provided actor,
    * utilizing registered membership implicators to determine group membership.
    * 
    * @param {Object} params - The parameters object.
    * @param {Object} params.actor - The actor to check against the membership implicators.
    * @returns {Array} An array of virtual group objects that the actor is a member of.
    */
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
