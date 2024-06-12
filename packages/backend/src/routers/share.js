const express = require('express');
const { Endpoint } = require('../util/expressutil');

const validator = require('validator');
const APIError = require('../api/APIError');
const { get_user } = require('../helpers');
const { Context } = require('../util/context');
const auth2 = require('../middleware/auth2');
const config = require('../config');

const { PermissionUtil } = require('../services/auth/PermissionService');

const uuidv4 = require('uuid').v4;

const router = express.Router();
router.use(auth2);

Endpoint({
    route: '/file-by-username',
    methods: ['POST'],
    handler: async (req, res) => {
        const svc_token = req.services.get('token');
        const svc_email = req.services.get('email');
        const svc_permission = req.services.get('permission');

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

        const recipient = await get_user({ username });
        if ( ! recipient ) {
            throw APIError.create('user_does_not_exist', null, {
                username
            });
        }

        await svc_permission.grant_user_user_permission(
            actor, username,
            PermissionUtil.join('fs', path, access_level),
            {}, {},
        );

        if ( path.startsWith('/') ) path = path.slice(1);
        const link = `${config.origin}/show/${path}`;

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
        
        res.send({});
    },
}).attach(router);

module.exports = router;
