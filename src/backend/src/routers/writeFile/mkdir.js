const { HLMkdir } = require("../../filesystem/hl_operations/hl_mkdir");
const { NodeUIDSelector } = require("../../filesystem/node/selectors");
const { sign_file } = require("../../helpers");

module.exports = async function writeFile_handle_mkdir ({
    req, res, actor, node
}) {
    if( ! req.body.name ) return res.status(400).send({
        error:{
            message: 'Name is required.'
        }
    })

    const hl_mkdir = new HLMkdir();
    const r = await hl_mkdir.run({
        parent: node,
        path: req.body.name,
        overwrite: false,
        dedupe_name: req.body.dedupe_name ?? false,
        user: actor.type.user,
        actor,
    });

    const svc_fs = req.services.get('filesystem');
    
    const newdir_node = await svc_fs.node(new NodeUIDSelector(r.uid));
    return res.send(await sign_file(await newdir_node.get('entry'), 'write'));
};
