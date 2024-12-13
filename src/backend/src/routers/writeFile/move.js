const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const { HLMove } = require("../../filesystem/hl_operations/hl_move");
const { validate_signature_auth } = require("../../helpers");

module.exports = async function writeFile_handle_move ({
    req, res, actor, node,
}) {
    // check if destination_write_url provided
    if(!req.body.destination_write_url){
        return res.status(400).send({
            error:{
                message: 'No destination specified.'
            }
        })
    }

    // check if destination_write_url is valid
    try{
        validate_signature_auth(req.body.destination_write_url, 'write');
    }catch(e){
        return res.status(403).send(e);
    }

    const hl_move = new HLMove();

    // TODO: [fs:operation:param-coercion]
    const dest_node = await (new FSNodeParam('dest_path')).consolidate({
        req, getParam: () => req.body.dest_path ?? req.body.destination_uid
    });

    const opts = {
        user: actor.type.user,
        source: node,
        destination_or_parent: dest_node,
        overwrite: req.body.overwrite ?? false,
        new_name: req.body.new_name,
        new_metadata: req.body.new_metadata,
        create_missing_parents: req.body.create_missing_parents,
    };

    const r = await hl_move.run({
        ...opts,
        actor,
    });

    return res.send({
        ...r.moved,
        old_path: r.old_path,
        new_path: r.moved.path,
    });
}
