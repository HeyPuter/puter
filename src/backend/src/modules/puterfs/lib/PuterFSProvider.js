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
const { NodeInternalIDSelector, NodeChildSelector, NodeUIDSelector } = require('../../../filesystem/node/selectors');
const { Context } = require('../../../util/context');
const fsCapabilities = require('../../../filesystem/definitions/capabilities');
const { UploadProgressTracker } = require('../../../filesystem/storage/UploadProgressTracker');
const FSNodeContext = require('../../../filesystem/FSNodeContext');
const { RESOURCE_STATUS_PENDING_CREATE } = require('../ResourceService');
const { ParallelTasks } = require('../../../util/otelutil');
const { TYPE_DIRECTORY } = require('../../../filesystem/FSNodeContext');
const APIError = require('../../../api/APIError');
const { MODE_WRITE } = require('../../../services/fs/FSLockService');
const { DB_WRITE } = require('../../../services/database/consts');
const { stuck_detector_stream, hashing_stream } = require('../../../util/streamutil');
const crypto = require('crypto');
const { OperationFrame } = require('../../../services/OperationTraceService');
const path = require('path');
const uuidv4 = require('uuid').v4;
const config = require('../../../config.js');
const { Actor } = require('../../../services/auth/Actor.js');
const { UserActorType } = require('../../../services/auth/Actor.js');
const { get_user } = require('../../../helpers.js');

const STUCK_STATUS_TIMEOUT = 10 * 1000;
const STUCK_ALARM_TIMEOUT = 20 * 1000;

class PuterFSProvider extends putility.AdvancedBase {

