const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { HLCopy } = require('../../filesystem/hl_operations/hl_copy');
const { validate_signature_auth } = require('../../helpers');

module.exports = async function writeFile_handle_copy ({
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
        console.log('REALLY THIS ONE')
        return res.status(403).send(e);
    }

    const overwrite      = req.body.overwrite ?? false;
    const change_name    = req.body.auto_rename ?? false;

    // TODO: [fs:operation:param-coercion]
    const dest_node = await (new FSNodeParam('dest_path')).consolidate({
        req, getParam: () => req.body.dest_path ?? req.body.destination_uid
    });

    // Get user
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
