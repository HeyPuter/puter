const APIError = require("../../api/APIError");
const { PermissionUtil } = require("../auth/PermissionService");
const BaseService = require("../BaseService");

// DO WE HAVE enough information to get the policy for the newer drivers?
// - looks like it: service:<name of service>:<name of trait>

class DriverUsagePolicyService extends BaseService {
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
    
    async select_best_option_ (options) {
        return options[0];
    }

    // TODO: DRY: This is identical to the method of the same name in
    // DriverService, except after the line with a comment containing
    // the string "[DEVIATION]".
    async get_effective_policy ({ actor, service_name, trait_name }) {
        const svc_permission = this.services.get('permission');
        const reading = await svc_permission.scan(
            actor,
            PermissionUtil.join('service', service_name, 'ii', trait_name),
        );
        console.log({
            perm: PermissionUtil.join('service', service_name, 'ii', trait_name),
            reading: require('util').inspect(reading, { depth: null }),
        });
        const options = PermissionUtil.reading_to_options(reading);
        console.log('OPTIONS', JSON.stringify(options, undefined, '  '));
        if ( options.length <= 0 ) {
            return undefined;
        }
        const option = await this.select_best_option_(options);
        const policies = await this.get_policies_for_option_(option);
        console.log('SLA', JSON.stringify(policies, undefined, '  '));
        
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
