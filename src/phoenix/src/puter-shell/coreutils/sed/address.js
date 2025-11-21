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
import { makeIndent } from './utils.js';

// Either a line number or a regex
export class Address {
    constructor (value) {
        this.value = value;
    }

    matches (lineNumber, line) {
        if ( this.value instanceof RegExp ) {
            return this.value.test(line);
        }
        return this.value === lineNumber;
    }

    isLineNumberBefore (lineNumber) {
        return (typeof this.value === 'number') && this.value < lineNumber;
    }

    dump (indent) {
        if ( this.value instanceof RegExp ) {
            return `${makeIndent(indent)}REGEX: ${this.value}\n`;
        }
        return `${makeIndent(indent)}LINE: ${this.value}\n`;
    }
}

export class AddressRange {
    // Three kinds of AddressRange:
    // - Empty (includes everything)
    // - Single (matches individual line)
    // - Range (matches lines between start and end, inclusive)
    constructor ({ start, end, inverted = false } = {}) {
        this.start = start;
        this.end = end;
        this.inverted = inverted;
        this.insideRange = false;
        this.leaveRangeNextLine = false;
    }

    get addressCount () {
        return (this.start ? 1 : 0) + (this.end ? 1 : 0);
    }

    updateMatchState (lineNumber, line) {
        // Only ranges have a state to update
        if ( ! (this.start && this.end) ) {
            return;
        }

        // Reset our state each time we start a new file.
        if ( lineNumber === 1 ) {
            this.insideRange = false;
            this.leaveRangeNextLine = false;
        }

        // Leave the range if the previous line matched the end.
        if ( this.leaveRangeNextLine ) {
            this.insideRange = false;
            this.leaveRangeNextLine = false;
        }

        if ( this.insideRange ) {
            // We're inside the range, does this line end it?
            // If the end address is a line number in the past, yes, immediately.
            if ( this.end.isLineNumberBefore(lineNumber) ) {
                this.insideRange = false;
                return;
            }
            // If the line matches the end address, include it but leave the range on the next line.
            this.leaveRangeNextLine = this.end.matches(lineNumber, line);
        } else {
            // Does this line start the range?
            this.insideRange = this.start.matches(lineNumber, line);
        }
    }

    matches (lineNumber, line) {
        const invertIfNeeded = (value) => {
            return this.inverted ? !value : value;
        };

        // Empty - matches all lines
        if ( ! this.start ) {
            return invertIfNeeded(true);
        }

        // Range
        if ( this.end ) {
            return invertIfNeeded(this.insideRange);
        }

        // Single
        return invertIfNeeded(this.start.matches(lineNumber, line));
    }

    dump (indent) {
        const inverted = this.inverted ? `${makeIndent(indent + 1)}(INVERTED)\n` : '';

        if ( ! this.start ) {
            return `${makeIndent(indent)}ADDRESS RANGE (EMPTY)\n${
                inverted}`;
        }

        if ( this.end ) {
            return `${makeIndent(indent)}ADDRESS RANGE (RANGE):\n${
                inverted
            }${this.start.dump(indent + 1)
            }${this.end.dump(indent + 1)}`;
        }

        return `${makeIndent(indent)}ADDRESS RANGE (SINGLE):\n${
            this.start.dump(indent + 1)
        }${inverted}`;
    }
}
