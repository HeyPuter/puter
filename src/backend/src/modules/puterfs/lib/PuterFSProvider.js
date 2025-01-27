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

const putility = require('@heyputer/putility');
const { MultiDetachable } = putility.libs.listener;
const { TDetachable } = putility.traits;

const { NodeInternalIDSelector, NodeChildSelector, NodeUIDSelector, RootNodeSelector, NodePathSelector } = require("../../../filesystem/node/selectors");
const { Context } = require("../../../util/context");
const fsCapabilities = require('../../../filesystem/definitions/capabilities');
const { UploadProgressTracker } = require('../../../filesystem/storage/UploadProgressTracker');
const FSNodeContext = require('../../../filesystem/FSNodeContext');
const { RESOURCE_STATUS_PENDING_CREATE } = require('../ResourceService');
const { ParallelTasks } = require('../../../util/otelutil');

const { TYPE_DIRECTORY } = require('../../../filesystem/FSNodeContext');
const APIError = require('../../../api/APIError');

class PuterFSProvider extends putility.AdvancedBase {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
    }

    get_capabilities () {
        return new Set([
            fsCapabilities.THUMBNAIL,
            fsCapabilities.UUID,
            fsCapabilities.OPERATION_TRACE,
            fsCapabilities.READDIR_UUID_MODE,

            fsCapabilities.COPY_TREE,

            fsCapabilities.READ,
            fsCapabilities.WRITE,
            fsCapabilities.CASE_SENSITIVE,
            fsCapabilities.SYMLINK,
            fsCapabilities.TRASH,
        ]);
    }

    async stat ({
        selector,
        options,
        controls,
        node,
    }) {
        // For Puter FS nodes, we assume we will obtain all properties from
        // fsEntryService/fsEntryFetcher, except for 'thumbnail' unless it's
        // explicitly requested.

        const {
            traceService,
            fsEntryService,
            fsEntryFetcher,
            resourceService,
        } = Context.get('services').values;

        if ( options.tracer == null ) {
            options.tracer = traceService.tracer;
        }

        if ( options.op ) {
            options.trace_options = {
                parent: options.op.span,
            };
        }

        let entry;

        await new Promise (rslv => {
            const detachables = new MultiDetachable();

            const callback = (resolver) => {
                detachables.as(TDetachable).detach();
                rslv();
            }

            // either the resource is free
            {
                // no detachale because waitForResource returns a
                // Promise that will be resolved when the resource
                // is free no matter what, and then it will be
                // garbage collected.
                resourceService.waitForResource(
                    selector
                ).then(callback.bind(null, 'resourceService'));
            }

            // or pending information about the resource
            // becomes available
            {
                // detachable is needed here because waitForEntry keeps
                // a map of listeners in memory, and this event may
                // never occur. If this never occurs, waitForResource
                // is guaranteed to resolve eventually, and then this
                // detachable will be detached by `callback` so the
                // listener can be garbage collected.
                const det = fsEntryService.waitForEntry(
                    node, callback.bind(null, 'fsEntryService'));
                if ( det ) detachables.add(det);
            }
        });

        const maybe_uid = node.uid;
        if ( resourceService.getResourceInfo(maybe_uid) ) {
            entry = await fsEntryService.get(maybe_uid, options);
            controls.log.debug('got an entry from the future');
        } else {
            entry = await fsEntryFetcher.find(
                selector, options);
        }

        if ( ! entry ) {
            controls.log.info(`entry not found: ${selector.describe(true)}`);
        }

        if ( entry === null || typeof entry !== 'object' ) {
            return null;
        }

        if ( entry.id ) {
            controls.provide_selector(
                new NodeInternalIDSelector('mysql', entry.id, {
                    source: 'FSNodeContext optimization'
                })
            );
        }

        return entry;
    }

    async readdir ({ context, node }) {
        const uuid = await node.get('uid');
        const services = context.get('services');
        const svc_fsentry = services.get('fsEntryService');
        const child_uuids = await svc_fsentry
            .fast_get_direct_descendants(uuid);
        return child_uuids;
    }

    async move ({ context, node, new_parent, new_name, metadata }) {
        const { _path } = this.modules;

        const services = context.get('services');
        const old_path = await node.get('path');
        const new_path = _path.join(await new_parent.get('path'), new_name);

        const svc_fsEntry = services.get('fsEntryService');
        const op_update = await svc_fsEntry.update(node.uid, {
            ...(
                await node.get('parent_uid') !== await new_parent.get('uid')
                ? { parent_uid: await new_parent.get('uid') }
                : {}
            ),
            path: new_path,
            name: new_name,
            ...(metadata ? { metadata } : {}),
        });

        node.entry.name = new_name;
        node.entry.path = new_path;

        // NOTE: this is a safeguard passed to update_child_paths to isolate
        //       changes to the owner's directory tree, ut this may need to be
        //       removed in the future.
        const user_id = await node.get('user_id');

        await op_update.awaitDone();

        const svc_fs = services.get('filesystem');
        await svc_fs.update_child_paths(old_path, node.entry.path, user_id);

        const svc_event = services.get('event');

        await svc_event.emit('fs.move.file', {
            context,
            moved: node,
            old_path,
        });

        return node;
    }

    async copy_tree ({ context, source, parent, target_name }) {
        return await this.copy_tree_(
            { context, source, parent, target_name });
    }
    async copy_tree_ ({ context, source, parent, target_name }) {
        // Modules
        const { _path, uuidv4 } = this.modules;

        // Services
        const services = context.get('services');
        const svc_event = services.get('event');
        const svc_trace = services.get('traceService');
        const svc_size = services.get('sizeService');
        const svc_resource = services.get('resourceService');
        const svc_fsEntry = services.get('fsEntryService');
        const svc_fs = services.get('filesystem');

        // Context
        const actor = Context.get('actor');
        const user = actor.type.user;

        const tracer = svc_trace.tracer;
        const uuid = uuidv4();
        const ts = Math.round(Date.now()/1000);
        await parent.fetchEntry();
        await source.fetchEntry({ thumbnail: true });

        // New filesystem entry
        const raw_fsentry = {
            uuid,
            is_dir: source.entry.is_dir,
            ...(source.entry.is_shortcut ? {
                is_shortcut: source.entry.is_shortcut,
                shortcut_to: source.entry.shortcut_to,
            } :{}),
            parent_uid: parent.uid,
            name: target_name,
            created: ts,
            modified: ts,

            path: _path.join(await parent.get('path'), target_name),

            // if property exists but the value is undefined,
            // it will still be included in the INSERT, causing
            // an error
            ...(source.entry.thumbnail ?
                { thumbnail: source.entry.thumbnail } : {}),

            user_id: user.id,
        };

        svc_event.emit('fs.pending.file', {
            fsentry: FSNodeContext.sanitize_pending_entry_info(raw_fsentry),
            context: context,
        })

        if ( await source.get('has-s3') ) {
            Object.assign(raw_fsentry, {
                size: source.entry.size,
                associated_app_id: source.entry.associated_app_id,
                bucket: source.entry.bucket,
                bucket_region: source.entry.bucket_region,
            });

            await tracer.startActiveSpan(`fs:cp:storage-copy`, async span => {
                let progress_tracker = new UploadProgressTracker();

                svc_event.emit('fs.storage.progress.copy', {
                    upload_tracker: progress_tracker,
                    context,
                    meta: {
                        item_uid: uuid,
                        item_path: raw_fsentry.path,
                    }
                });

                // const storage = new PuterS3StorageStrategy({ services: svc });
                const storage = context.get('storage');
                const state_copy = storage.create_copy();
                await state_copy.run({
                    src_node: source,
                    dst_storage: {
                        key: uuid,
                        bucket: raw_fsentry.bucket,
                        bucket_region: raw_fsentry.bucket_region,
                    },
                    storage_api: { progress_tracker },
                });

                span.end();
            });
        }

        {
            await svc_size.add_node_size(undefined, source, user);
        }

        svc_resource.register({
            uid: uuid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        let node;

        const tasks = new ParallelTasks({ tracer, max: 4 });
        await context.arun(`fs:cp:parallel-portion`, async () => {
            // Add child copy tasks if this is a directory
            if ( source.entry.is_dir ) {
                const children = await svc_fsEntry.fast_get_direct_descendants(
                    source.uid
                );
                for ( const child_uuid of children ) {
                    tasks.add(`fs:cp:copy-child`, async () => {
                        const child_node = await svc_fs.node(
                            new NodeUIDSelector(child_uuid)
                        );
                        const child_name = await child_node.get('name');
                        // TODO: this should be LLCopy instead
                        await this.copy_tree_({
                            context,
                            source: await svc_fs.node(
                                new NodeUIDSelector(child_uuid)
                            ),
                            parent: await svc_fs.node(
                                new NodeUIDSelector(uuid)
                            ),
                            target_name: child_name,
                        });
                    });
                }
            }

            // Add task to await entry
            tasks.add(`fs:cp:entry-op`, async () => {
                await entryOp.awaitDone();
                svc_resource.free(uuid);
                const copy_fsNode = await svc_fs.node(new NodeUIDSelector(uuid));
                copy_fsNode.entry = raw_fsentry;
                copy_fsNode.found = true;
                copy_fsNode.path = raw_fsentry.path;

                node = copy_fsNode;

                svc_event.emit('fs.create.file', {
                    node,
                    context,
                })
            }, { force: true });

            await tasks.awaitAll();
        });

        node = node || await svc_fs.node(new NodeUIDSelector(uuid));

        // TODO: What event do we emit? How do we know if we're overwriting?
        return node;
    }

    async unlink ({ context, node }) {
        if ( await node.get('type') === TYPE_DIRECTORY ) {
            console.log(`\x1B[31;1m===N=====${await node.get('path')}=========\x1B[0m`)
            throw new APIError(409, 'Cannot unlink a directory.');
        }

        await this.rmnode_({ context, node });
    }

    async rmdir ({ context, node }) {
        if ( await node.get('type') !== TYPE_DIRECTORY ) {
            console.log(`\x1B[31;1m===D1====${await node.get('path')}=========\x1B[0m`)
            throw new APIError(409, 'Cannot rmdir a file.');
        }

        if ( await node.get('immutable') ) {
            console.log(`\x1B[31;1m===D2====${await node.get('path')}=========\x1B[0m`)
            throw APIError.create('immutable');
        }

        // Services
        const services = context.get('services');
        const svc_fsEntry = services.get('fsEntryService');

        const children = await svc_fsEntry.fast_get_direct_descendants(
            await node.get('uid')
        );

        if ( children.length > 0 ) {
            console.log(`\x1B[31;1m===D3====${await node.get('path')}=========\x1B[0m`)
            throw APIError.create('not_empty');
        }

        await this.rmnode_({ context, node });
    }

    async rmnode_ ({ context, node }) {
        // Services
        const services = context.get('services');
        const svc_size = services.get('sizeService');
        const svc_fsEntry = services.get('fsEntryService');

        if ( await node.get('immutable') ) {
            throw new APIError(403, 'File is immutable.');
        }

        svc_size.change_usage(
            await node.get('user_id'),
            -1 * await node.get('size')
        );

        const tracer = services.get('traceService').tracer;
        const tasks = new ParallelTasks({ tracer, max: 4 });

        tasks.add(`remove-fsentry`, async () => {
            await svc_fsEntry.delete(await node.get('uid'));
        });

        if ( await node.get('has-s3') ) {
            tasks.add(`remove-from-s3`, async () => {
                // const storage = new PuterS3StorageStrategy({ services: svc });
                const storage = Context.get('storage');
                const state_delete = storage.create_delete();
                await state_delete.run({
                    node: node,
                });
            });
        }

        await tasks.awaitAll();
    }
}

module.exports = {
    PuterFSProvider,
};
