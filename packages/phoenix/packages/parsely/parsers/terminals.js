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
