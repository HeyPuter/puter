// METADATA // {"ai-commented":{"service":"xai"}}
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
const TeePromise = require("@heyputer/multest/src/util/TeePromise");
const { AdvancedBase } = require("@heyputer/putility");
const { FileTracker } = require("./FileTracker");
const { pausing_tee } = require("../../util/streamutil");

/**
 * FileCacheService
 *
 * Initial naive cache implementation which stores whole files on disk.
 * It is assumed that files are only accessed by one server at a given time,
 * so this will need to be revised when ACL and sharing is implemented.
 */
/**
* @class FileCacheService
* @extends AdvancedBase
* @description
* The FileCacheService class manages a cache for file storage and retrieval in the Puter system. 
* This service provides functionalities to:
* - Cache files either in memory (precache) or on disk.
* - Track file usage with FileTracker instances to manage cache eviction policies.
* - Ensure files are stored within configured limits for both disk and memory usage.
* - Provide methods for initializing the cache, storing, retrieving, and invalidating cached files.
* - Register commands for managing and inspecting the cache status.
* 
* @property {Object} MODULES - Static property containing module dependencies.
* @property {number} disk_limit - The maximum size allowed for disk storage of cached files.
* @property {number} disk_max_size - The maximum size of a file that can be cached on disk.
* @property {number} precache_size - The size limit for memory (precache) storage.
* @property {string} path - The directory path where cached files are stored on disk.
* @property {number} ttl - Time-to-live for cached files, after which they are considered for eviction.
* @property {Map} precache - A Map to hold files in memory.
* @property {Map} uid_to_tracker - A Map to track each file with its FileTracker instance.
*/
class FileCacheService extends AdvancedBase {
    static MODULES = {
        fs: require('fs'),
        path_: require('path'),
    }

    constructor ({ services, my_config }) {
        super({ services });

        this.log = services.get('log-service').create(this.constructor.name);
        this.errors = services.get('error-service').create(this.log);

        this.disk_limit = my_config.disk_limit;
        this.disk_max_size = my_config.disk_max_size;
        this.precache_size = my_config.precache_size;
        this.path = my_config.path;

        this.ttl = my_config.ttl || (5 * 1000);

        this.precache = new Map();
        this.uid_to_tracker = new Map();

        this.init();

        this._register_commands(services.get('commands'));
    }


    /**
    * Retrieves the amount of precache space currently used.
    * 
    * @returns {number} The total size in bytes of files stored in the precache.
    */
    get _precache_used () {
        let used = 0;

        // Iterate over file trackers in PHASE_PRECACHE
        for (const tracker of this.uid_to_tracker.values()) {
            if (tracker.phase !== FileTracker.PHASE_PRECACHE) continue;
            used += tracker.size;
        }

        return used;
    }


    /**
    * Calculates the total disk space used by files in the PHASE_DISK phase.
    * 
    * @returns {number} The total size of all files currently stored on disk.
    */
    get _disk_used () {
        let used = 0;

        // Iterate over file trackers in PHASE_DISK
        for (const tracker of this.uid_to_tracker.values()) {
            if (tracker.phase !== FileTracker.PHASE_DISK) continue;
            used += tracker.size;
        }

        return used;
    }


    /**
    * Initializes the cache by ensuring the storage directory exists.
    * 
    * @async
    * @method init
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    * @throws {Error} If there's an error creating the directory.
    */
    async init () {
        const { fs } = this.modules;
        // Ensure storage path exists
        await fs.promises.mkdir(this.path, { recursive: true });
    }

    _get_path (uid) {
        const { path_, fs } = this.modules;
        return path_.join(this.path, uid);
    }


