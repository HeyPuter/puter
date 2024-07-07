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
/**
 * FileTracker
 *
 * Tracks information about cached files for LRU and LFU eviction.
 */
class FileTracker {
    static PHASE_PENDING = { label: 'pending' };
    static PHASE_PRECACHE = { label: 'precache' };
    static PHASE_DISK = { label: 'disk' };
    static PHASE_GONE = { label: 'gone' };

    constructor ({ key, size }) {
        this.phase = this.constructor.PHASE_PENDING;
        this.access_count = 0;
        this.last_access = 0;
        this.size = size;
        this.key = key;
        this.birth = Date.now();
    }

    get score () {
        const weight_recency = 0.5;
        const weight_access_count = 0.5;

        const recency = Date.now() - this.last_access;
        const access_count = this.access_count;

        return (weight_access_count * access_count) /
            (weight_recency * recency);
    }

    get age () {
        return Date.now() - this.birth;
    }


    touch () {
        this.access_count++;
        this.last_access = Date.now();
    }
}

module.exports = {
    FileTracker
}
