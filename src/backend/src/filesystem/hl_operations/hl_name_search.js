const { DB_READ } = require("../../services/database/consts");
const { Context } = require("../../util/context");
const { NodeUIDSelector } = require("../node/selectors");
const { HLFilesystemOperation } = require("./definitions");

class HLNameSearch extends HLFilesystemOperation {
    async _run () {
        let { actor, term } = this.values;
        const services = Context.get('services');
        const svc_fs = services.get('filesystem');
        const db = services.get('database')
            .get(DB_READ, 'fs.namesearch');

        term = term.replace(/%/g, '');
        term = '%' + term + '%';
        
        // Only user actors can do this, because the permission
        // system would otherwise slow things down
        if ( ! actor.type.user ) return [];

        const results = await db.read(
            `SELECT uuid FROM fsentries WHERE name LIKE ? AND ` +
            `user_id = ? LIMIT 50`,
            [term, actor.type.user.id]
        );
        
        const uuids = results.map(v => v.uuid);
        
        const fsnodes = await Promise.all(uuids.map(async uuid => {
            return await svc_fs.node(new NodeUIDSelector(uuid));
        }));

        return Promise.all(fsnodes.map(async fsnode => {
            return await fsnode.getSafeEntry();
        }));
    }
}

module.exports = {
    HLNameSearch,
};
