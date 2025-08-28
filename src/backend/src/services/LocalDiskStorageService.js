// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { LocalDiskStorageStrategy } = require("../filesystem/strategies/storage_a/LocalDiskStorageStrategy");
const { PuterFSProvider } = require("../modules/puterfs/lib/PuterFSProvider");
const { TeePromise } = require('@heyputer/putility').libs.promise;
const { progress_stream, size_limit_stream } = require("../util/streamutil");
const BaseService = require("./BaseService");


/**
* @class LocalDiskStorageService
* @extends BaseService
*
* The LocalDiskStorageService class is responsible for managing local disk storage.
* It provides methods for storing, retrieving, and managing files on the local disk.
* This service extends the BaseService class to inherit common service functionalities.
*/
class LocalDiskStorageService extends BaseService {
    static MODULES = {
        fs: require('fs'),
        path: require('path'),
    }


    /**
    * Initializes the context for the storage service.
    *
    * This method registers the LocalDiskStorageStrategy with the context
    * initialization service and sets the storage for the mountpoint service.
    *
    * @returns {Promise<void>} A promise that resolves when the context is initialized.
    */
    async ['__on_install.context-initializers'] () {
        const svc_contextInit = this.services.get('context-init');
        const storage = new LocalDiskStorageStrategy({ services: this.services });
        svc_contextInit.register_value('storage', storage);
        
        const svc_mountpoint = this.services.get('mountpoint');
        svc_mountpoint.set_storage(PuterFSProvider.name, storage);
    }


    /**
    * Initializes the local disk storage service.
    *
    * This method sets up the storage directory and ensures it exists.
    *
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    */
    async _init () {
        const require = this.require;
        const path_ = require('path');

        this.path = path_.join(process.cwd(), '/storage');

        // ensure directory exists
        const fs = require('fs');
        await fs.promises.mkdir(this.path, { recursive: true });
    }

    _get_path (key) {
        const require = this.require;
        const path = require('path');
        return path.join(this.path, key);
    }


    /**
    * Stores a stream to local disk storage.
    *
    * This method takes a stream and stores it on the local disk under the specified key.
    * It also supports progress tracking and size limiting.
    *
    * @async
    * @function store_stream
    * @param {Object} options - The options object.
    * @param {string} options.key - The key under which the stream will be stored.
    * @param {number} options.size - The size of the stream.
    * @param {stream.Readable} options.stream - The readable stream to be stored.
    * @param {Function} [options.on_progress] - The callback function to track progress.
    * @returns {Promise} A promise that resolves when the stream is fully stored.
    */
    async store_stream ({ key, size, stream, on_progress }) {
        const require = this.require;
        const fs = require('fs');

        stream = progress_stream(stream, {
            total: size,
            progress_callback: on_progress,
        });
        
        stream = size_limit_stream(stream, {
            limit: size,
        });

        const writePromise = new TeePromise();

        const path = this._get_path(key);
        const write_stream = fs.createWriteStream(path);
        write_stream.on('error', () => writePromise.reject());
        write_stream.on('finish', () => writePromise.resolve());

        stream.pipe(write_stream);

        return await writePromise;
    }


    /**
    * Stores a buffer to the local disk.
    *
    * This method writes a given buffer to a file on the local disk, identified by a key.
    *
    * @param {Object} params - The parameters object.
    * @param {string} params.key - The key used to identify the file.
    * @param {Buffer} params.buffer - The buffer containing the data to be stored.
    * @returns {Promise<void>} A promise that resolves when the buffer is successfully stored.
    */
    async store_buffer ({ key, buffer }) {
        const require = this.require;
        const fs = require('fs');

        const path = this._get_path(key);
        await fs.promises.writeFile(path, buffer);
    }


    /**
    * Creates a read stream for a given key.
    *
    * @param {string} uid - The unique identifier for the file.
    * @param {Object} options - The options object.
    * @param {string} [options.range] - Optional range header (e.g., "bytes=0-1023").
    * @returns {stream.Readable} The read stream for the given key.
    */
    async create_read_stream (uid, options = {}) {
        const require = this.require;
        const fs = require('fs');

        const path = this._get_path(uid);
        
        // Handle range requests for partial content
        const { range } = options;
        if (range) {
            const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const endStr = rangeMatch[2];
                
                const streamOptions = { start };
                
                // If end is specified, set it (fs.createReadStream end is inclusive)
                if (endStr) {
                    streamOptions.end = parseInt(endStr, 10);
                }
                
                return fs.createReadStream(path, streamOptions);
            }
        }
        
        // Default: create stream for entire file
        return fs.createReadStream(path);
    }


    /**
    * Copies a file from one key to another within the local disk storage.
    *
    * @param {Object} params - The parameters for the copy operation.
    * @param {string} params.src_key - The source key of the file to be copied.
    * @param {string} params.dst_key - The destination key where the file will be copied.
    * @returns {Promise<void>} A promise that resolves when the file is successfully copied.
    */
    async copy ({ src_key, dst_key }) {
        const require = this.require;
        const fs = require('fs');

        const src_path = this._get_path(src_key);
        const dst_path = this._get_path(dst_key);

        await fs.promises.copyFile(src_path, dst_path);
    }


    /**
    * Deletes a file from the local disk storage.
    *
    * This method removes the file associated with the given key from the storage.
    *
    * @param {Object} params - The parameters for the delete operation.
    * @param {string} params.key - The key of the file to be deleted.
    * @returns {Promise} - A promise that resolves when the file is successfully deleted.
    */
    async delete ({ key }) {
        const require = this.require;
        const fs = require('fs');

        const path = this._get_path(key);
        await fs.promises.unlink(path);
    }
}

module.exports = LocalDiskStorageService;
