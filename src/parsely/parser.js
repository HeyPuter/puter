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