    get #services() { // we really should just pass services in constructor, global state is a bit messy
        return Context.get('services');
    }

    /** @type {import('../../../services/MeteringService/MeteringService.js').MeteringService} */
    get #meteringService() {
        return this.#services.get('meteringService').meteringService;
    }

    constructor(...a) {
        super(...a);
        this.log_fsentriesNotFound = (config.logging ?? [])
            .includes('fsentries-not-found');
    }

    get_capabilities() {
        return new Set([
            fsCapabilities.THUMBNAIL,
            fsCapabilities.UPDATE_THUMBNAIL,
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

    /**
     * Check if a given node exists.
     *
     * @param {Object} param
     * @param {NodeSelector} param.selector - The selector used for checking.
     * @returns {Promise<boolean>} - True if the node exists, false otherwise.
     */
    async quick_check({
        selector,
    }) {
        // a wrapper that access underlying database directly
        const fsEntryFetcher = this.#services.get('fsEntryFetcher');

        // shortcut: has full path
        if ( selector?.path ) {
            const entry = await fsEntryFetcher.findByPath(selector.path);
            return Boolean(entry);
        }

        // shortcut: has uid
        if ( selector?.uid ) {
            const entry = await fsEntryFetcher.findByUID(selector.uid);
            return Boolean(entry);
        }

        // shortcut: parent uid + child name
        if ( selector instanceof NodeChildSelector && selector.parent instanceof NodeUIDSelector ) {
            return await fsEntryFetcher.nameExistsUnderParent(selector.parent.uid,
                            selector.name);
        }

        // shortcut: parent id + child name
        if ( selector instanceof NodeChildSelector && selector.parent instanceof NodeInternalIDSelector ) {
            return await fsEntryFetcher.nameExistsUnderParentID(selector.parent.id,
                            selector.name);
        }

        // TODO (xiaochen): we should fallback to stat but we cannot at this moment
        // since stat requires a valid `FSNodeContext` argument.
        return false;
    }

    async stat({
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
        } = this.#services.values;

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
                resourceService.waitForResource(selector).then(callback.bind(null, 'resourceService'));
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
                const det = fsEntryService.waitForEntry(node, callback.bind(null, 'fsEntryService'));
                if ( det ) detachables.add(det);
            }
        });

        const maybe_uid = node.uid;
        if ( resourceService.getResourceInfo(maybe_uid) ) {
            entry = await fsEntryService.get(maybe_uid, options);
            controls.log.debug('got an entry from the future');
        } else {
            entry = await fsEntryFetcher.find(selector, options);
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

    async readdir({ node }) {
        const uuid = await node.get('uid');
        const svc_fsentry = this.#services.get('fsEntryService');
        const child_uuids = await svc_fsentry
            .fast_get_direct_descendants(uuid);
        return child_uuids;
    }

    async move({ context, node, new_parent, new_name, metadata }) {

        const old_path = await node.get('path');
        const new_path = path.join(await new_parent.get('path'), new_name);

        const svc_fsEntry = this.#services.get('fsEntryService');
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

        const svc_fs = this.#services.get('filesystem');
        await svc_fs.update_child_paths(old_path, node.entry.path, user_id);

        const svc_event = this.#services.get('event');

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

    async copy_tree({ context, source, parent, target_name }) {
        return await this.#copy_tree({ context, source, parent, target_name });
    }
    async #copy_tree({ context, source, parent, target_name }) {
        // Services
        const svc_event = this.#services.get('event');
        const svc_trace = this.#services.get('traceService');
        const svc_size = this.#services.get('sizeService');
        const svc_resource = this.#services.get('resourceService');
        const svc_fsEntry = this.#services.get('fsEntryService');
        const svc_fs = this.#services.get('filesystem');

        // Context
        const actor = Context.get('actor');
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

            path: path.join(await parent.get('path'), target_name),

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
                        // TODO: this should be LLCopy instead
                        await this.#copy_tree({
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

    async unlink({ context, node, options = {} }) {
        if ( await node.get('type') === TYPE_DIRECTORY ) {
            console.log(`\x1B[31;1m===N=====${await node.get('path')}=========\x1B[0m`);
            throw new APIError(409, 'Cannot unlink a directory.');
        }

        await this.#rmnode({ context, node, options });
    }

    async rmdir({ context, node, options = {} }) {
        if ( await node.get('type') !== TYPE_DIRECTORY ) {
            console.log(`\x1B[31;1m===D1====${await node.get('path')}=========\x1B[0m`);
            throw new APIError(409, 'Cannot rmdir a file.');
        }

        if ( await node.get('immutable') ) {
            console.log(`\x1B[31;1m===D2====${await node.get('path')}=========\x1B[0m`);
            throw APIError.create('immutable');
        }

        // Services
        const svc_fsEntry = this.#services.get('fsEntryService');

        const children = await svc_fsEntry.fast_get_direct_descendants(await node.get('uid'));

        if ( children.length > 0 && ! options.ignore_not_empty ) {
            console.log(`\x1B[31;1m===D3====${await node.get('path')}=========\x1B[0m`);
            throw APIError.create('not_empty');
        }

        await this.#rmnode({ context, node, options });
    }

    async #rmnode({ node, options }) {
        // Services
        const svc_size = this.#services.get('sizeService');
        const svc_fsEntry = this.#services.get('fsEntryService');

        if ( ! options.override_immutable && await node.get('immutable') ) {
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

        this.#meteringService.incrementUsage(ownerActor, 'filesystem:delete:bytes', fileSize);

        const tracer = this.#services.get('traceService').tracer;
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
    async mkdir({ context, parent, name, immutable }) {
        const { actor, thumbnail } = context.values;

        const svc_fslock = this.#services.get('fslock');
        const lock_handle = await svc_fslock.lock_child(await parent.get('path'),
                        name,
                        MODE_WRITE);

        try {
            const ts = Math.round(Date.now() / 1000);
            const uid = uuidv4();
            const resourceService = this.#services.get('resourceService');
            const svc_fsEntry = this.#services.get('fsEntryService');
            const svc_event = this.#services.get('event');
            const fs = this.#services.get('filesystem');

            const existing = await fs.node(new NodeChildSelector(parent.selector, name));

            if ( await existing.exists() ) {
                throw APIError.create('item_with_same_name_exists', null, {
                    entry_name: name,
                });
            }

            const svc_acl = this.#services.get('acl');
            if ( ! await parent.exists() ) {
                throw APIError.create('subject_does_not_exist');
            }
            if ( ! await svc_acl.check(actor, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, parent, 'write');
            }

            resourceService.register({
                uid,
                status: RESOURCE_STATUS_PENDING_CREATE,
            });

            const raw_fsentry = {
                is_dir: 1,
                uuid: uid,
                parent_uid: await parent.get('uid'),
                path: path.join(await parent.get('path'), name),
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
            resourceService.free(uid);

            const node = await fs.node(new NodeUIDSelector(uid));

            svc_event.emit('fs.create.directory', {
                node,
                context: Context.get(),
            });

            return node;
        } finally {
            await lock_handle.unlock();
        }
    }
    
    async update_thumbnail({ context, node, thumbnail }) {
        const {
            actor: inputActor,
        } = context.values;
        const actor = inputActor ?? Context.get('actor');
        
        context = context ?? Context.get();
        const services = context.get('services');

        const svc_fsEntry = services.get('fsEntryService');
        const svc_event = services.get('event');

        const svc_acl = services.get('acl');
        if ( ! await svc_acl.check(actor, node, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, node, 'write');
        }

        const uid = await node.get('uid');

        const entryOp = await svc_fsEntry.update(uid, {
            thumbnail
        });

        (async () => {
            await entryOp.awaitDone();
            svc_event.emit('fs.write.file', {
                node,
                context,
            });
        })();

        return node;
    }

    /**
     * Write a new file to the filesystem. Throws an error if the destination
     * already exists.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNode} param.parent: The parent directory of the file.
     * @param {string} param.name: The name of the file.
     * @param {File} param.file: The file to write.
     * @returns {Promise<FSNode>}
     */
    async write_new({ context, parent, name, file }) {
        const {
            tmp, fsentry_tmp, message, actor: inputActor, app_id,
        } = context.values;
        const actor = inputActor ?? Context.get('actor');

        const sizeService = this.#services.get('sizeService');
        const resourceService = this.#services.get('resourceService');
        const svc_fsEntry = this.#services.get('fsEntryService');
        const svc_event = this.#services.get('event');
        const fs = this.#services.get('filesystem');

        // TODO: fs:decouple-versions
        //       add version hook externally so LLCWrite doesn't
        //       need direct database access
        const db = this.#services.get('database').get(DB_WRITE, 'filesystem');

        const uid = uuidv4();

        // determine bucket region
        let bucket_region = config.s3_region ?? config.region;
        let bucket = config.s3_bucket;

        const svc_acl = this.#services.get('acl');
        if ( ! await svc_acl.check(actor, parent, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, parent, 'write');
        }

        const storage_resp = await this.#storage_upload({
            uuid: uid,
            bucket,
            bucket_region,
            file,
            tmp: {
                ...tmp,
                path: path.join(await parent.get('path'), name),
            },
        });

        fsentry_tmp.thumbnail = await fsentry_tmp.thumbnail_promise;
        delete fsentry_tmp.thumbnail_promise;

        const timestamp = Math.round(Date.now() / 1000);
        const raw_fsentry = {
            uuid: uid,
            is_dir: 0,
            user_id: actor.type.user.id,
            created: timestamp,
            accessed: timestamp,
            modified: timestamp,
            parent_uid: await parent.get('uid'),
            name,
            size: file.size,
            path: path.join(await parent.get('path'), name),
            ...fsentry_tmp,
            bucket_region,
            bucket,
            associated_app_id: app_id ?? null,
        };

        svc_event.emit('fs.pending.file', {
            fsentry: FSNodeContext.sanitize_pending_entry_info(raw_fsentry),
            context,
        });

        resourceService.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const filesize = file.size;
        sizeService.change_usage(actor.type.user.id, filesize);

        // Meter ingress
        const ownerId = await parent.get('user_id');
        const ownerActor =  new Actor({
            type: new UserActorType({
                user: await get_user({ id: ownerId }),
            }),
        });

        this.#meteringService.incrementUsage(ownerActor, 'filesystem:ingress:bytes', filesize);

        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        (async () => {
            await entryOp.awaitDone();
            resourceService.free(uid);

            const new_item_node = await fs.node(new NodeUIDSelector(uid));
            const new_item = await new_item_node.get('entry');
            const store_version_id = storage_resp.VersionId;
            if ( store_version_id ){
                // insert version into db
                db.write('INSERT INTO `fsentry_versions` (`user_id`, `fsentry_id`, `fsentry_uuid`, `version_id`, `message`, `ts_epoch`) VALUES (?, ?, ?, ?, ?, ?)',
                                [
                                    actor.type.user.id,
                                    new_item.id,
                                    new_item.uuid,
                                    store_version_id,
                                    message ?? null,
                                    timestamp,
                                ]);
            }
        })();

        const node = await fs.node(new NodeUIDSelector(uid));

        svc_event.emit('fs.create.file', {
            node,
            context,
        });

        return node;
    }

    /**
     * Overwrite an existing file. Throws an error if the destination does not
     * exist.
     *
     * @param {Object} param
     * @param {Context} param.context
     * @param {FSNodeContext} param.node: The node to write to.
     * @param {File} param.file: The file to write.
     * @returns {Promise<FSNodeContext>}
     */
    async write_overwrite({ context, node, file }) {
        const {
            tmp, fsentry_tmp, message, actor: inputActor,
        } = context.values;
        const actor = inputActor ?? Context.get('actor');

        const sizeService = this.#services.get('sizeService');
        const resourceService = this.#services.get('resourceService');
        const svc_fsEntry = this.#services.get('fsEntryService');
        const svc_event = this.#services.get('event');

        // TODO: fs:decouple-versions
        //       add version hook externally so LLCWrite doesn't
        //       need direct database access
        const db = this.#services.get('database').get(DB_WRITE, 'filesystem');

        const svc_acl = this.#services.get('acl');
        if ( ! await svc_acl.check(actor, node, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, node, 'write');
        }

        const uid = await node.get('uid');

        const bucket_region = node.entry.bucket_region;
        const bucket = node.entry.bucket;

        const state_upload = await this.#storage_upload({
            uuid: node.entry.uuid,
            bucket,
            bucket_region,
            file,
            tmp: {
                ...tmp,
                path: await node.get('path'),
            },
        });

        if ( fsentry_tmp?.thumbnail_promise ) {
            fsentry_tmp.thumbnail = await fsentry_tmp.thumbnail_promise;
            delete fsentry_tmp.thumbnail_promise;
        }

        const ts = Math.round(Date.now() / 1000);
        const raw_fsentry_delta = {
            modified: ts,
            accessed: ts,
            size: file.size,
            ...fsentry_tmp,
        };

        resourceService.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const filesize = file.size;
        sizeService.change_usage(actor.type.user.id, filesize);

        // Meter ingress
        const ownerId = await node.get('user_id');
        const ownerActor =  new Actor({
            type: new UserActorType({
                user: await get_user({ id: ownerId }),
            }),
        });
        this.#meteringService.incrementUsage(ownerActor, 'filesystem:ingress:bytes', filesize);

        const entryOp = await svc_fsEntry.update(uid, raw_fsentry_delta);

        // depends on fsentry, does not depend on S3
        const entryOpPromise = (async () => {
            await entryOp.awaitDone();
            resourceService.free(uid);
        })();

        const cachePromise = (async () => {
            const svc_fileCache = this.#services.get('file-cache');
            await svc_fileCache.invalidate(node);
        })();

        (async () => {
            await Promise.all([entryOpPromise, cachePromise]);
            svc_event.emit('fs.write.file', {
                node,
                context,
            });
        })();

        // TODO (xiaochen): determine if this can be removed, post_insert handler need
        // to skip events from other servers (why? 1. current write logic is inside
        // the local server 2. broadcast system conduct "fire-and-forget" behavior)
        state_upload.post_insert({
            db, user: actor.type.user, node, uid, message, ts,
        });

        await cachePromise;

        return node;
    }
    /**
    * @param {Object} param
    * @param {File} param.file: The file to write.
    * @returns
    */
    async #storage_upload({
        uuid,
        bucket,
        bucket_region,
        file,
        tmp,
    }) {
        const log = this.#services.get('log-service').create('fs.#storage_upload');
        const errors = this.#services.get('error-service').create(log);
        const svc_event = this.#services.get('event');

        const svc_mountpoint = this.#services.get('mountpoint');
        const storage = svc_mountpoint.get_storage(this.constructor.name);

        bucket ??= config.s3_bucket;
        bucket_region ??= config.s3_region ?? config.region;

        let upload_tracker = new UploadProgressTracker();

        svc_event.emit('fs.storage.upload-progress', {
            upload_tracker,
            context: Context.get(),
            meta: {
                item_uid: uuid,
                item_path: tmp.path,
            },
        });

        if ( !file.buffer ) {
            let stream = file.stream;
            let alarm_timeout = null;
            stream = stuck_detector_stream(stream, {
                timeout: STUCK_STATUS_TIMEOUT,
                on_stuck: () => {
                    this.frame.status = OperationFrame.FRAME_STATUS_STUCK;
                    log.warn('Upload stream stuck might be stuck', {
                        bucket_region,
                        bucket,
                        uuid,
                    });
                    alarm_timeout = setTimeout(() => {
                        errors.report('fs.write.s3-upload', {
                            message: 'Upload stream stuck for too long',
                            alarm: true,
                            extra: {
                                bucket_region,
                                bucket,
                                uuid,
                            },
                        });
                    }, STUCK_ALARM_TIMEOUT);
                },
                on_unstuck: () => {
                    clearTimeout(alarm_timeout);
                    this.frame.status = OperationFrame.FRAME_STATUS_WORKING;
                },
            });
            file = { ...file, stream };
        }

        let hashPromise;
        if ( file.buffer ) {
            const hash = crypto.createHash('sha256');
            hash.update(file.buffer);
            hashPromise = Promise.resolve(hash.digest('hex'));
        } else {
            const hs = hashing_stream(file.stream);
            file.stream = hs.stream;
            hashPromise = hs.hashPromise;
        }

        hashPromise.then(hash => {
            const svc_event = this.#services.get('event');
            svc_event.emit('outer.fs.write-hash', {
                hash, uuid,
            });
        });

        const state_upload = storage.create_upload();

        try {
            await state_upload.run({
                uid: uuid,
                file,
                storage_meta: { bucket, bucket_region },
                storage_api: { progress_tracker: upload_tracker },
            });
        } catch (e) {
            errors.report('fs.write.storage-upload', {
                source: e || new Error('unknown'),
                trace: true,
                alarm: true,
                extra: {
                    bucket_region,
                    bucket,
                    uuid,
                },
            });
            throw APIError.create('upload_failed');
        }

        return state_upload;
    }
    
    async read({
        context,
        node,
        version_id,
        range,
    }) {
        // TODO: one PuterFS aggregates its own storage, don't get it
        //       via mountpoint service.
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
}

module.exports = {
    PuterFSProvider,
};
