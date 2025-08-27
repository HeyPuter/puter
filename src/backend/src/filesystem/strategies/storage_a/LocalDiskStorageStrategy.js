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

class LocalDiskUploadStrategy extends BaseOperation {
    constructor (parent) {
        super();
        this.parent = parent;
        this.uid = null;
    }

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

    post_insert () {}
}

class LocalDiskCopyStrategy extends BaseOperation {
    constructor (parent) {
        super();
        this.parent = parent;
    }

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

    post_insert () {}
}

class LocalDiskDeleteStrategy extends BaseOperation {
    constructor (parent) {
        super();
        this.parent = parent;
    }

    async _run () {
        const { node } = this.values;

        await this.parent.svc_localDiskStorage.delete({
            key: await node.get('uid'),
        });
    }
}

class LocalDiskStorageStrategy {
    constructor ({ services }) {
        this.svc_localDiskStorage = services.get('local-disk-storage');
    }
    create_upload () {
        return new LocalDiskUploadStrategy(this);
    }
    create_copy () {
        return new LocalDiskCopyStrategy(this);
    }
    create_delete () {
        return new LocalDiskDeleteStrategy(this);
    }

    async create_read_stream (uid, options = {}) {
        return await this.svc_localDiskStorage.create_read_stream(uid, options);
    }
}

module.exports = {
    LocalDiskStorageStrategy,
};
