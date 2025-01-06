// METADATA // {"ai-commented":{"service":"claude"}}
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
/**
 * FileTracker
 *
 * Tracks information about cached files for LRU and LFU eviction.
 */

const { EWMA, normalize } = require("../../util/opmath");

/**
* @class FileTracker
* @description A class that manages and tracks metadata for cached files, including their lifecycle phases,
* access patterns, and timing information. Used for implementing cache eviction strategies like LRU (Least
* Recently Used) and LFU (Least Frequently Used). Maintains state about file size, access count, last access
* time, and creation time to help determine which files should be evicted from cache when necessary.
*/
class FileTracker {
    static PHASE_PENDING = { label: 'pending' };
    static PHASE_PRECACHE = { label: 'precache' };
    static PHASE_DISK = { label: 'disk' };
    static PHASE_GONE = { label: 'gone' };

    constructor ({ key, size }) {
        this.phase = this.constructor.PHASE_PENDING;
        
        this.avg_access_delta = new EWMA({
            initial: 1000,
            alpha: 0.2,
        });
        this.access_count = 0;
        this.last_access = 0;
        this.size = size;
        this.key = key;
        this.birth = Date.now();
    }


    /**
    * Calculates a score for cache eviction prioritization
    * Combines access frequency and recency using weighted formula
    * Higher scores indicate files that should be kept in cache
    * 
    * @returns {number} Eviction score - higher values mean higher priority to keep
    */
    get score () {
        const weight_LFU = 0.5;
        const weight_LRU = 0.5;

        const access_freq = 1 / this.avg_access_delta.get();
        const n_access_freq = normalize({
            // "once a second" is a high value
            high_value: 0.001,
        }, access_freq)

        const recency = Date.now() - this.last_access;
        const n_recency = normalize({
            // "20 seconds ago" is pretty recent
            high_value: 0.00005,
        }, 1 / recency);

        return 0 +
            (weight_LFU * n_access_freq) +
            (weight_LRU * n_recency);
    }


    /**
    * Gets the age of the file in milliseconds since creation
    * @returns {number} Time in milliseconds since this tracker was created
    */
    get age () {
        return Date.now() - this.birth;
    }



    /**
    * Updates the access count and timestamp for this file
    * Increments access_count and sets last_access to current time
    * Used to track file usage for cache eviction scoring
    */
    touch () {
        const last_last_access = this.last_access;
        this.access_count++;
        this.last_access = Date.now();
        const access_delta = this.last_access - last_last_access;
        this.avg_access_delta.put(access_delta);
    }
}

module.exports = {
    FileTracker
}
