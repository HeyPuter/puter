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

const { UsernameNotifSelector } = require("../../services/NotificationService");
const { quot } = require('@heyputer/putility').libs.string;

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
    function testing_a_thing (a) {
        a.set('thing', 'a thing');
    },
    require('./share/validate.js'),
    function testing_a_thing (a) {
        console.log('ASDFASDFASDF', a.get('asdf'));
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
    require('./share/process_recipients.js'),
    require('./share/process_shares.js'),
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
