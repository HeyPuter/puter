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
const config = require('../../config');
const { Context } = require('../../util/context');
const { ParallelTasks } = require('../../util/otelutil');
const FSNodeContext = require('../FSNodeContext');
const { NodeUIDSelector } = require('../node/selectors');
const { RESOURCE_STATUS_PENDING_CREATE } = require('../../modules/puterfs/ResourceService');
const { UploadProgressTracker } = require('../storage/UploadProgressTracker');
const { LLFilesystemOperation } = require('./definitions');

class LLCopy extends LLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
    }

    async _run () {
        const { _path, uuidv4 } = this.modules;
        const { context } = this;
        const { source, parent, user, actor, target_name } = this.values;
        const svc = context.get('services');

        const tracer = svc.get('traceService').tracer;
        const fs = svc.get('filesystem');
        const svc_event = svc.get('event');

        const uuid = uuidv4();
        const ts = Math.round(Date.now()/1000);

        this.field('target-uid', uuid);
        this.field('source', source.selector.describe());

        this.checkpoint('before fetch parent entry');
        await parent.fetchEntry();
        this.checkpoint('before fetch source entry');
        await source.fetchEntry({ thumbnail: true });
        this.checkpoint('fetched source and parent entries');

        console.log('PATH PARAMETERS', {
            path: await parent.get('path'),
            target_name,
        })

        // Access Control
        {
            const svc_acl = context.get('services').get('acl');
            this.checkpoint('copy :: access control');

            // Check read access to source
            if ( ! await svc_acl.check(actor, source, 'read') ) {
                throw await svc_acl.get_safe_acl_error(actor, source, 'read');
            }

            // Check write access to destination
            if ( ! await svc_acl.check(actor, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, source, 'write');
            }
        }

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
            context: this.context,
        })

        this.checkpoint('emitted fs.pending.file');

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
                    context: Context.get(),
                    meta: {
                        item_uid: uuid,
                        item_path: raw_fsentry.path,
                    }
                });

                this.checkpoint('emitted fs.storage.progress.copy');

                // const storage = new PuterS3StorageStrategy({ services: svc });
                const storage = Context.get('storage');
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

                this.checkpoint('finished storage copy');
                span.end();
            });
        }

        {
            const svc_size = svc.get('sizeService');
            await svc_size.add_node_size(undefined, source, user);

            this.checkpoint('added source size');
        }

        const svc_resource = svc.get('resourceService');
        svc_resource.register({
            uid: uuid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const svc_fsEntry = svc.get('fsEntryService');
        this.log.info(`inserting entry: ` + uuid);
        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        let node;

        this.checkpoint('before parallel tasks');
        const tasks = new ParallelTasks({ tracer, max: 4 });
        await Context.arun(`fs:cp:parallel-portion`, async () => {
            this.checkpoint('starting parallel tasks');
            // Add child copy tasks if this is a directory
            if ( source.entry.is_dir ) {
                const fsEntryService = svc.get('fsEntryService');
                const children = await fsEntryService.fast_get_direct_descendants(
                    source.uid
                );
                for ( const child_uuid of children ) {
                    tasks.add(`fs:cp:copy-child`, async () => {
                        const child_node = await fs.node(
                            new NodeUIDSelector(child_uuid)
                        );
                        const child_name = await child_node.get('name');
                        // TODO: this should be LLCopy instead
                        const ll_copy = new LLCopy();
                        await ll_copy.run({
                            source: await fs.node(
                                new NodeUIDSelector(child_uuid)
                            ),
                            parent: await fs.node(
                                new NodeUIDSelector(uuid)
                            ),
                            user,
                            target_name: child_name,
                        });
                    });
                }
            }

            // Add task to await entry
            tasks.add(`fs:cp:entry-op`, async () => {
                await entryOp.awaitDone();
                svc_resource.free(uuid);
                this.log.info(`done inserting entry: ` + uuid);
                const copy_fsNode = await fs.node(new NodeUIDSelector(uuid));
                copy_fsNode.entry = raw_fsentry;
                copy_fsNode.found = true;
                copy_fsNode.path = raw_fsentry.path;

                node = copy_fsNode;

                svc_event.emit('fs.create.file', {
                    node,
                    context: this.context,
                })
            }, { force: true });

            this.checkpoint('waiting for parallel tasks');
            await tasks.awaitAll();
            this.checkpoint('finishing up');
        });

        node = node || await fs.node(new NodeUIDSelector(uuid));

        // TODO: What event do we emit? How do we know if we're overwriting?
        return node;
    }
}

module.exports = {
    LLCopy,
};
