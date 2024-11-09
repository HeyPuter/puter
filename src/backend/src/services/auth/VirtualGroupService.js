const BaseService = require("../BaseService");

class VirtualGroupService extends BaseService {
    _construct () {
        this.groups_ = {};
        this.membership_implicators_ = [];
    }
    
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
