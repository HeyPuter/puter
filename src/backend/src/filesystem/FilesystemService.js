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
// TODO: database access can be a service
const { RESOURCE_STATUS_PENDING_CREATE } = require('../modules/puterfs/ResourceService.js');
const { TraceService } = require('../services/TraceService.js');
const PerformanceMonitor = require('../monitor/PerformanceMonitor.js');
const { NodePathSelector, NodeUIDSelector, NodeInternalIDSelector } = require('./node/selectors.js');
const FSNodeContext = require('./FSNodeContext.js');
const { AdvancedBase } = require('@heyputer/putility');
const { Context } = require('../util/context.js');
const { simple_retry } = require('../util/retryutil.js');
const APIError = require('../api/APIError.js');
const { LLMkdir } = require('./ll_operations/ll_mkdir.js');
const { LLCWrite, LLOWrite } = require('./ll_operations/ll_write.js');
const { LLCopy } = require('./ll_operations/ll_copy.js');
const { PermissionUtil, PermissionRewriter, PermissionImplicator, PermissionExploder } = require('../services/auth/PermissionService.js');
const { DB_WRITE } = require("../services/database/consts");
const { UserActorType } = require('../services/auth/Actor');
const { get_user } = require('../helpers');
const BaseService = require('../services/BaseService');
const { PuterFSProvider } = require('../modules/puterfs/lib/PuterFSProvider.js');

