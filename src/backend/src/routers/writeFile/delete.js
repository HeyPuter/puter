const { HLRemove } = require("../../filesystem/hl_operations/hl_remove");

module.exports = async function writeFile_handle_delete ({
    req, res, actor, node,
}) {
    // Delete
    const hl_remove = new HLRemove();
    await hl_remove.run({
        target: node,
        user: actor.type.user,
        actor,
    });

    // Send success msg
    return res.send();
}

