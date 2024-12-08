/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const APIError = require("../../api/APIError");
const { Sequence } = require("../../codex/Sequence");
const config = require("../../config");
const { WorkList } = require("../../util/workutil");

const validator = require('validator');
const { get_user, get_app } = require("../../helpers");
const { PermissionUtil } = require("../../services/auth/PermissionService");
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const { TYPE_DIRECTORY } = require("../../filesystem/FSNodeContext");
const { UsernameNotifSelector } = require("../../services/NotificationService");
const { quot } = require('@heyputer/putility').libs.string;
const { whatis } = require("../../util/langutil");

/*
    This code is optimized for editors supporting folding.
    Fold at Level 2 to conveniently browse sequence steps.
    Fold at Level 3 after opening an inner-sequence.
    
    If you're using VSCode {
        typically "Ctrl+K, Ctrl+2" or "⌘K, ⌘2";
        to revert "Ctrl+K, Ctrl+J" or "⌘K, ⌘J";
        https://stackoverflow.com/questions/30067767
    }
*/


module.exports = new Sequence([
    function validate_metadata (a) {
        const req = a.get('req');
        const metadata = req.body.metadata;

        if ( ! metadata ) return;
        
        if ( typeof metadata !== 'object' ) {
            throw APIError.create('field_invalid', null, {
                key: 'metadata',
                expected: 'object',
                got: whatis(metadata),
            });
        }

        const MAX_KEYS = 20;
        const MAX_STRING = 255;
        const MAX_MESSAGE_STRING = 10*1024;

        if ( Object.keys(metadata).length > MAX_KEYS ) {
            throw APIError.create('field_invalid', null, {
                key: 'metadata',
                expected: `at most ${MAX_KEYS} keys`,
                got: `${Object.keys(metadata).length} keys`,
            });
        }

        for ( const key in metadata ) {
            const value = metadata[key];
            if ( typeof value !== 'string' && typeof value !== 'number' ) {
                throw APIError.create('field_invalid', null, {
                    key: `metadata.${key}`,
                    expected: 'string or number',
                    got: whatis(value),
                });
            }
            if ( key === 'message' ) {
                if ( typeof value !== 'string' ) {
                    throw APIError.create('field_invalid', null, {
                        key: `metadata.${key}`,
                        expected: 'string',
                        got: whatis(value),
                    });
                }
                if ( value.length > MAX_MESSAGE_STRING ) {
                    throw APIError.create('field_invalid', null, {
                        key: `metadata.${key}`,
                        expected: `at most ${MAX_MESSAGE_STRING} characters`,
                        got: `${value.length} characters`,
                    });
                }
                continue;
            }
            if ( typeof value === 'string' && value.length > MAX_STRING ) {
                throw APIError.create('field_invalid', null, {
                    key: `metadata.${key}`,
                    expected: `at most ${MAX_STRING} characters`,
                    got: `${value.length} characters`,
                });
            }
        }
    },
    function validate_mode (a) {
        const req = a.get('req');
        const mode = req.body.mode;
        
        if ( mode === 'strict' ) {
            a.set('strict_mode', true);
            return;
        }
        if ( ! mode || mode === 'best-effort' ) {
            a.set('strict_mode', false);
            return;
        }
        throw APIError.create('field_invalid', null, {
            key: 'mode',
            expected: '`strict`, `best-effort`, or undefined',
        });
    },
    function validate_recipients (a) {
        const req = a.get('req');
        let recipients = req.body.recipients;

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
        // At least one recipient
        if ( recipients.length < 1 ) {
            throw APIError.create('field_invalid', null, {
                key: 'recipients',
                expected: 'at least one',
                got: 'none',
            });
        }
        a.set('req_recipients', recipients);
    },
    function validate_shares (a) {
        const req = a.get('req');
        let shares = req.body.shares;

        if ( ! Array.isArray(shares) ) {
            shares = [shares];
        }
        
        // At least one share
        if ( shares.length < 1 ) {
            throw APIError.create('field_invalid', null, {
                key: 'shares',
                expected: 'at least one',
                got: 'none',
            });
        }
        
        a.set('req_shares', shares);
    },
    function initialize_result_object (a) {
        a.set('result', {
            $: 'api:share',
            $version: 'v0.0.0',
            status: null,
            recipients:
                Array(a.get('req_recipients').length).fill(null),
            shares:
                Array(a.get('req_shares').length).fill(null),
            serialize () {
                const result = this;
                for ( let i=0 ; i < result.recipients.length ; i++ ) {
                    if ( ! result.recipients[i] ) continue;
                    if ( result.recipients[i] instanceof APIError ) {
                        result.status = 'mixed';
                        result.recipients[i] = result.recipients[i].serialize();
                    }
                }
                for ( let i=0 ; i < result.shares.length ; i++ ) {
                    if ( ! result.shares[i] ) continue;
                    if ( result.shares[i] instanceof APIError ) {
                        result.status = 'mixed';
                        result.shares[i] = result.shares[i].serialize();
                    }
                }
                delete result.serialize;
                return result;
            }
        });
    },
    function initialize_worklists (a) {
        const recipients_work = new WorkList();
        const shares_work = new WorkList();
        
        const { req_recipients, req_shares } = a.values();
        
        // track: common operations on multiple items
        
        for ( let i=0 ; i < req_recipients.length ; i++ ) {
            const value = req_recipients[i];
            recipients_work.push({ i, value });
        }
        
        for ( let i=0 ; i < req_shares.length ; i++ ) {
            const value = req_shares[i];
            shares_work.push({ i, value });
        }
        
        recipients_work.lockin();
        shares_work.lockin();
        
        a.values({ recipients_work, shares_work });
    },
    new Sequence({ name: 'process recipients',
        after_each (a) {
            const { recipients_work } = a.values();
            recipients_work.clear_invalid();
        }
    }, [
        function valid_username_or_email (a) {
            const { result, recipients_work } = a.values();
            for ( const item of recipients_work.list() ) {
                const { value, i } = item;
                
                if ( typeof value !== 'string' ) {
                    item.invalid = true;
                    result.recipients[i] =
                        APIError.create('invalid_username_or_email', null, {
                            value,
                        });
                    continue;
                }

                if ( value.match(config.username_regex) ) {
                    item.type = 'username';
                    continue;
                }
                if ( validator.isEmail(value) ) {
                    item.type = 'email';
                    continue;
                }
                
                item.invalid = true;
                result.recipients[i] =
                    APIError.create('invalid_username_or_email', null, {
                        value,
                    });
            }
        },
        async function check_existing_users_for_email_shares (a) {
            const { recipients_work } = a.values();
            for ( const recipient_item of recipients_work.list() ) {
                if ( recipient_item.type !== 'email' ) continue;
                const user = await get_user({
                    email: recipient_item.value,
                });
                if ( ! user ) continue;
                recipient_item.type = 'username';
                recipient_item.value = user.username;
            }
        },
        async function check_username_specified_users_exist (a) {
            const { result, recipients_work } = a.values();
            for ( const item of recipients_work.list() ) {
                if ( item.type !== 'username' ) continue;

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
        }
    ]),
    new Sequence({ name: 'process shares',
        beforeEach (a) {
            const { shares_work } = a.values();
            shares_work.clear_invalid();
        }
    }, [
        function validate_share_types (a) {
            const { result, shares_work } = a.values();
            
            const lib_typeTagged = a.iget('services').get('lib-type-tagged');
            
            for ( const item of shares_work.list() ) {
                const { i } = item;
                let { value } = item;
                
                const thing = lib_typeTagged.process(value);
                if ( thing.$ === 'error' ) {
                    item.invalid = true;
                    result.shares[i] =
                        APIError.create('format_error', null, {
                            message: thing.message
                        });
                    continue;
                }
                
                const allowed_things = ['fs-share', 'app-share'];
                if ( ! allowed_things.includes(thing.$) ) {
                    item.invalid = true;
                    result.shares[i] =
                        APIError.create('disallowed_thing', null, {
                            thing: thing.$,
                            accepted: allowed_things,
                        });
                    continue;
                }
                
                item.thing = thing;
            }
        },
        function create_file_share_intents (a) {
            const { result, shares_work } = a.values();
            for ( const item of shares_work.list() ) {
                const { thing } = item;
                if ( thing.$ !== 'fs-share' ) continue;

                item.type = 'fs';
                const errors = [];
                if ( ! thing.path ) {
                    errors.push('`path` is required');
                }
                let access = thing.access;
                if ( access ) {
                    if ( ! ['read','write'].includes(access) ) {
                        errors.push('`access` should be `read` or `write`');
                    }
                } else access = 'read';

                if ( errors.length ) {
                    item.invalid = true;
                    result.shares[item.i] =
                        APIError.create('field_errors', null, {
                            key: `shares[${item.i}]`,
                            errors
                        });
                    continue;
                }
                
                item.path = thing.path;
                item.share_intent = {
                    $: 'share-intent:file',
                    permissions: [PermissionUtil.join('fs', thing.path, access)],
                };
            }
        },
        function create_app_share_intents (a) {
            const { result, shares_work } = a.values();
            for ( const item of shares_work.list() ) {
                const { thing } = item;
                if ( thing.$ !== 'app-share' ) continue;

                item.type = 'app';
                const errors = [];
                if ( ! thing.uid && ! thing.name ) {
                    errors.push('`uid` or `name` is required');
                }

                if ( errors.length ) {
                    item.invalid = true;
                    result.shares[item.i] =
                        APIError.create('field_errors', null, {
                            key: `shares[${item.i}]`,
                            errors
                        });
                    continue;
                }
                
                const app_selector = thing.uid
                    ? `uid#${thing.uid}` : thing.name;
                
                item.share_intent = {
                    $: 'share-intent:app',
                    permissions: [
                        PermissionUtil.join('app', app_selector, 'access')
                    ]
                }
                continue;
            }
        },
        async function fetch_nodes_for_file_shares (a) {
            const { req, result, shares_work } = a.values();
            for ( const item of shares_work.list() ) {
                if ( item.type !== 'fs' ) continue;
                const node = await (new FSNodeParam('path')).consolidate({
                    req, getParam: () => item.path
                });
                
                if ( ! await node.exists() ) {
                    item.invalid = true;
                    result.shares[item.i] = APIError.create('subject_does_not_exist', {
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
        },
        async function fetch_apps_for_app_shares (a) {
            const { result, shares_work } = a.values();
            const db = a.iget('db');
            
            for ( const item of shares_work.list() ) {
                if ( item.type !== 'app' ) continue;
                const { thing } = item;

                const app = await get_app(thing.uid ?
                    { uid: thing.uid } : { name: thing.name });
                if ( ! app ) {
                    item.invalid = true;
                    result.shares[item.i] =
                        // note: since we're reporting `entity_not_found`
                        // we will report the id as an entity-storage-compatible
                        // identifier.
                        APIError.create('entity_not_found', null, {
                            identifier: thing.uid
                                ? { uid: thing.uid }
                                : { id: { name: thing.name } }
                        });
                }
                
                app.metadata = db.case({
                    mysql: () => app.metadata,
                    otherwise: () => JSON.parse(app.metadata ?? '{}')
                })();
                
                item.app = app;
            }
        },
        async function add_subdomain_permissions (a) {
            const { shares_work } = a.values();
            const actor = a.get('actor');
            const db = a.iget('db');

            for ( const item of shares_work.list() ) {
                if ( item.type !== 'app' ) continue;
                const [subdomain] = await db.read(
                    `SELECT * FROM subdomains WHERE associated_app_id = ? ` +
                    `AND user_id = ? LIMIT 1`,
                    [item.app.id, actor.type.user.id]
                );
                if ( ! subdomain ) continue;
                
                // The subdomain is also owned by this user, so we'll
                // add a permission for that as well
                
                const site_selector = `uid#${subdomain.uuid}`;
                item.share_intent.permissions.push(
                    PermissionUtil.join('site', site_selector, 'access')
                )
            }
        },
        async function add_appdata_permissions (a) {
            const { result, shares_work } = a.values();
            for ( const item of shares_work.list() ) {
                if ( item.type !== 'app' ) continue;
                if ( ! item.app.metadata?.shared_appdata ) continue;
                
                const app_owner = await get_user({ id: item.app.owner_user_id });
                
                const appdatadir =
                    `/${app_owner.username}/AppData/${item.app.uid}`;
                const appdatadir_perm =
                    PermissionUtil.join('fs', appdatadir, 'write');

                item.share_intent.permissions.push(appdatadir_perm);
            }
        },
        function apply_success_status_to_shares (a) {
            const { result, shares_work } = a.values();
            for ( const item of shares_work.list() ) {
                result.shares[item.i] =
                    {
                        $: 'api:status-report',
                        status: 'success',
                        fields: {
                            permission: item.permission,
                        }
                    };
            }
        },
    ]),
    function abort_on_error_if_mode_is_strict (a) {
        const strict_mode = a.get('strict_mode');
        if ( ! strict_mode ) return;
        
        const result = a.get('result');
        if (
            result.recipients.some(v => v !== null) ||
            result.shares.some(v => v !== null)
        ) {
            result.serialize();
            result.status = 'aborted';
            const res = a.get('res');
            res.status(218).send(result);
            a.stop();
        }
    },
    function early_return_on_dry_run (a) {
        if ( ! a.get('req').body.dry_run ) return;
            
        const { res, result, recipients_work } = a.values();
        for ( const item of recipients_work.list() ) {
            result.recipients[item.i] =
                { $: 'api:status-report', status: 'success' };
        }
        
        result.serialize();
        result.status = 'success';
        result.dry_run = true;
        res.send(result);
        a.stop();
    },
    async function grant_permissions_to_existing_users (a) {
        const {
            req, result, recipients_work, shares_work
        } = a.values();
        
        const svc_permission = a.iget('services').get('permission');
        const svc_acl = a.iget('services').get('acl');
        const svc_notification = a.iget('services').get('notification');
        const svc_email = a.iget('services').get('email');
        
        const actor = a.get('actor');

        for ( const recipient_item of recipients_work.list() ) {
            if ( recipient_item.type !== 'username' ) continue;
            
            const username = recipient_item.user.username;

            for ( const share_item of shares_work.list() ) {
                const permissions = share_item.share_intent.permissions;
                for ( const perm of permissions ) {
                    if ( perm.startsWith('fs:') ) {
                        await svc_acl.set_user_user(
                            actor,
                            username,
                            perm,
                            undefined,
                            { only_if_higher: true },
                        );
                    } else {
                        await svc_permission.grant_user_user_permission(
                            actor,
                            username,
                            perm,
                        );
                    }
                }
            }
        
            const files = []; {
                for ( const item of shares_work.list() ) {
                    if ( item.thing.$ !== 'fs-share' ) continue;
                    files.push(
                        await item.node.getSafeEntry(),
                    );
                }
            }

            const apps = []; {
                for ( const item of shares_work.list() ) {
                    if ( item.thing.$ !== 'app' ) continue;
                    // TODO: is there a general way to create a
                    //       client-safe app right now without
                    //       going through entity storage?
                    // track: manual safe object
                    apps.push(item.name
                        ? item.name : await get_app({
                            uid: item.uid,
                        }));
                }
            }

            const metadata = a.get('req').body.metadata || {};
            
            svc_notification.notify(UsernameNotifSelector(username), {
                source: 'sharing',
                icon: 'shared.svg',
                title: 'Files were shared with you!',
                template: 'file-shared-with-you',
                fields: {
                    metadata,
                    username: actor.type.user.username,
                    files,
                },
                text: `The user ${quot(req.user.username)} shared ` +
                    `${files.length} ` +
                    (files.length === 1 ? 'file' : 'files') + ' ' +
                    'with you.',
            });


            // Working on notifications
            // Email should have a link to a shared file, right?
            //   .. how do I make those URLs? (gui feature)
            await svc_email.send_email({
                email: recipient_item.user.email,
            }, 'share_by_username', {
                // link: // TODO: create a link to the shared file
                susername: actor.type.user.username,
                rusername: username,
                message: metadata.message,
            });
            
            result.recipients[recipient_item.i] =
                { $: 'api:status-report', status: 'success' };
        }
    },
    async function email_the_email_recipients (a) {
        const { actor, recipients_work, shares_work } = a.values();
        
        const svc_share = a.iget('services').get('share');
        const svc_token = a.iget('services').get('token');
        const svc_email = a.iget('services').get('email');
        
        for ( const recipient_item of recipients_work.list() ) {
            if ( recipient_item.type !== 'email' ) continue;
            
            const email = recipient_item.value;
            
            // data that gets stored in the `data` column of the share
            const metadata = a.get('req').body.metadata || {};
            const data = {
                $: 'internal:share',
                $v: 'v0.0.0',
                permissions: [],
                metadata,
            };
            
            for ( const share_item of shares_work.list() ) {
                const permissions = share_item.share_intent.permissions;
                data.permissions.push(...permissions);
            }
            
            // track: scoping iife
            const share_token = await (async () => {
                const share_uid = await svc_share.create_share({
                    issuer: actor,
                    email,
                    data,
                });
                return svc_token.sign('share', {
                    $: 'token:share',
                    $v: '0.0.0',
                    uid: share_uid,
                }, {
                    expiresIn: '14d'
                });
            })();
            
            const email_link =
                `${config.origin}?share_token=${share_token}`;
            
            await svc_email.send_email({ email }, 'share_by_email', {
                link: email_link,
                sender_name: actor.type.user.username,
                message: metadata.message,
            });
        }
    },
    function send_result (a) {
        const { res, result } = a.values();
        result.serialize();
        res.send(result);
    }
]);
