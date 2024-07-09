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
 * Base class for input streams.
 * Defines which methods are expected for any stream implementations.
 */
export class ParserStream {
    value_at (index) { throw new Error(`${this.constructor.name}.value_at() not implemented`); }
    look () { throw new Error(`${this.constructor.name}.look() not implemented`); }
    next () { throw new Error(`${this.constructor.name}.next() not implemented`); }
    fork () { throw new Error(`${this.constructor.name}.fork() not implemented`); }
    join () { throw new Error(`${this.constructor.name}.join() not implemented`); }

    is_eof () {
        return this.look().done;
    }
}

/**
 * ParserStream that takes a string, and processes it character by character.
 */
export class StringStream extends ParserStream {
    constructor (str, startIndex = 0) {
        super();
        this.str = str;
        this.i = startIndex;
    }

    value_at (index) {
        if ( index >= this.str.length ) {
            return { done: true, value: undefined };
        }

        return { done: false, value: this.str[index] };
    }

    look () {
        return this.value_at(this.i);
    }

    next () {
        const result = this.value_at(this.i);
        this.i++;
        return result;
    }

    fork () {
        return new StringStream(this.str, this.i);
    }

    join (forked) {
        this.i = forked.i;
    }
}