    /**
    * Get the file path for a given file UID.
    * 
    * @param {string} uid - The unique identifier of the file.
    * @returns {string} The full path where the file is stored on disk.
    */
    async try_get (fsNode, opt_log) {
        const tracker = this.uid_to_tracker.get(await fsNode.get('uid'));

        if ( ! tracker ) {
            return null;
        }

        if ( tracker.age > this.ttl ) {
            await this.invalidate(fsNode);
            return null;
        }

        tracker.touch();

        if ( tracker.phase === FileTracker.PHASE_PRECACHE ) {
            if ( opt_log ) opt_log.info('obtained from precache');
            return this.precache.get(await fsNode.get('uid'));
        }

        if ( tracker.phase === FileTracker.PHASE_DISK ) {
            if ( opt_log ) opt_log.info('obtained from disk');

            const { fs } = this.modules;
            const path = this._get_path(await fsNode.get('uid'));
            try {
                const data = await fs.promises.readFile(path);
                return data;
            } catch ( e ) {
                this.errors.report('file_cache:read_error', {
                    source: e,
                    trace: true,
                    alarm: true,
                });
            }
        }

        this.errors.report('file_cache:unexpected-cache-state', {
            message: `Unexpected cache state: ${tracker.phase?.label}`,
            trace: true,
            alarm: true,
            extra: {
                phase: tracker.phase?.label,
            }
        });

        return null;
    }


    /**
    * Attempts to retrieve a cached file.
    * 
    * This method first checks if the file exists in the cache by its UID.
    * If found, it verifies the file's age against the TTL (time-to-live).
    * If the file is expired, it invalidates the cache entry. Otherwise,
    * it returns the cached data or null if not found or invalidated.
    *
    * @param {Object} fsNode - The file system node representing the file.
    * @param {Object} [opt_log] - Optional logging service to log cache hits.
    * @returns {Promise<Buffer|null>} - The file data if found, or null.
    */
    async maybe_store (fsNode, stream) {
        const size = await fsNode.get('size');

        // If the file is too big, don't cache it
        if (size > this.disk_max_size) {
            return { cached: false };
        }

        const key = await fsNode.get('uid');

        // If the file is already cached, don't cache it again
        if (this.uid_to_tracker.has(key)) {
            return { cached: true };
        }

        // Add file tracker
        const tracker = new FileTracker({ key, size });
        this.uid_to_tracker.set(key, tracker);
        tracker.touch();


        // Store binary data in memory (precache)
        const data = Buffer.alloc(size);

        const [replace_stream, store_stream] = pausing_tee(stream, 2);

        (async () => {
            let offset = 0;
            for await (const chunk of store_stream) {
                chunk.copy(data, offset);
                offset += chunk.length;
            }

            await this._precache_make_room(size);
            this.precache.set(key, data);
            tracker.phase = FileTracker.PHASE_PRECACHE;
        })()

        return { cached: true, stream: replace_stream };
    }


    /**
    * Invalidates a file from the cache.
    * 
    * @param {FsNode} fsNode - The file system node to invalidate.
    * @returns {Promise<void>} A promise that resolves when the file has been invalidated.
    * 
    * @description
    * This method checks if the given file is in the cache, and if so, removes it from both
    * the precache and disk storage, ensuring that any references to this file are cleaned up.
    * If the file is not found in the cache, the method does nothing.
    */
    async invalidate (fsNode) {
        const key = await fsNode.get('uid');
        if ( ! this.uid_to_tracker.has(key) ) return;
        const tracker = this.uid_to_tracker.get(key);
        if ( tracker.phase === FileTracker.PHASE_PRECACHE ) {
            this.precache.delete(key);
        }
        if ( tracker.phase === FileTracker.PHASE_DISK ) {
            await this._disk_evict(tracker);
        }
        this.uid_to_tracker.delete(key);
    }


    /**
    * Invalidates a file from the cache.
    * 
    * @param {Object} fsNode - The file system node representing the file to invalidate.
    * @returns {Promise<void>} A promise that resolves when the file has been invalidated from both precache and disk.
    * 
    * @note This method removes the file's tracker from the cache, deletes the file from precache if present,
    * and ensures the file is evicted from disk storage if it exists there.
    */
    async _precache_make_room (size) {
        if (this._precache_used + size > this.precache_size) {
            await this._precache_evict(
                this._precache_used + size - this.precache_size
            );
        }
    }


