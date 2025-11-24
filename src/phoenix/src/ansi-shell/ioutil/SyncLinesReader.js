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
import { ProxyReader } from './ProxyReader.js';

const decoder = new TextDecoder();

export class SyncLinesReader extends ProxyReader {
    constructor (...a) {
        super(...a);
        this.lines = [];
        this.fragment = '';
    }
    async read (opt_buffer) {
        if ( opt_buffer ) {
            // Line sync contradicts buffered reads
            return await this.delegate.read(opt_buffer);
        }

        return await this.readNextLine_();
    }
    async readNextLine_ () {
        if ( this.lines.length > 0 ) {
            return { value: this.lines.shift() };
        }

        for ( ;; ) {
            // CHECK: this might read once more after done; is that ok?
            let { value, done } = await this.delegate.read();

            if ( value instanceof Uint8Array ) {
                value = decoder.decode(value);
            }

            if ( done ) {
                if ( this.fragment.length === 0 ) {
                    return { value, done };
                }

                value = this.fragment;
                this.fragment = '';
                return { value };
            }

            if ( ! value.match(/\n|\r|\r\n/) ) {
                this.fragment += value;
                continue;
            }

            // Guaranteed to be 2 items, because value includes a newline
            const lines = value.split(/\n|\r|\r\n/);

            // The first line continues from the existing fragment
            const firstLine = this.fragment + lines.shift();
            // The last line is incomplete, and goes on the fragment
            this.fragment = lines.pop();

            // Any lines between are enqueued for subsequent reads,
            // and they include a line-feed character.
            this.lines.push(...lines.map(txt => `${txt }\n`));

            return { value: `${firstLine }\n` };
        }
    }
}
