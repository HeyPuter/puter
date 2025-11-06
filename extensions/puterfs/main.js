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

const uuidv4 = require('uuid').v4;
const path_ = require('node:path');

const svc_metering = extension.import('service:meteringService');
const svc_trace = extension.import('service:traceService');
const svc_fs = extension.import('service:filesystem');

// TODO: filesystem providers should not need to call EventService
const svc_event = extension.import('service:event');

// TODO: filesystem providers REALLY SHOULD NOT implement ACL logic!
const svc_acl = extension.import('service:acl');

// TODO: these services ought to be part of this extension
const svc_size = extension.import('service:sizeService');
const svc_fsEntry = extension.import('service:fsEntryService');
const svc_fsEntryFetcher = extension.import('service:fsEntryFetcher');
const svc_resource = extension.import('service:resourceService');
const svc_fsLock = extension.import('service:fslock');

// TODO: depending on mountpoint service will not be necessary
//       once the storage provider is moved to this extension
const svc_mountpoint = extension.import('service:mountpoint');

const {
    APIError,
    Actor,
    Context,
    UserActorType,
    TDetachable,
    MultiDetachable,
} = extension.import('core');

const {
    get_user,
} = extension.import('core').util.helpers;

const {
    ParallelTasks,
} = extension.import('core').util.otelutil;

const {
    TYPE_DIRECTORY,
} = extension.import('core').fs;

const {
    NodeChildSelector,
    NodeUIDSelector,
    NodeInternalIDSelector,
} = extension.import('core').fs.selectors;

const {
    FSNodeContext,
} = extension.import('fs');

const {
    // MODE_READ,
    MODE_WRITE,
} = extension.import('fs').lock;

// ^ Yep I know, import('fs') and import('core').fs is confusing and
// redundant... this will be cleaned up as the new API is developed

const {
    // MODE_READ,
    RESOURCE_STATUS_PENDING_CREATE,
} = extension.import('fs').resource;

const {
    UploadProgressTracker,
} = extension.import('fs').util;

class PuterFSProvider {
    /**
     * Check if a given node exists.
     *
     * @param {Object} param
     * @param {NodeSelector} param.selector - The selector used for checking.
     * @returns {Promise<boolean>} - True if the node exists, false otherwise.
     */
    async quick_check ({
        selector,
    }) {
        // shortcut: has full path
        if ( selector?.path ) {
            const entry = await svc_fsEntryFetcher.findByPath(selector.path);
            return Boolean(entry);
        }

        // shortcut: has uid
        if ( selector?.uid ) {
            const entry = await svc_fsEntryFetcher.findByUID(selector.uid);
            return Boolean(entry);
        }

        // shortcut: parent uid + child name
        if ( selector instanceof NodeChildSelector && selector.parent instanceof NodeUIDSelector ) {
            return await svc_fsEntryFetcher.nameExistsUnderParent(selector.parent.uid,
                            selector.name);
        }

        // shortcut: parent id + child name
        if ( selector instanceof NodeChildSelector && selector.parent instanceof NodeInternalIDSelector ) {
            return await svc_fsEntryFetcher.nameExistsUnderParentID(selector.parent.id,
                            selector.name);
        }

        return false;
    }

    async unlink ({ context, node, options = {} }) {
        if ( await node.get('type') === TYPE_DIRECTORY ) {
            throw new APIError(409, 'Cannot unlink a directory.');
        }

        await this.#rmnode({ context, node, options });
    }

    async rmdir ({ context, node, options = {} }) {
        if ( await node.get('type') !== TYPE_DIRECTORY ) {
            throw new APIError(409, 'Cannot rmdir a file.');
        }

        if ( await node.get('immutable') ) {
            throw APIError.create('immutable');
        }

        const children = await svc_fsEntry.fast_get_direct_descendants(await node.get('uid'));

        if ( children.length > 0 && !options.ignore_not_empty ) {
            throw APIError.create('not_empty');
        }

        await this.#rmnode({ context, node, options });
    }

