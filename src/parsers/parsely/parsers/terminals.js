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
import { INVALID, Parser, UNRECOGNIZED, VALUE } from '../parser.js';

/**
 * Parses a literal value.
 * @param value The value to parse
 */
export class Literal extends Parser {
    _create (value) {
        this.value = value;
    }

    _parse (stream) {
        const subStream = stream.fork();
        for ( let i=0 ; i < this.value.length ; i++ ) {
            let { done, value } = subStream.next();
            if ( done ) return UNRECOGNIZED;
            if ( this.value[i] !== value ) return UNRECOGNIZED;
        }

        stream.join(subStream);
        return { status: VALUE, $: 'literal', value: this.value };
    }
}

/**
 * Parses matching characters as a string.
 * @param test Function that takes a character, and returns whether to include it.
 */
export class StringOf extends Parser {
    _create (test) {
        this.test = test;
    }

    _parse (stream) {
        const subStream = stream.fork();
        let text = '';

        while (true) {
            let { done, value } = subStream.look();
            if ( done ) break;
            if ( ! this.test(value) ) break;

            subStream.next();
            text += value;
        }

        if (text.length === 0) {
            return UNRECOGNIZED;
        }

        stream.join(subStream);
        return { status: VALUE, $: 'stringOf', value: text };
    }
}

/**
 * Parses characters into a string, until it encounters the given character, unescaped.
 * @param testOrCharacter End of the string. Either a character, or a function that takes a character,
 *                        and returns whether it ends the string.
 * @param escapeCharacter Character to use as the escape character. By default, is '\'.
 */
export class StringUntil extends Parser {
    _create(testOrCharacter, { escapeCharacter = '\\' } = {}) {
        if (typeof testOrCharacter === 'string') {
            this.test = (c => c === testOrCharacter);
        } else {
            this.test = testOrCharacter;
        }
        this.escapeCharacter = escapeCharacter;
    }

    _parse(stream) {
        const subStream = stream.fork();
        let text = '';
        let lastWasEscape = false;

        while (true) {
            let { done, value } = subStream.look();
            if ( done ) break;
            if ( !lastWasEscape && this.test(value) )
                break;

            subStream.next();
            if (value === this.escapeCharacter) {
                lastWasEscape = true;
                continue;
            }
            lastWasEscape = false;
            text += value;
        }

        if (lastWasEscape)
            return INVALID;

        if (text.length === 0)
            return UNRECOGNIZED;

        stream.join(subStream);
        return { status: VALUE, $: 'stringUntil', value: text };
    }
}

/**
 * Parses an object defined by the symbol registry.
 * @param symbolName The name of the symbol to parse.
 */
export class Symbol extends Parser {
    _create(symbolName) {
        this.symbolName = symbolName;
    }

    _parse (stream) {
        const parser = this.symbol_registry[this.symbolName];
        if ( ! parser ) {
            throw new Error(`No symbol defined named '${this.symbolName}'`);
        }
        const subStream = stream.fork();
        const result = parser.parse(subStream);
        if ( result.status === UNRECOGNIZED ) {
            return UNRECOGNIZED;
        }
        if ( result.status === INVALID ) {
            return { status: INVALID, value: result };
        }
        stream.join(subStream);
        result.$ = this.symbolName;
        return result;
    }
}

/**
 * Does no parsing and returns a discarded result.
 */
export class None extends Parser {
    _create () {}

    _parse (stream) {
        return { status: VALUE, $: 'none', $discard: true };
    }
}

/**
 * Always fails parsing.
 */
export class Fail extends Parser {
    _create () {}

    _parse (stream) {
        return UNRECOGNIZED;
    }
}
