import { adapt_parser, VALUE } from './parser.js';
import { Discard, FirstMatch, Optional, Repeat, Sequence } from './parsers/combinators.js';
import { Fail, Literal, None, StringOf, StringUntil, Symbol } from './parsers/terminals.js';

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

    /**
     * Construct a parsing function for the given grammar.
     * @param grammar An object of symbol-names to a DSL for parsing that symbol.
     * @param actions An object of symbol-names to a function run to process the symbol after it has been parsed.
     * @returns {function(*, *, {must_consume_all_input?: boolean}=): *} A function to run the parser. Throws if parsing fails.
     */
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

        return (stream, entry_symbol, { must_consume_all_input = true } = {}) => {
            const entry_parser = symbol_registry[entry_symbol];
            if (!entry_parser) {
                throw new Error(`Entry symbol '${entry_symbol}' not found in grammar.`);
            }
            const result = entry_parser.parse(stream);

            if (result.status !== VALUE) {
                throw new Error('Failed to parse input against grammar.');
            }

            // Ensure the entire stream is consumed.
            if (must_consume_all_input && !stream.is_eof()) {
                throw new Error('Parsing did not consume all input.');
            }

            return result;
        };
    }
}

export const standard_parsers = () => {
    return {
        discard: Discard,
        fail: Fail,
        firstMatch: FirstMatch,
        literal: Literal,
        none: None,
        optional: Optional,
        repeat: Repeat,
        sequence: Sequence,
        stringOf: StringOf,
        stringUntil: StringUntil,
        symbol: Symbol,
    }
}
