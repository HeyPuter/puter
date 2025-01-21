/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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

const APIError = require("../../../api/APIError");
const { Sequence } = require("../../../codex/Sequence");
const config = require("../../../config");
const { get_user, get_app } = require("../../../helpers");
const { PermissionUtil } = require("../../../services/auth/PermissionService");
const FSNodeParam = require("../../../api/filesystem/FSNodeParam");
const { TYPE_DIRECTORY } = require("../../../filesystem/FSNodeContext");

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

module.exports = new Sequence({
    name: 'process shares',
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
    function return_state (a) { return a; }
]);