    /**
     * Create a new directory.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNode} param.parent
     * @param {string} param.name
     * @param {boolean} param.immutable
     * @returns {Promise<FSNode>}
     */
    async mkdir ({ context, parent, name, immutable }) {
        const { actor, thumbnail } = context.values;

        const ts = Math.round(Date.now() / 1000);
        const uid = uuidv4();

        const existing = await svc_fs.node(new NodeChildSelector(parent.selector, name));

        if ( await existing.exists() ) {
            throw APIError.create('item_with_same_name_exists', null, {
                entry_name: name,
            });
        }

        if ( ! await parent.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        svc_resource.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const raw_fsentry = {
            is_dir: 1,
            uuid: uid,
            parent_uid: await parent.get('uid'),
            path: path_.join(await parent.get('path'), name),
            user_id: actor.type.user.id,
            name,
            created: ts,
            accessed: ts,
            modified: ts,
            immutable: immutable ?? false,
            ...(thumbnail ? {
                thumbnail: thumbnail,
            } : {}),
        };

        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        await entryOp.awaitDone();
        svc_resource.free(uid);

        const node = await svc_fs.node(new NodeUIDSelector(uid));

        svc_event.emit('fs.create.directory', {
            node,
            context: Context.get(),
        });

        return node;
    }

    async read ({ context, node, version_id, range }) {
        const svc_mountpoint = context.get('services').get('mountpoint');
        const storage = svc_mountpoint.get_storage(this.constructor.name);
        const location = await node.get('s3:location') ?? {};
        const stream = (await storage.create_read_stream(await node.get('uid'), {
            // TODO: fs:decouple-s3
            bucket: location.bucket,
            bucket_region: location.bucket_region,
            version_id,
            key: location.key,
            memory_file: node.entry,
            ...(range ? { range } : {}),
        }));
        return stream;
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

        if ( options.tracer == null ) {
            options.tracer = svc_trace.tracer;
        }

        if ( options.op ) {
            options.trace_options = {
                parent: options.op.span,
            };
        }

        let entry;

        await new Promise (rslv => {
            const detachables = new MultiDetachable();

            const callback = (_resolver) => {
                detachables.as(TDetachable).detach();
                rslv();
            };

            // either the resource is free
            {
                // no detachale because waitForResource returns a
                // Promise that will be resolved when the resource
                // is free no matter what, and then it will be
                // garbage collected.
                svc_resource.waitForResource(selector).then(callback.bind(null, 'resourceService'));
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
                const det = svc_fsEntry.waitForEntry(node, callback.bind(null, 'fsEntryService'));
                if ( det ) detachables.add(det);
            }
        });

        const maybe_uid = node.uid;
        if ( svc_resource.getResourceInfo(maybe_uid) ) {
            entry = await svc_fsEntry.get(maybe_uid, options);
            controls.log.debug('got an entry from the future');
        } else {
            entry = await svc_fsEntryFetcher.find(selector, options);
        }

        if ( ! entry ) {
            if ( this.log_fsentriesNotFound ) {
                controls.log.warn(`entry not found: ${selector.describe(true)}`);
            }
        }

        if ( entry === null || typeof entry !== 'object' ) {
            return null;
        }

        if ( entry.id ) {
            controls.provide_selector(new NodeInternalIDSelector('mysql', entry.id, {
                source: 'FSNodeContext optimization',
            }));
        }

        return entry;
    }

    async copy_tree ({ context, source, parent, target_name }) {
        // Context
        const actor = (context ?? Context).get('actor');
        const user = actor.type.user;

        const tracer = svc_trace.tracer;
        const uuid = uuidv4();
        const timestamp = Math.round(Date.now() / 1000);
        await parent.fetchEntry();
        await source.fetchEntry({ thumbnail: true });

        // New filesystem entry
        const raw_fsentry = {
            uuid,
            is_dir: source.entry.is_dir,
            ...(source.entry.is_shortcut ? {
                is_shortcut: source.entry.is_shortcut,
                shortcut_to: source.entry.shortcut_to,
            } : {}),
            parent_uid: parent.uid,
            name: target_name,
            created: timestamp,
            modified: timestamp,

            path: path_.join(await parent.get('path'), target_name),

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
        });

        if ( await source.get('has-s3') ) {
            Object.assign(raw_fsentry, {
                size: source.entry.size,
                associated_app_id: source.entry.associated_app_id,
                bucket: source.entry.bucket,
                bucket_region: source.entry.bucket_region,
            });

            await tracer.startActiveSpan('fs:cp:storage-copy', async span => {
                let progress_tracker = new UploadProgressTracker();

                svc_event.emit('fs.storage.progress.copy', {
                    upload_tracker: progress_tracker,
                    context,
                    meta: {
                        item_uid: uuid,
                        item_path: raw_fsentry.path,
                    },
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
        await context.arun('fs:cp:parallel-portion', async () => {
            // Add child copy tasks if this is a directory
            if ( source.entry.is_dir ) {
                const children = await svc_fsEntry.fast_get_direct_descendants(source.uid);
                for ( const child_uuid of children ) {
                    tasks.add('fs:cp:copy-child', async () => {
                        const child_node = await svc_fs.node(new NodeUIDSelector(child_uuid));
                        const child_name = await child_node.get('name');

                        await this.copy_tree({
                            context,
                            source: await svc_fs.node(new NodeUIDSelector(child_uuid)),
                            parent: await svc_fs.node(new NodeUIDSelector(uuid)),
                            target_name: child_name,
                        });
                    });
                }
            }

            // Add task to await entry
            tasks.add('fs:cp:entry-op', async () => {
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
                });
            }, { force: true });

            await tasks.awaitAll();
        });

        node = node || await svc_fs.node(new NodeUIDSelector(uuid));

        // TODO: What event do we emit? How do we know if we're overwriting?
        return node;
    }

    async move ({ context, node, new_parent, new_name, metadata }) {
        const old_path = await node.get('path');
        const new_path = path_.join(await new_parent.get('path'), new_name);

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

        await svc_fs.update_child_paths(old_path, node.entry.path, user_id);

        const promises = [];
        promises.push(svc_event.emit('fs.move.file', {
            context,
            moved: node,
            old_path,
        }));
        promises.push(svc_event.emit('fs.rename', {
            uid: await node.get('uid'),
            new_name,
        }));

        return node;
    }

    async readdir ({ node }) {
        const uuid = await node.get('uid');
        const child_uuids = await svc_fsEntry.fast_get_direct_descendants(uuid);
        return child_uuids;
    }

    async #rmnode ({ node, options }) {
        // Services
        if ( !options.override_immutable && await node.get('immutable') ) {
            throw new APIError(403, 'File is immutable.');
        }

        const userId = await node.get('user_id');
        const fileSize = await node.get('size');
        svc_size.change_usage(userId,
                        -1 * fileSize);

        const ownerActor =  new Actor({
            type: new UserActorType({
                user: await get_user({ id: userId }),
            }),
        });

        svc_metering.incrementUsage(ownerActor, 'filesystem:delete:bytes', fileSize);

        const tracer = svc_trace.tracer;
        const tasks = new ParallelTasks({ tracer, max: 4 });

        tasks.add('remove-fsentry', async () => {
            await svc_fsEntry.delete(await node.get('uid'));
        });

        if ( await node.get('has-s3') ) {
            tasks.add('remove-from-s3', async () => {
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

const { TmpProxyFSProvider } = extension.import('fs');

extension.on('create.filesystem-types', event => {
    event.createFilesystemType('puterfs', {
        mount ({ path }) {
            return new TmpProxyFSProvider(path, new PuterFSProvider(path));
        },
    });
});
