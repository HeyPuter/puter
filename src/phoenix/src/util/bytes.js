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
export class Uint8List {
    constructor (initialSize) {
        initialSize = initialSize || 2;

        this.array = new Uint8Array(initialSize);
        this.size = 0;
    }

    get capacity () {
        return this.array.length;
    }

    append (chunk) {
        if ( typeof chunk === 'number' ) {
            chunk = new Uint8Array([chunk]);
        }

        const sizeNeeded = this.size + chunk.length;
        let newCapacity = this.capacity;
        while ( sizeNeeded > newCapacity ) {
            newCapacity *= 2;
        }

        if ( newCapacity !== this.capacity ) {
            const newArray = new Uint8Array(newCapacity);
            newArray.set(this.array, 0);
            this.array = newArray;
        }

        this.array.set(chunk, this.size);
        this.size += chunk.length;
    }

    toArray () {
        return this.array.subarray(0, this.size);
    }
}