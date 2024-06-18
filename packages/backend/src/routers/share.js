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
const { UtilFn } = require('../util/fnutil');
const { WorkList } = require('../util/workutil');
const { whatis } = require('../util/langutil');

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

const v0_1 = async (req, res) => {
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
            files: [
                await node.getSafeEntry(),
            ],
        },
        text: `The user ${quot(req.user.username)} shared a ${wut} ` +
            `with you called ${quot(await node.get('name'))}`
    });
    
    res.send({});
};


const v0_2 = async (req, res) => {
    const svc_token = req.services.get('token');
    const svc_email = req.services.get('email');
    const svc_permission = req.services.get('permission');
    const svc_notification = req.services.get('notification');

    const actor = Context.get('actor');
    
    // === Request Validators ===
    
    const validate_mode = UtilFn(mode => {
        if ( mode === 'strict' ) return true;
        if ( ! mode || mode === 'best-effort' ) return false;
        throw APIError.create('field_invalid', null, {
            key: 'mode',
            expected: '`strict`, `best-effort`, or undefined',
        });
    })
    
    // Expect: an array of usernames and/or emails
    const validate_recipients = UtilFn(recipients => {
        // A string can be adapted to an array of one string
        if ( typeof recipients === 'string' ) {
            recipients = [recipients];
        }
        // Must be an array
        if ( ! Array.isArray(recipients) ) {
            throw APIError.create('field_invalid', null, {
                key: 'recipients',
                expected: 'array or string',
                got: typeof recipients,
            })
        }
        return recipients;
    });
    
    const validate_paths = UtilFn(paths => {
        // Single-values get adapted into an array
        if ( ! Array.isArray(paths) ) {
            paths = [paths];
        }
        return paths;
    })
    
    // === Request Values ===

    const strict_mode =
        validate_mode.if(req.body.mode) ?? false;
    const req_recipients =
        validate_recipients.if(req.body.recipients) ?? [];
    const req_paths =
        validate_paths.if(req.body.paths) ?? [];
        
    // === State Values ===

    const recipients = [];
    const result = {
        // Metadata
        $: 'api:share',
        $version: 'v0.0.0',
        
        // Results
        status: null,
        recipients: Array(req_recipients.length).fill(null),
        paths: Array(req_paths.length).fill(null),
    }
    const recipients_work = new WorkList();
    const fsitems_work = new WorkList();
    
    // const assert_work_item = (wut, item) => {
    //     if ( item.$ !== wut ) {
    //         // This should never happen, so 500 is acceptable here
    //         throw new Error('work item assertion failed');
    //     }
    // }
    
    // === Request Preprocessing ===
    
    // --- Function that returns early in strict mode ---
    const serialize_result = () => {
        for ( let i=0 ; i < result.recipients.length ; i++ ) {
            if ( ! result.recipients[i] ) continue;
            if ( result.recipients[i] instanceof APIError ) {
                result.status = 'mixed';
                result.recipients[i] = result.recipients[i].serialize();
            }
        }
        for ( let i=0 ; i < result.paths.length ; i++ ) {
            if ( ! result.paths[i] ) continue;
            if ( result.paths[i] instanceof APIError ) {
                result.status = 'mixed';
                result.paths[i] = result.paths[i].serialize();
            }
        }
    };
    const strict_check = () =>{
        if ( ! strict_mode ) return;
        console.log('OK');
        if (
            result.recipients.some(v => v !== null) ||
            result.paths.some(v => v !== null)
        ) {
            console.log('DOESNT THIS??')
            serialize_result();
            result.status = 'aborted';
            res.status(218).send(result);
            console.log('HOWW???');
            return true;
        }
    }
    
    // --- Process Recipients ---
    
    // Expect: at least one recipient
    if ( req_recipients.length < 1 ) {
        throw APIError.create('field_invalid', null, {
            key: 'recipients',
            expected: 'at least one',
            got: 'none',
        })
    }
    
    for ( let i=0 ; i < req_recipients.length ; i++ ) {
        const value = req_recipients[i];
        recipients_work.push({ i, value })
    }
    recipients_work.lockin();
    
    // Expect: each value should be a valid username or email
    for ( const item of recipients_work.list() ) {
        const { value, i } = item;
        
        if ( typeof value !== 'string' ) {
            item.invalid = true;
            result.recipients[i] =
                APIError.create('invalid_username_of_email', null, {
                    value,
                })
        }

        if ( value.match(config.username_regex) ) {
            item.type = 'username';
            continue;
        }
        if ( validator.isEmail(value) ) {
            item.type = 'username';
            continue;
        }
        
        item.invalid = true;
        result.recipients[i] =
            APIError.create('invalid_username_or_email', null, {
                value,
            });
    }
    
    // Return: if there are invalid values in strict mode
    recipients_work.clear_invalid();
    
    // Expect: no emails specified yet
    //    AND  usernames exist
    for ( const item of recipients_work.list() ) {
        if ( item.type === 'email' ) {
            item.invalid = true;
            result.recipients[item.i] =
                APIError.create('future', null, {
                    what: 'specifying recipients by email',
                    value: item.value
                });
            continue;
        }
    }

    // Return: if there are invalid values in strict mode
    recipients_work.clear_invalid();
    
    for ( const item of recipients_work.list() ) {
        const user = await get_user({ username: item.value });
        if ( ! user ) {
            item.invalid = true;
            result.recipients[item.i] =
                APIError.create('user_does_not_exist', null, {
                    username: item.value,
                });
            continue;
        }
        item.user = user;
    }

    // Return: if there are invalid values in strict mode
    recipients_work.clear_invalid();
    
    // --- Process Paths ---
    
    // Expect: at least one path
    if ( req_paths.length < 1 ) {
        throw APIError.create('field_invalid', null, {
            key: 'paths',
            expected: 'at least one',
            got: 'none',
        })
    }
    
    for ( let i=0 ; i < req_paths.length ; i++ ) {
        const value = req_paths[i];
        fsitems_work.push({ i, value });
    }
    fsitems_work.lockin();
    
    for ( const item of fsitems_work.list() ) {
         const { i } = item;
         let { value } = item;
        
        // adapt all strings to objects
        if ( typeof value === 'string' ) {
            value = { path: value };
        }
        
        if ( whatis(value) !== 'object' ) {
            item.invalid = true;
            result.paths[i] =
                APIError.create('invalid_path', null, {
                    path: item.path,
                    value,
                });
            continue;
        }
        
        const errors = [];
        if ( ! value.path ) {
            errors.push('`path` is required');
        }
        let access = value.access;
        if ( access ) {
            if ( ! ['read','write'].includes(access) ) {
                errors.push('`access` should be `read` or `write`');
            }
        } else access = 'read';

        if ( errors.length ) {
            item.invalid = true;
            result.paths[item.i] =
                APIError.create('field_errors', null, {
                    path: item.path,
                    errors
                });
            continue;
        }
        
        item.path = value.path;
        item.permission = PermissionUtil.join('fs', value.path, access);
    }
    
    fsitems_work.clear_invalid();
    
    for ( const item of fsitems_work.list() ) {
        const node = await (new FSNodeParam('path')).consolidate({
            req, getParam: () => item.path
        });
        
        if ( ! await node.exists() ) {
            item.invalid = true;
            result.paths[item.i] = APIError.create('subject_does_not_exist', {
                path: item.path,
            })
            continue;
        }
        
        item.node = node;
        let email_path = item.path;
        let is_dir = true;
        if ( await node.get('type') !== TYPE_DIRECTORY ) {
            is_dir = false;
            // remove last component
            email_path = email_path.slice(0, item.path.lastIndexOf('/')+1);
        }

        if ( email_path.startsWith('/') ) email_path = email_path.slice(1);
        const email_link = `${config.origin}/show/${email_path}`;
        item.is_dir = is_dir;
        item.email_link = email_link;
    }
    
    fsitems_work.clear_invalid();

    // Mark files as successful; further errors will be
    // reported on recipients instead.
    for ( const item of fsitems_work.list() ) {
        result.paths[item.i] =
            {
                $: 'api:status-report',
                status: 'success',
                fields: {
                    permission: item.permission,
                }
            };
    }
    
    if ( strict_check() ) return;
    if ( req.body.dry_run ) {
        // Mark everything left as successful
        for ( const item of recipients_work.list() ) {
            result.recipients[item.i] =
                { $: 'api:status-report', status: 'success' };
        }
        
        result.status = 'success';
        result.dry_run = true;
        serialize_result();
        res.send(result);
        return;
    }
    
    for ( const recipient_item of recipients_work.list() ) {
        if ( recipient_item.type !== 'username' ) continue;
        
        const username = recipient_item.user.username;

        for ( const path_item of fsitems_work.list() ) {
            await svc_permission.grant_user_user_permission(
                actor,
                username,
                path_item.permission,
            );
        }
        
        // TODO: Need to re-work this for multiple files
        /*
        const email_values = {
            link: recipient_item.email_link,
            susername: req.user.username,
            rusername: username,
        };

        const email_tmpl = 'share_existing_user';

        await svc_email.send_email(
            { email: recipient_item.user.email },
            email_tmpl,
            email_values,
        );
        */
       
        const files = []; {
            for ( const path_item of fsitems_work.list() ) {
                files.push(
                    await path_item.node.getSafeEntry(),
                );
            }
        }
        
        svc_notification.notify(UsernameNotifSelector(username), {
            source: 'sharing',
            icon: 'shared.svg',
            title: 'Files were shared with you!',
            template: 'file-shared-with-you',
            fields: {
                username,
                files,
            },
            text: `The user ${quot(req.user.username)} shared ` +
                `${files.length} ` +
                (files.length === 1 ? 'file' : 'files') + ' ' +
                'with you.',
        });
        
        result.recipients[recipient_item.i] =
            { $: 'api:status-report', statis: 'success' };
    }
    
    result.status = 'success';
    serialize_result(); // might change result.status to 'mixed'
    res.send(result);
};

Endpoint({
    // "item" here means a filesystem node
    route: '/item-by-username',
    mw: [configurable_auth()],
    methods: ['POST'],
    handler: v0_1,
}).attach(router);

Endpoint({
    // "item" here means a filesystem node
    route: '/',
    mw: [configurable_auth()],
    methods: ['POST'],
    handler: v0_2,
}).attach(router);

module.exports = app => {
    app.use('/share', router);
};