class FilesystemService extends BaseService {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
        config: require('../config.js'),
    }

    old_constructor (args) {
        const { services } = args;

        services.registerService('traceService', TraceService);

        // The new fs entry service
        this.log = services.get('log-service').create('filesystem-service');

        // used by update_child_paths
        this.db = services.get('database').get(DB_WRITE, 'filesystem');

        const info = services.get('information');
        info.given('fs.fsentry').provide('fs.fsentry:path')
            .addStrategy('entry-or-delegate', async entry => {
                if ( entry.path ) return entry.path;
                return await info
                    .with('fs.fsentry:uuid')
                    .obtain('fs.fsentry:path')
                    .exec(entry.uuid);
            });
    }

    async _init () {
        this.old_constructor({ services: this.services });
        const svc_permission = this.services.get('permission');
        svc_permission.register_rewriter(PermissionRewriter.create({
            matcher: permission => {
                if ( ! permission.startsWith('fs:') ) return false;
                const [_, specifier] = PermissionUtil.split(permission);
                if ( ! specifier.startsWith('/') ) return false;
                return true;
            },
            rewriter: async permission => {
                const [_, path, ...rest] = PermissionUtil.split(permission);
                console.log('checking path: ', path);
                const node = await this.node(new NodePathSelector(path));
                if ( ! await node.exists() ) {
                    // TOOD: we need a general-purpose error that can have
                    // a user-safe message, instead of using APIError
                    // which is for API errors.
                    throw APIError.create('subject_does_not_exist');
                }
                const uid = await node.get('uid');
                if ( uid === undefined || uid === 'undefined' ) {
                    throw new Error(`uid is undefined for path ${path}`);
                }
                return `fs:${uid}:${rest.join(':')}`;
            },
        }));
        svc_permission.register_implicator(PermissionImplicator.create({
            id: 'is-owner',
            matcher: permission => {
                return permission.startsWith('fs:');
            },
            checker: async ({ actor, permission }) => {
                if ( !(actor.type instanceof UserActorType) ) {
                    return undefined;
                }

                const [_, uid] = PermissionUtil.split(permission);
                const node = await this.node(new NodeUIDSelector(uid));

                if ( ! await node.exists() ) {
                    return undefined;
                }

                const owner_id = await node.get('user_id');
                
                // These conditions should never happen
                if ( ! owner_id || ! actor.type.user.id ) {
                    throw new Error(
                        'something unexpected happened'
                    );
                }

                if ( owner_id === actor.type.user.id ) {
                    return {};
                }

                return undefined;
            },
        }));
        svc_permission.register_exploder(PermissionExploder.create({
            id: 'fs-access-levels',
            matcher: permission => {
                return permission.startsWith('fs:') &&
                    PermissionUtil.split(permission).length >= 3;
            },
            exploder: async ({ permission }) => {
                const permissions = [permission];
                const parts = PermissionUtil.split(permission);

                const specified_mode = parts[2];
                
                const rules = {
                    see: ['list', 'read', 'write'],
                    list: ['read', 'write'],
                    read: ['write'],
                };
                
                if ( rules.hasOwnProperty(specified_mode) ) {
                    permissions.push(...rules[specified_mode].map(
                        mode => PermissionUtil.join(
                            parts[0], parts[1],
                            mode,
                            ...parts.slice(3),
                        )
                    ));
                }
                
                return permissions;
            },
        }));
    }

    async mkshortcut ({ parent, name, user, target }) {

        // Access Control
        {
            const svc_acl = this.services.get('acl');

            if ( ! await svc_acl.check(user, target, 'read') ) {
                throw await svc_acl.get_safe_acl_error(user, target, 'read');
            }

            if ( ! await svc_acl.check(user, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(user, parent, 'write');
            }
        }

        if ( ! await target.exists() ) {
            throw APIError.create('shortcut_to_does_not_exist');
        }

        await target.fetchEntry({ thumbnail: true });

        const { _path, uuidv4 } = this.modules;
        const svc_fsEntry = this.services.get('fsEntryService');

        const ts = Math.round(Date.now() / 1000);
        const uid = uuidv4();

        resourceService.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        console.log('registered entry')

        const raw_fsentry = {
            is_shortcut: 1,
            shortcut_to: target.mysql_id,
            is_dir: target.entry.is_dir,
            thumbnail: target.entry.thumbnail,
            uuid: uid,
            parent_uid: await parent.get('uid'),
            path: _path.join(await parent.get('path'), name),
            user_id: user.id,
            name,
            created: ts,
            updated: ts,
            modified: ts,
            immutable: false,
        };

        this.log.debug('creating fsentry', { fsentry: raw_fsentry })

        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        console.log('entry op', entryOp);

        (async () => {
            await entryOp.awaitDone();
            this.log.debug('finished creating fsentry', { uid })
            resourceService.free(uid);
        })();

        const node = await this.node(new NodeUIDSelector(uid));

        const svc_event = this.services.get('event');
        svc_event.emit('fs.create.shortcut', {
            node,
            context: Context.get(),
        });

        return node;
    }

    async mklink ({ parent, name, user, target }) {

        // Access Control
        {
            const svc_acl = this.services.get('acl');

            if ( ! await svc_acl.check(user, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(user, parent, 'write');
            }
        }

        // We don't check if the target exists because broken links
        // are allowed.

        const { _path, uuidv4 } = this.modules;
        const resourceService = this.services.get('resourceService');
        const svc_fsEntry = this.services.get('fsEntryService');

        const ts = Math.round(Date.now() / 1000);
        const uid = uuidv4();

        resourceService.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const raw_fsentry = {
            is_symlink: 1,
            symlink_path: target,
            is_dir: 0,
            uuid: uid,
            parent_uid: await parent.get('uid'),
            path: _path.join(await parent.get('path'), name),
            user_id: user.id,
            name,
            created: ts,
            updated: ts,
            modified: ts,
            immutable: false,
        };

        this.log.debug('creating symlink', { fsentry: raw_fsentry })

        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        (async () => {
            await entryOp.awaitDone();
            this.log.debug('finished creating symlink', { uid })
            resourceService.free(uid);
        })();

        const node = await this.node(new NodeUIDSelector(uid));

        const svc_event = this.services.get('event');
        svc_event.emit('fs.create.symlink', {
            node,
            context: Context.get(),
        });

        return node;
    }

    async update_child_paths (old_path, new_path, user_id) {
        const svc_performanceMonitor = this.services.get('performance-monitor');
        const monitor = svc_performanceMonitor.createContext('update_child_paths');

        if ( ! old_path.endsWith('/') ) old_path += '/';
        if ( ! new_path.endsWith('/') ) new_path += '/';
        // TODO: fs:decouple-tree-storage
        await this.db.write(
            `UPDATE fsentries SET path = CONCAT(?, SUBSTRING(path, ?)) WHERE path LIKE ? AND user_id = ?`,
            [new_path, old_path.length + 1, old_path + '%', user_id]
        );

        const log = this.services.get('log-service').create('update_child_paths');
        log.info(`updated ${old_path} -> ${new_path}`);

        monitor.end();
    }

    /**
     * node() returns a filesystem node using path, uid,
     * or id associated with a filesystem node. Use this
     * method when you need to get a filesystem node and
     * need to collect information about the entry.
     *
     * @param {*} location - path, uid, or id associated with a filesystem node
     * @returns
     */
    async node (selector) {
        if ( typeof selector === 'string' ) {
            if ( selector.startsWith('/') ) {
                selector = new NodePathSelector(selector);
            } else {
                selector = new NodeUIDSelector(selector);
            }
        }

        // TEMP: remove when these objects aren't used anymore
        if (
            typeof selector === 'object' &&
            selector.constructor.name === 'Object'
        ) {
            if ( selector.path ) {
                selector = new NodePathSelector(selector.path);
            } else if ( selector.uid ) {
                selector = new NodeUIDSelector(selector.uid);
            } else {
                selector = new NodeInternalIDSelector(
                    'mysql', selector.mysql_id);
            }
        }

        const svc_mountpoint = this.services.get('mountpoint');
        const provider = await svc_mountpoint.get_provider(selector);

        let fsNode = new FSNodeContext({
            provider,
            services: this.services,
            selector,
            fs: this
        });
        return fsNode;
    }

    /**
     * get_entry() returns a filesystem entry using
     * path, uid, or id associated with a filesystem
     * node. Use this method when you need to get a
     * filesystem entry but don't need to collect any
     * other information about the entry.
     *
     * @warning The entry returned by this method is not
     * client-safe. Use FSNodeContext to get a client-safe
     * entry by calling it's fetchEntry() method.
     *
     * @param {*} param0 options for getting the entry
     * @param {*} param0.path
     * @param {*} param0.uid
     * @param {*} param0.id please use mysql_id instead
     * @param {*} param0.mysql_id
     */
    async get_entry ({ path, uid, id, mysql_id, ...options }) {
        let fsNode = await this.node({ path, uid, id, mysql_id });
        await fsNode.fetchEntry(options);
        return fsNode.entry;
    }
}

module.exports = {
    FilesystemService
};
