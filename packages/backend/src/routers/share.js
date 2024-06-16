const express = require('express');
const { Endpoint } = require('../util/expressutil');

const validator = require('validator');
const APIError = require('../api/APIError');
const { get_user } = require('../helpers');
const { Context } = require('../util/context');
const auth2 = require('../middleware/auth2');
const config = require('../config');
const FSNodeParam = require('../api/filesystem/FSNodeParam');
const { TYPE_DIRECTORY } = require('../filesystem/FSNodeContext');

const { PermissionUtil } = require('../services/auth/PermissionService');
const { validate } = require('uuid');
const configurable_auth = require('../middleware/configurable_auth');
const { UsernameNotifSelector } = require('../services/NotificationService');
const { quot } = require('../util/strutil');

const uuidv4 = require('uuid').v4;

const router = express.Router();

const validate_share_fsnode_params = req => {
    let path = req.body.path;
    if ( ! (typeof path === 'string') ) {
        throw APIError.create('field_invalid', null, {
            key: 'path',
            expected: 'string',
            got: typeof path,
        });
    }

    const access_level = req.body.access_level || 'write';
    if ( ! ['read','write'].includes(access_level) ) {
        throw APIError.create('field_invalid', null, {
            key: 'access_level',
            expected: '"read" or "write"',
        });
    }

    const permission = PermissionUtil.join('fs', path, access_level);
    
    return {
        path, access_level, permission,
    };
}

const handler_item_by_username = async (req, res) => {
    const svc_token = req.services.get('token');
    const svc_email = req.services.get('email');
    const svc_permission = req.services.get('permission');
    const svc_notification = req.services.get('notification');

    console.log('which actor exists?',
        req.actor,
        Context.get('actor'))
    const actor = Context.get('actor');

    const username = req.body.username;
    if ( ! (typeof username === 'string') ) {
        throw APIError.create('field_invalid', null, {
            key: 'username',
            expected: 'string',
            got: typeof username,
        });
    }
    
    const { path, permission } =
        validate_share_fsnode_params(req);

    const recipient = await get_user({ username });
    if ( ! recipient ) {
        throw APIError.create('user_does_not_exist', null, {
            username
        });
    }

    await svc_permission.grant_user_user_permission(
        actor, username, permission, {}, {},
    );
    
    const node = await (new FSNodeParam('path')).consolidate({
        req, getParam: () => path
    });
    
    if ( ! await node.exists() ) {
        throw APIError.create('subject_does_not_exist');
    }
    
    let email_path = path;
    let is_dir = true;
    if ( await node.get('type') !== TYPE_DIRECTORY ) {
        is_dir = false;
        // remove last component
        email_path = email_path.slice(0, path.lastIndexOf('/')+1);
    }

    if ( email_path.startsWith('/') ) email_path = email_path.slice(1);
    const link = `${config.origin}/show/${email_path}`;

    const email_values = {
        link,
        susername: req.user.username,
        ...(recipient ? {
            rusername: recipient.username,
        } : {}),
    };

    const email_tmpl = recipient ?
        'share_existing_user' : 'share_new_user';

    await svc_email.send_email({ email: recipient.email }, email_tmpl, email_values);
    
    const wut = is_dir ? 'directory' : 'file';
    svc_notification.notify(UsernameNotifSelector(username), {
        source: 'sharing',
        icon: 'shared.svg',
        title: 'A file was shared with you!',
        template: 'file-shared-with-you',
        fields: {
            username: req.user.username,
            type: wut,
            filename: await node.get('name'),
        },
        text: `The user ${quot(req.user.username)} shared a ${wut} ` +
            `with you called ${quot(await node.get('name'))}`
    });
    
    res.send({});
};

Endpoint({
    // "item" here means a filesystem node
    route: '/item-by-username',
    mw: [configurable_auth()],
    methods: ['POST'],
    handler: handler_item_by_username,
}).attach(router);

module.exports = app => {
    app.use('/share', router);
};
