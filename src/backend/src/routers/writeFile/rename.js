const mime = require('mime-types');
const { validate_fsentry_name } = require("../../helpers");
const { DB_WRITE } = require('../../services/database/consts');

module.exports = async function writeFile_handle_rename ({
    req, res, node,
}) {
    const new_name = req.body.new_name;

    try {
        validate_fsentry_name(new_name);
    } catch(e) {
        return res.status(400).send({
            error:{
                message: e.message
            }
        });
    }
    
    if ( await node.get('immutable') ) {
        return res.status(400).send({
            error:{
                message: 'Immutable: cannot rename.'
            }
        })
    }
    
    if ( await node.isUserDirectory() || await node.isRoot ) {
        return res.status(403).send({
            error:{
                message: 'Not allowed to rename this item via writeFile.'
            }
        })
    }
    
    const old_path = await node.get('path');
    
    const db = req.services.get('database').get(DB_WRITE, 'writeFile:rename');
    const mysql_id = await node.get('mysql-id');
    await db.write(
        `UPDATE fsentries SET name = ? WHERE id = ?`,
        [new_name, mysql_id]
    );

    const contentType = mime.contentType(req.body.new_name)
    const return_obj = {
        ...await node.getSafeEntry(),
        old_path,
        type: contentType ? contentType : null,
        original_client_socket_id: req.body.original_client_socket_id,
    };
    
    return res.send(return_obj);
}
