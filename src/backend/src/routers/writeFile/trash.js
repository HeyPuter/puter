const { HLMove } = require("../../filesystem/hl_operations/hl_move");
const { NodePathSelector } = require("../../filesystem/node/selectors");

module.exports = async function writeFile_handle_trash ({
    req, res, actor, node,
}) {
    // metadata for trashed file
    const new_name = await node.get('uid');
    const metadata = {
        original_name: await node.get('name'),
        original_path: await node.get('path'),
        trashed_ts: Math.round(Date.now() / 1000),
    };

    // Get Trash fsentry
    const fs = req.services.get('filesystem');
    const trash = await fs.node(
        new NodePathSelector('/' + actor.type.user.username + '/Trash')
    );

    // No Trash?
    if(!trash){
        return res.status(400).send({
            error:{
                message: 'No Trash directory found.'
            }
        })
    }

    const hl_move = new HLMove();
    await hl_move.run({
        source: node,
        destination_or_parent: trash,
        user: actor.type.user,
        actor,
        new_name: new_name,
        new_metadata: metadata,
    });


    return res.status(200).send({
        message: 'Item trashed'
    })
};
