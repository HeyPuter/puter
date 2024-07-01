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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const { FileTracker } = require("./FileTracker");
const { pausing_tee } = require("../../util/streamutil");

/**
 * FileCacheService
 *
 * Initial naive cache implementation which stores whole files on disk.
 * It is assumed that files are only accessed by one server at a given time,
 * so this will need to be revised when ACL and sharing is implemented.
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

    get _precache_used () {
        let used = 0;

        // Iterate over file trackers in PHASE_PRECACHE
        for (const tracker of this.uid_to_tracker.values()) {
            if (tracker.phase !== FileTracker.PHASE_PRECACHE) continue;
            used += tracker.size;
        }

        return used;
    }

    get _disk_used () {
        let used = 0;

        // Iterate over file trackers in PHASE_DISK
        for (const tracker of this.uid_to_tracker.values()) {
            if (tracker.phase !== FileTracker.PHASE_DISK) continue;
            used += tracker.size;
        }

        return used;
    }

    async init () {
        const { fs } = this.modules;
        // Ensure storage path exists
        await fs.promises.mkdir(this.path, { recursive: true });
    }

    _get_path (uid) {
        const { path_, fs } = this.modules;
        return path_.join(this.path, uid);
    }

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
            console.log(`precache input key: ${key}`);
            this.precache.set(key, data);
            tracker.phase = FileTracker.PHASE_PRECACHE;
        })()

        return { cached: true, stream: replace_stream };
    }

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

    async _precache_make_room (size) {
        if (this._precache_used + size > this.precache_size) {
            await this._precache_evict(
                this._precache_used + size - this.precache_size
            );
        }
    }

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
