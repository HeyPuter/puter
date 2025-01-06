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
const { Context } = require("../../util/context");
const { LLFilesystemOperation } = require("./definitions");
const { RESOURCE_STATUS_PENDING_CREATE } = require("../../modules/puterfs/ResourceService.js");
const { NodeUIDSelector } = require("../node/selectors");
const { UploadProgressTracker } = require("../storage/UploadProgressTracker");
const FSNodeContext = require("../FSNodeContext");
const APIError = require("../../api/APIError");
const { progress_stream, stuck_detector_stream, hashing_stream } = require("../../util/streamutil");
const { OperationFrame } = require("../../services/OperationTraceService");
const { Actor } = require("../../services/auth/Actor");
const { DB_WRITE } = require("../../services/database/consts");

const crypto = require('crypto');

const STUCK_STATUS_TIMEOUT = 10 * 1000;
const STUCK_ALARM_TIMEOUT = 20 * 1000;

class LLWriteBase extends LLFilesystemOperation {
    static MODULES = {
        config: require('../../config.js'),
        simple_retry: require('../../util/retryutil.js').simple_retry,
    }

    async _storage_upload ({
        uuid,
        bucket, bucket_region, file,
        tmp,
    }) {
        const { config } = this.modules;

        const svc = Context.get('services');
        const log = svc.get('log-service').create('fs._storage_upload');
        const errors = svc.get('error-service').create(log);
        const svc_event = svc.get('event');

        const svc_mountpoint = svc.get('mountpoint');
        const storage = svc_mountpoint.get_storage();

        bucket        ??= config.s3_bucket;
        bucket_region ??= config.s3_region ?? config.region;

        let upload_tracker = new UploadProgressTracker();

        svc_event.emit('fs.storage.upload-progress', {
            upload_tracker,
            context: Context.get(),
            meta: {
                item_uid: uuid,
                item_path: tmp.path,
            }
        })

        if ( ! file.buffer ) {
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
                }
            });
            file = { ...file, stream, };
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
            const svc_event = Context.get('services').get('event');
            console.log('\x1B[36;1m[fs.write]', uuid, hash);
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
}

class LLOWrite extends LLWriteBase {
    async _run () {
        const {
            node, actor, immutable,
            file, tmp, fsentry_tmp,
            message,
        } = this.values;

        const svc = Context.get('services');
        const sizeService = svc.get('sizeService');
        const resourceService = svc.get('resourceService');
        const svc_fsEntry = svc.get('fsEntryService');
        const svc_event = svc.get('event');

        // TODO: fs:decouple-versions
        //       add version hook externally so LLCWrite doesn't
        //       need direct database access
        const db = svc.get('database').get(DB_WRITE, 'filesystem');

        // TODO: Add symlink write
        if ( ! await node.exists() ) {
            // TODO: different class of errors for low-level operations
            throw APIError.create('subject_does_not_exist');
        }

        const svc_acl = this.context.get('services').get('acl');
        if ( ! await svc_acl.check(actor, node, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, node, 'write');
        }

        const uid = await node.get('uid');

        const bucket_region = node.entry.bucket_region;
        const bucket = node.entry.bucket;

        const state_upload = await this._storage_upload({
            uuid: node.entry.uuid,
            bucket, bucket_region, file,
            tmp: {
                ...tmp,
                path: await node.get('path'),
            }
        });

        fsentry_tmp.thumbnail = await fsentry_tmp.thumbnail_promise;
        delete fsentry_tmp.thumbnail_promise;

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

        const entryOp = await svc_fsEntry.update(uid, raw_fsentry_delta);

        // depends on fsentry, does not depend on S3
        (async () => {
            await entryOp.awaitDone();
            this.log.debug('[owrite] finished creating fsentry', { uid })
            resourceService.free(uid);
        })();

        state_upload.post_insert({
            db, user: actor.type.user, node, uid, message, ts,
        });

        const svc_fileCache = this.context.get('services').get('file-cache');
        await svc_fileCache.invalidate(node);

        svc_event.emit('fs.write.file', {
            node,
            context: this.context,
        });

        return node;
    }
}

