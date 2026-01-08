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
 * A utility class to manage a circular queue with O(1) lookup.
 * Uses a Map for fast membership checks and a circular array for storage.
 *
 * Items expire when they are evicted from the queue (when the queue is full
 * and a new item is pushed).
 */
export class CircularQueue {
    /**
     * Creates a new CircularQueue instance with the specified size.
     *
     * @param {number} size - The maximum number of items the queue can hold
     */
    constructor (size) {
        this.size = size;
        this.queue = [];
        this.index = 0;
        this.map = new Map();
    }

    /**
     * Adds an item to the queue. If the queue is full, the oldest item is removed.
     *
     * @param {*} item - The item to add to the queue
     */
    push (item) {
        if ( this.queue[this.index] ) {
            this.map.delete(this.queue[this.index]);
        }
        this.queue[this.index] = item;
        this.map.set(item, this.index);
        this.index = (this.index + 1) % this.size;
    }

    /**
     * Retrieves an item from the queue at the specified relative index.
     *
     * @param {number} index - The relative index from the current position
     * @returns {*} The item at the specified index
     */
    get (index) {
        return this.queue[(this.index + index) % this.size];
    }

    /**
     * Checks if the queue contains the specified item.
     *
     * @param {*} item - The item to check for
     * @returns {boolean} True if the item exists in the queue, false otherwise
     */
    has (item) {
        return this.map.has(item);
    }

    /**
     * Attempts to consume (remove) an item from the queue if it exists.
     *
     * @param {*} item - The item to consume
     * @returns {boolean} True if the item was found and consumed, false otherwise
     */
    maybe_consume (item) {
        if ( this.has(item) ) {
            const index = this.map.get(item);
            this.map.delete(item);
            this.queue[index] = null;
            return true;
        }
        return false;
    }
}
