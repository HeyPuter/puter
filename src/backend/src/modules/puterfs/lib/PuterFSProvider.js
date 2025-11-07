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

    get #services () { // we really should just pass services in constructor, global state is a bit messy
        return Context.get('services');
    }

    /** @type {import('../../../services/MeteringService/MeteringService.js').MeteringService} */
    get #meteringService () {
        return this.#services.get('meteringService').meteringService;
    }

    constructor (...a) {
        super(...a);
        this.log_fsentriesNotFound = (config.logging ?? [])
            .includes('fsentries-not-found');
    }

    get_capabilities () {
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
    async quick_check ({
        selector,
    }) {
        console.error('This .quick_check should not be called!');
        throw new Error('This .quick_check should not be called!');
    }

    async stat ({
        selector,
        options,
        controls,
        node,
    }) {
        console.error('This .stat should not be called!');
        throw new Error('This .stat should not be called!');
    }

    async readdir ({ node }) {
        console.error('This .readdir should not be called!');
        throw new Error('This .readdir should not be called!');
    }

    async move ({ context, node, new_parent, new_name, metadata }) {
        console.error('This .move should not be called!');
        throw new Error('This .move should not be called!');
    }

    async copy_tree ({ context, node, options = {} }) {
        console.error('This .copy_tree should not be called!');
        throw new Error('This .copy_tree should not be called!');
    }

    async unlink ({ context, node, options = {} }) {
        console.error('This .unlink should not be called!');
        throw new Error('This .unlink should not be called!');
    }

    async rmdir ({ context, node, options = {} }) {
        console.error('This .rmdir should not be called!');
        throw new Error('This .rmdir should not be called!');
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
        console.error('This .mkdir should not be called!');
        throw new Error('This .mkdir should not be called!');
    }

    async update_thumbnail ({ context, node, thumbnail }) {
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
            thumbnail,
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
    async write_new ({ context, parent, name, file }) {
        console.error('This .write_new should not be called!');
        throw new Error('This .write_new should not be called!');
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
    async write_overwrite ({ context, node, file }) {
        console.error('This .write_overwrite should not be called!');
        throw new Error('This .write_overwrite should not be called!');
    }

    /**
    * @param {Object} param
    * @param {File} param.file: The file to write.
    * @returns
    */
    async #storage_upload ({
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

    async read ({
        context,
        node,
        version_id,
        range,
    }) {
        console.error('This .read should not be called!');
        throw new Error('This .read should not be called!');
    }
}

module.exports = {
    PuterFSProvider,
};
