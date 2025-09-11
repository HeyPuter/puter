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
const { BaseOperation } = require("../../../services/OperationTraceService");

/**
 * Handles file upload operations to local disk storage.
 * Extends BaseOperation to provide upload functionality with progress tracking.
 */
class LocalDiskUploadStrategy extends BaseOperation {
    /**
     * Creates a new LocalDiskUploadStrategy instance.
     * @param {Object} parent - The parent storage strategy instance
     */
    constructor (parent) {
        super();
        this.parent = parent;
        this.uid = null;
    }

    /**
     * Executes the upload operation by storing file data to local disk.
     * Handles both buffer and stream-based uploads with progress tracking.
     * @returns {Promise<void>} Resolves when the upload is complete
     */
    async _run () {
        const { uid, file, storage_api } = this.values;

        const { progress_tracker } = storage_api;

        if ( file.buffer ) {
            await this.parent.svc_localDiskStorage.store_buffer({
                key: uid,
                buffer: file.buffer,
            });
            progress_tracker.set_total(file.buffer.length);
            progress_tracker.set(file.buffer.length);
        } else {
            await this.parent.svc_localDiskStorage.store_stream({
                key: uid,
                stream: file.stream,
                size: file.size,
                on_progress: evt => {
                    progress_tracker.set_total(file.size);
                    progress_tracker.set(evt.uploaded);
                }
            });
        }
    }

    /**
     * Hook called after the operation is inserted into the trace.
     */
    post_insert () {}
}

/**
 * Handles file copy operations within local disk storage.
 * Extends BaseOperation to provide copy functionality with progress tracking.
 */
class LocalDiskCopyStrategy extends BaseOperation {
    /**
     * Creates a new LocalDiskCopyStrategy instance.
     * @param {Object} parent - The parent storage strategy instance
     */
    constructor (parent) {
        super();
        this.parent = parent;
    }

    /**
     * Executes the copy operation by duplicating a file from source to destination.
     * Updates progress tracker to indicate completion.
     * @returns {Promise<void>} Resolves when the copy is complete
     */
    async _run () {
        const { src_node, dst_storage, storage_api } = this.values;
        const { progress_tracker } = storage_api;

        await this.parent.svc_localDiskStorage.copy({
            src_key: await src_node.get('uid'),
            dst_key: dst_storage.key,
        });

        // for now we just copy the file, we don't care about the progress
        progress_tracker.set_total(1);
        progress_tracker.set(1);
    }

    /**
     * Hook called after the operation is inserted into the trace.
     */
    post_insert () {}
}

/**
 * Handles file deletion operations from local disk storage.
 * Extends BaseOperation to provide delete functionality.
 */
class LocalDiskDeleteStrategy extends BaseOperation {
    /**
     * Creates a new LocalDiskDeleteStrategy instance.
     * @param {Object} parent - The parent storage strategy instance
     */
    constructor (parent) {
        super();
        this.parent = parent;
    }

    /**
     * Executes the delete operation by removing a file from local disk storage.
     * @returns {Promise<void>} Resolves when the deletion is complete
     */
    async _run () {
        const { node } = this.values;

        await this.parent.svc_localDiskStorage.delete({
            key: await node.get('uid'),
        });
    }
}

/**
 * Main strategy class for managing local disk storage operations.
 * Provides factory methods for creating upload, copy, and delete operations.
 */
class LocalDiskStorageStrategy {
    /**
     * Creates a new LocalDiskStorageStrategy instance.
     * @param {Object} config - Configuration object
     * @param {Object} config.services - Services container for dependency injection
     */
    constructor ({ services }) {
        this.svc_localDiskStorage = services.get('local-disk-storage');
    }

    /**
     * Creates a new upload operation instance.
     * @returns {LocalDiskUploadStrategy} A new upload strategy instance
     */
    create_upload () {
        return new LocalDiskUploadStrategy(this);
    }

    /**
     * Creates a new copy operation instance.
     * @returns {LocalDiskCopyStrategy} A new copy strategy instance
     */
    create_copy () {
        return new LocalDiskCopyStrategy(this);
    }

    /**
     * Creates a new delete operation instance.
     * @returns {LocalDiskDeleteStrategy} A new delete strategy instance
     */
    create_delete () {
        return new LocalDiskDeleteStrategy(this);
    }

    /**
     * Creates a readable stream for accessing file data from local disk storage.
     * @param {string} uid - The unique identifier of the file to read
     * @param {Object} [options={}] - Optional parameters for stream creation
     * @returns {Promise<ReadableStream>} A readable stream for the file data
     */
    async create_read_stream (uid, options = {}) {
        return await this.svc_localDiskStorage.create_read_stream(uid, options);
    }
}

module.exports = {
    LocalDiskStorageStrategy,
};
