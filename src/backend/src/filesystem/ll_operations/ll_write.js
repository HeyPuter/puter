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
const { stuck_detector_stream, hashing_stream } = require("../../util/streamutil");
const { OperationFrame } = require("../../services/OperationTraceService");
const { DB_WRITE } = require("../../services/database/consts");

const crypto = require('crypto');

const STUCK_STATUS_TIMEOUT = 10 * 1000;
const STUCK_ALARM_TIMEOUT = 20 * 1000;

/**
 * Base class for low-level write operations providing common storage upload functionality.
 * @extends LLFilesystemOperation
 */
class LLWriteBase extends LLFilesystemOperation {
    static MODULES = {
        config: require('../../config.js'),
        simple_retry: require('../../util/retryutil.js').simple_retry,
    }

    /**
     * Uploads a file to storage with progress tracking and error handling.
     * @param {Object} params - Upload parameters
     * @param {string} params.uuid - Unique identifier for the file
     * @param {string} [params.bucket] - Storage bucket name
     * @param {string} [params.bucket_region] - Storage bucket region
     * @param {Object} params.file - File object containing stream or buffer
     * @param {Object} params.tmp - Temporary file information
     * @returns {Promise<Object>} The upload state object
     * @throws {APIError} When upload fails
     */
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
        // TODO (xiaochen): what if the provider is not PuterFSProvider?
        const storage = svc_mountpoint.get_storage(PuterFSProvider.name);

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

/**
 * The "overwrite" write operation.
 * 
 * This operation is used to write a file to an existing path.
 * 
 * @extends LLWriteBase
 */
class LLOWrite extends LLWriteBase {
    /**
     * Executes the overwrite operation by writing to an existing file node.
     * @returns {Promise<Object>} Result of the write operation
     * @throws {APIError} When the target node does not exist
     */
    async _run () {
        const node = this.values.node;

        // Embed fields into this.context
        this.context.set('immutable', this.values.immutable);
        this.context.set('tmp', this.values.tmp);
        this.context.set('fsentry_tmp', this.values.fsentry_tmp);
        this.context.set('message', this.values.message);
        this.context.set('actor', this.values.actor);
        this.context.set('app_id', this.values.app_id);

        // TODO: Add symlink write
        if ( ! await node.exists() ) {
            // TODO: different class of errors for low-level operations
            throw APIError.create('subject_does_not_exist');
        }

        return await node.provider.write_overwrite({
            context: this.context,
            node: node,
            file: this.values.file,
        });
    }
}

/**
 * The "non-overwrite" write operation.
 * 
 * This operation is used to write a file to a non-existent path.
 * 
 * @extends LLWriteBase
 */
class LLCWrite extends LLWriteBase {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
        config: require('../../config.js'),
    }

    /**
     * Executes the create operation by writing a new file to the parent directory.
     * @returns {Promise<Object>} Result of the write operation
     * @throws {APIError} When the parent directory does not exist
     */
    async _run () {
        const parent = this.values.parent;

        // Embed fields into this.context
        this.context.set('immutable', this.values.immutable);
        this.context.set('tmp', this.values.tmp);
        this.context.set('fsentry_tmp', this.values.fsentry_tmp);
        this.context.set('message', this.values.message);
        this.context.set('actor', this.values.actor);
        this.context.set('app_id', this.values.app_id);

        if ( ! await parent.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        return await parent.provider.write_new({
            context: this.context,
            parent,
            name: this.values.name,
            file: this.values.file,
        });
    }
}

module.exports = {
    LLCWrite,
    LLOWrite,
};
