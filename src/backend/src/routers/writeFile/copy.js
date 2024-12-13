const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { HLCopy } = require('../../filesystem/hl_operations/hl_copy');
const { validate_signature_auth } = require('../../helpers');

module.exports = async function writeFile_handle_copy ({
    api,
    req, res, actor, node,
}) {

    // check if destination_write_url provided

    // check if destination_write_url is valid
    const dest_node = await api.get_dest_node();
    if ( ! dest_node ) return;

    const overwrite      = req.body.overwrite ?? false;
    const change_name    = req.body.auto_rename ?? false;

    const opts = {
        source: node,
        destination_or_parent: dest_node,
        dedupe_name: change_name,
        overwrite,
        user: actor.type.user,
    };

    const hl_copy = new HLCopy();

    const r =  await hl_copy.run({
        ...opts,
        actor,
    });
    return res.send([r]);
}
