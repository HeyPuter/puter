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
export const adapt_parser = v => v;

export const UNRECOGNIZED = Symbol('unrecognized');
export const INVALID = Symbol('invalid');
export const VALUE = Symbol('value');

/**
 * Base class for parsers.
 * To implement your own, subclass it and define these methods:
 * - _create(): Acts as the constructor
 * - _parse(stream): Performs the parsing on the stream, and returns either UNRECOGNIZED, INVALID, or a result object.
 */
export class Parser {
    result (o) {
        if (o.value && o.value.$discard) {
            delete o.value;
        }
        return o;
    }

    parse (stream) {
        let result = this._parse(stream);
        if ( typeof result !== 'object' ) {
            result = { status: result };
        }
        return this.result(result);
    }

    set_symbol_registry (symbol_registry) {
        this.symbol_registry = symbol_registry;
    }

    _create () { throw new Error(`${this.constructor.name}._create() not implemented`); }
    _parse (stream) { throw new Error(`${this.constructor.name}._parse() not implemented`); }
}
