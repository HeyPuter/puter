// METADATA // {"ai-commented":{"service":"xai"}}
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
const { AdvancedBase } = require("@heyputer/putility");
const { FileTracker } = require("./FileTracker");
const { pausing_tee } = require("../../util/streamutil");
const putility = require("@heyputer/putility");
const { EWMA } = require("../../util/opmath");

const crypto = require('crypto');

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
        this.services = services;

        this.disk_limit = my_config.disk_limit;
        this.disk_max_size = my_config.disk_max_size;
        this.precache_size = my_config.precache_size;
        this.path = my_config.path;

        this.ttl = my_config.ttl || (60 * 1000);

        this.precache = new Map();
        this.uid_to_tracker = new Map();

        this.cache_hit_rate = new EWMA({
            initial: 0.5,
            alpha: 0.2,
        });

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

        // Distributed cache invalidation
        const svc_event = this.services.get('event');
        svc_event.on('outer.fs.write-hash', async (_, { uuid, hash }) => {
            const tracker = this.uid_to_tracker.get(uuid);
            if ( ! tracker ) return;

            if ( tracker.hash !== hash ) {
                await this.invalidate(uuid);
            }
        });
    }

    /**
    * Get the file path for a given file UID.
    * 
    * @param {string} uid - The unique identifier of the file.
    * @returns {string} The full path where the file is stored on disk.
    */
    _get_path (uid) {
        const { path_ } = this.modules;
        return path_.join(this.path, uid);
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
    async try_get(fsNode, opt_log) {
        const result = await this.try_get_(fsNode, opt_log);
        this.cache_hit_rate.put(result ? 1 : 0);
        return result;
    }
    async try_get_ (fsNode, opt_log) {
        const tracker = this.uid_to_tracker.get(await fsNode.get('uid'));

        if ( ! tracker ) {
            return null;
        }

        if ( tracker.age > this.ttl ) {
            await this.invalidate(fsNode);
            return null;
        }

        tracker.touch();

        // If the file is in pending, that means it's currenty being read
        // for cache entry, so we wait for it to be ready.
        if ( tracker.phase === FileTracker.PHASE_PENDING ) {
            Promise.race([
                tracker.p_ready,
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        }

        // If the file is still in pending it means we waited too long;
        // it's possible that reading the file failed is is delayed.
        if ( tracker.phase === FileTracker.PHASE_PENDING ) {
            return null;
        }

        // Since we waited for the file to be ready, it's not impossible
        // that it was evicted in the meantime; just very unlikely.
        if ( tracker.phase === FileTracker.PHASE_GONE ) {
            return null;
        }

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
     * Stores a file in the cache if it's "important enough"
     * to be in the cache (i.e. wouldn't get immediately evicted).
     * @param {*} fsNode 
     * @param {*} stream 
     * @returns 
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
        tracker.p_ready = new putility.libs.promise.TeePromise();
        tracker.touch();


        // Store binary data in memory (precache)
        const data = Buffer.alloc(size);

        const [replace_stream, store_stream] = pausing_tee(stream, 2);

        (async () => {
            let offset = 0;
            const hash = crypto.createHash('sha256');
            for await (const chunk of store_stream) {
                chunk.copy(data, offset);
                hash.update(chunk);
                offset += chunk.length;
            }

            await this._precache_make_room(size);
            this.precache.set(key, data);
            tracker.hash = hash.digest('hex');
            tracker.phase = FileTracker.PHASE_PRECACHE;
            tracker.p_ready.resolve();
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
    async invalidate (fsNode_or_uid) {
        const key = (typeof fsNode_or_uid === 'string')
            ? fsNode_or_uid
            : await fsNode_or_uid.get('uid');

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
     * Evicts files from precache until there's enough room for a new file.
     * @param {*} size - The size of the file to be stored.
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
     * Promotes a file from precache to disk if it has a higher score than the files that would be evicted.
     *
     * It may seem unintuitive that going from memory to disk is called a
     * "promotion". However, the in-memory cache used here is considered a
     * "precache"; the idea is as soon as we prepare to write a file to disk cache
     * we're very likely to access it again soon, so we keep it in memory for a
     * while before writing it to disk.
     *
     * @param {*} tracker - The FileTracker instance representing the file to be promoted.
     * @returns 
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
        console.log(`precache fetch key`, tracker.key);
        const data = this.precache.get(tracker.key);
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
            },
            {
                id: 'hitrate',
                handler: async (args, log) => {
                    log.log(this.cache_hit_rate.get());
                }
            }
        ]);
    }
}

module.exports = {
    FileCacheService
};
