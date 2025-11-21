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
import { TerminalPStratumImplType } from '../strata.js';

export class BytesPStratumImpl {
    static TYPE = TerminalPStratumImplType;

    constructor (bytes, opt_i) {
        this.bytes = bytes;
        this.i = opt_i ?? 0;
    }
    next () {
        if ( this.i === this.bytes.length ) {
            return { done: true, value: undefined };
        }

        const i = this.i++;
        return { done: false, value: this.bytes[i] };
    }
    fork () {
        return new BytesPStratumImpl(this.bytes, this.i);
    }
    join (api, forked) {
        this.i = forked.i;
    }
    reach (api, start, end) {
        return this.bytes.slice(start, end);
    }
}

export class StringPStratumImpl {
    static TYPE = TerminalPStratumImplType;

    constructor (str) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        this.delegate = new BytesPStratumImpl(bytes);
    }
    // DRY: proxy methods
    next (...a) {
        return this.delegate.next(...a);
    }
    fork (...a) {
        return this.delegate.fork(...a);
    }
    join (...a) {
        return this.delegate.join(...a);
    }
    reach (...a) {
        return this.delegate.reach(...a);
    }
}