    /**
    * Evicts files from precache to make room for new files.
    * This method sorts all trackers by score and evicts the lowest scoring
    * files in precache phase until the specified capacity is freed.
    * 
    * @param {number} capacity_needed - The amount of capacity (in bytes) that needs to be freed in precache.
    */
    async _precache_evict (capacity_needed) {
        // Sort by score from tracker
        const sorted = Array.from(this.uid_to_tracker.values())
            .sort((a, b) => b.score - a.score);

        let capacity = 0;
        for (const tracker of sorted) {
            if (tracker.phase !== FileTracker.PHASE_PRECACHE) continue;
            capacity += tracker.size;
            await this._maybe_promote_to_disk(tracker);
            if (capacity >= capacity_needed) break;
        }
    }


    /**
    * Evicts files from the precache to make room for new files.
    * 
    * @param {number} capacity_needed - The amount of space needed to be freed in bytes.
    * 
    * @description
    * This method sorts all cached files by their score in descending order,
    * then iterates through them to evict files from the precache to disk
    * until the required capacity is met. If a file is already on disk, it is skipped.
    */
    async _maybe_promote_to_disk (tracker) {
        if (tracker.phase !== FileTracker.PHASE_PRECACHE) return;

        // It's important to check that the score of this file is
        // higher than the combined score of the N files that
        // would be evicted to make room for it.
        const sorted = Array.from(this.uid_to_tracker.values())
            .sort((a, b) => b.score - a.score);

        let capacity = 0;
        let score_needed = 0;
        const capacity_needed = this._disk_used + tracker.size - this.disk_limit;
        for (const tracker of sorted) {
            if (tracker.phase !== FileTracker.PHASE_DISK) continue;
            capacity += tracker.size;
            score_needed += tracker.score;
            if (capacity >= capacity_needed) break;
        }

        if (tracker.score < score_needed) return;

        // Now we can remove the lowest scoring files
        // to make room for this file.
        capacity = 0;
        for (const tracker of sorted) {
            if (tracker.phase !== FileTracker.PHASE_DISK) continue;
            capacity += tracker.size;
            await this._disk_evict(tracker);
            if (capacity >= capacity_needed) break;
        }

        const { fs } = this.modules;
        const path = this._get_path(tracker.key);
        console.log(`precache fetch key I guess?`, tracker.key);
        const data = this.precache.get(tracker.key);
        // console.log(`path and data: ${path} ${data}`);
        await fs.promises.writeFile(path, data);
        this.precache.delete(tracker.key);
        tracker.phase = FileTracker.PHASE_DISK;
    }


    /**
    * Evicts a file from disk cache.
    * 
    * @param {FileTracker} tracker - The FileTracker instance representing the file to be evicted.
    * @returns {Promise<void>} A promise that resolves when the file is evicted or if the tracker is not in the disk phase.
    * 
    * @note This method ensures that the file is removed from the disk cache and the tracker's phase is updated to GONE.
    */
    async _disk_evict (tracker) {
        if (tracker.phase !== FileTracker.PHASE_DISK) return;

        const { fs } = this.modules;
        const path = this._get_path(tracker.key);

        await fs.promises.unlink(path);
        tracker.phase = FileTracker.PHASE_GONE;
        this.uid_to_tracker.delete(tracker.key);
    }

    _register_commands (commands) {
        commands.registerCommands('fsc', [
            {
                id: 'status',
                handler: async (args, log) => {
                    const { fs } = this.modules;
                    const path = this._get_path('status');

                    const status = {
                        precache: {
                            used: this._precache_used,
                            max: this.precache_size,
                        },
                        disk: {
                            used: this._disk_used,
                            max: this.disk_limit,
                        },
                    };

                    log.log(JSON.stringify(status, null, 2));
                }
            }
        ]);
    }
}

module.exports = {
    FileCacheService
};
