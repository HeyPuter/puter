import { adapt_parser, INVALID, Parser, UNRECOGNIZED, VALUE } from './lib.js';
import { Discard, FirstMatch, None, Optional, Repeat, Sequence } from './parsers/combinators.js';
import { Literal, StringOf } from './parsers/terminals.js';

class Symbol extends Parser {
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
        console.log(`Result of parsing symbol('${this.symbolName}'):`, result);
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

class ParserWithAction {
    #parser;
    #action;

    constructor(parser, action) {
        this.#parser = adapt_parser(parser);
        this.#action = action;
    }

    parse (stream) {
        const parsed = this.#parser.parse(stream);
        if (parsed.status === VALUE) {
            parsed.value = this.#action(parsed.value);
        }
        return parsed;
    }
}

export class GrammarContext {
    constructor (parsers) {
        // Object of { parser_name: Parser, ... }
        this.parsers = parsers;
    }

    sub (more_parsers) {
        return new GrammarContext({...this.parsers, ...more_parsers});
    }

    define_parser (grammar, actions) {
        const symbol_registry = {};
        const api = {};

        for (const [name, parserCls] of Object.entries(this.parsers)) {
            api[name] = (...params) => {
                const result = new parserCls();
                result._create(...params);
                result.set_symbol_registry(symbol_registry);
                return result;
            };
        }

        for (const [name, builder] of Object.entries(grammar)) {
            if (actions[name]) {
                symbol_registry[name] = new ParserWithAction(builder(api), actions[name]);
            } else {
                symbol_registry[name] = builder(api);
            }
        }

        return (stream, entry_symbol) => {
            const entry_parser = symbol_registry[entry_symbol];
            if (!entry_parser) {
                throw new Error(`Entry symbol '${entry_symbol}' not found in grammar.`);
            }
            return entry_parser.parse(stream);
        };
    }
}

export const standard_parsers = () => {
    return {
        discard: Discard,
        firstMatch: FirstMatch,
        literal: Literal,
        none: None,
        optional: Optional,
        repeat: Repeat,
        sequence: Sequence,
        stringOf: StringOf,
        symbol: Symbol,
    }
}