class LLCWrite extends LLWriteBase {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
        config: require('../../config.js'),
    }

    async _run () {
        const { _path, uuidv4, config } = this.modules;
        const {
            parent, name, immutable,
            file, tmp, fsentry_tmp,
            message,

            actor: actor_let,
            app_id,
        } = this.values;
        let actor = actor_let;

        const svc = Context.get('services');
        const sizeService = svc.get('sizeService');
        const resourceService = svc.get('resourceService');
        const svc_fsEntry = svc.get('fsEntryService');
        const svc_event = svc.get('event');
        const fs = svc.get('filesystem');

        // TODO: fs:decouple-versions
        //       add version hook externally so LLCWrite doesn't
        //       need direct database access
        const db = svc.get('database').get(DB_WRITE, 'filesystem');

        const uid = uuidv4();
        this.field('fsentry-uid', uid);

        // determine bucket region
        let bucket_region = config.s3_region ?? config.region;
        let bucket = config.s3_bucket;

        this.checkpoint('before acl');
        if ( ! await parent.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        const svc_acl = this.context.get('services').get('acl');
        actor = actor ?? Context.get('actor');
        if ( ! await svc_acl.check(actor, parent, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, parent, 'write');
        }

        this.checkpoint('before storage upload');

        const storage_resp = await this._storage_upload({
            uuid: uid,
            bucket, bucket_region, file,
            tmp: {
                ...tmp,
                path: _path.join(await parent.get('path'), name),
            }
        });

        this.checkpoint('after storage upload');

        fsentry_tmp.thumbnail = await fsentry_tmp.thumbnail_promise;
        delete fsentry_tmp.thumbnail_promise;

        this.checkpoint('after thumbnail promise');

        const ts = Math.round(Date.now() / 1000);
        const raw_fsentry = {
            uuid: uid,
            is_dir: 0,
            user_id: actor.type.user.id,
            created: ts,
            accessed: ts,
            modified: ts,
            parent_uid: await parent.get('uid'),
            name,
            size: file.size,
            path: _path.join(await parent.get('path'), name),
            ...fsentry_tmp,

            bucket_region,
            bucket,

            associated_app_id: app_id ?? null,
        };

        svc_event.emit('fs.pending.file', {
            fsentry: FSNodeContext.sanitize_pending_entry_info(raw_fsentry),
            context: this.context,
        })

        this.checkpoint('after emit pending file');

        resourceService.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const filesize = file.size;
        sizeService.change_usage(actor.type.user.id, filesize);

        this.checkpoint('after change_usage');

        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        this.checkpoint('after fsentry insert enqueue');

        (async () => {
            await entryOp.awaitDone();
            this.log.debug('finished creating fsentry', { uid })
            resourceService.free(uid);

            const new_item_node = await fs.node(new NodeUIDSelector(uid));
            const new_item = await new_item_node.get('entry');
            const store_version_id = storage_resp.VersionId;
            if( store_version_id ){
                // insert version into db
                db.write(
                    "INSERT INTO `fsentry_versions` (`user_id`, `fsentry_id`, `fsentry_uuid`, `version_id`, `message`, `ts_epoch`) VALUES (?, ?, ?, ?, ?, ?)",
                    [
                        actor.type.user.id,
                        new_item.id,
                        new_item.uuid,
                        store_version_id,
                        message ?? null,
                        ts,
                    ]
                );
        }
        })();

        this.checkpoint('after version IIAFE');

        const node = await fs.node(new NodeUIDSelector(uid));

        this.checkpoint('after create FSNodeContext');

        svc_event.emit('fs.create.file', {
            node,
            context: this.context,
        });

        this.checkpoint('return result');

        return node;
    }
}

module.exports = {
    LLCWrite,
    LLOWrite,
};
