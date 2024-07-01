const { RootNodeSelector, NodeChildSelector } = require("../node/selectors");
const { LLFilesystemOperation } = require("./definitions");

class LLListUsers extends LLFilesystemOperation {
    static description = `
        List user directories which are relevant to the
        current actor.
    `;
    
    async _run () {
        const { context } = this;
        const svc = context.get('services');
        const svc_permission = svc.get('permission');
        const svc_fs = svc.get('filesystem');

        const user = this.values.user;
        const issuers = await svc_permission.list_user_permission_issuers(user);

        const nodes = [];
        
        nodes.push(await svc_fs.node(new NodeChildSelector(
            new RootNodeSelector(),
            user.username,
        )));

        for ( const issuer of issuers ) {
            const node = await svc_fs.node(new NodeChildSelector(
                new RootNodeSelector(),
                issuer.username));
            nodes.push(node);
        }
        
        return nodes;
    }
}

module.exports = {
    LLListUsers,
};
