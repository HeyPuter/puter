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
const encoder = new TextEncoder();

export class MemWriter {
    constructor () {
        this.items = [];
    }
    async write (item) {
        this.items.push(item);
    }
    async close () {
    }

    getAsUint8Array () {
        const uint8arrays = [];
        for ( let item of this.items ) {
            if ( typeof item === 'string' ) {
                item = encoder.encode(item);
            }

            if ( ! ( item instanceof Uint8Array ) ) {
                throw new Error('could not convert to Uint8Array');
            }

            uint8arrays.push(item);
        }

        const outputUint8Array = new Uint8Array(uint8arrays.reduce((sum, item) => sum + item.length, 0));

        let pos = 0;
        for ( const item of uint8arrays ) {
            outputUint8Array.set(item, pos);
            pos += item.length;
        }

        return outputUint8Array;
    }

    getAsBlob () {
        // If there is just one item and it's a blob, return it
        if ( this.items.length === 1 && this.items[0] instanceof Blob ) {
            return this.items[0];
        }

        const uint8array = this.getAsUint8Array();
        return new Blob([uint8array]);
    }

    getAsString () {
        return new TextDecoder().decode(this.getAsUint8Array());
    }
}