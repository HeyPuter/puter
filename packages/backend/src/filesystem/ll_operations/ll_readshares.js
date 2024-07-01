const { Context } = require("../../util/context");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { LLFilesystemOperation } = require("./definitions");
const { LLReadDir } = require("./ll_readdir");

class LLReadShares extends LLFilesystemOperation {
    static description = `
        Obtain the highest-level entries under this directory
        for which the current actor has at least "see" permission.
        
        This is a breadth-first search. When any node is
        found with "see" permission is found, children of that node
        will not be traversed.
    `;
    
    async _run () {
        const results = [];
        await this.recursive_part(results, this.values);
        
        return results;
    }
    
    async recursive_part (results, { subject, user, actor }) {
        actor = actor || Context.get('actor');
        const ll_readdir = new LLReadDir();
        const children = await ll_readdir.run({
            subject, user,
            no_thumbs: true,
            no_assocs: true,
            no_acl: true,
        });
        
        const svc = Context.get('services');
        const svc_acl = svc.get('acl');
        
        const promises = [];
        
        for ( const child of children ) {
            // If we have at least see permission: terminal node
            const acl_result = await svc_acl.check(actor, child, 'see');
            console.log(
                '\x1B[31;1mWHAT DIS?\x1B[0m',
                actor,
                child.entry?.path,
                child.selectors_[0].describe(),
                acl_result,
            )
            if ( acl_result ) {
                results.push(child);
                continue;
            }
            
            if ( await child.get('type') !== TYPE_DIRECTORY ) {
                continue;
            }
            
            const p = this.recursive_part(results, {
                subject: child, user });
            promises.push(p);
        }
        
        await Promise.all(promises);
    }
}

module.exports = {
    LLReadShares,
};
