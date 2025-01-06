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
export class MemReader {
    constructor (data) {
        this.data = data;
        this.pos = 0;
    }
    async read (opt_buffer) {
        if ( this.pos >= this.data.length ) {
            return { done: true };
        }

        if ( ! opt_buffer ) {
            this.pos = this.data.length;
            return { value: this.data, done: false };
        }

        const toReturn = this.data.slice(
            this.pos,
            Math.min(this.pos + opt_buffer.length, this.data.length),
        );

        return {
            value: opt_buffer,
            size: toReturn.length
        };
    }
}
