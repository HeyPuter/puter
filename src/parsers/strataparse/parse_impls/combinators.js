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
import { ParserConfigDSL } from '../dsl/ParserBuilder.js';
import { AcceptParserUtil, Parser, ParseResult } from '../parse.js';

export class SequenceParserImpl {
    static createFunction ({ parserFactory }) {
        return (...parsers) => {
            const conf = new ParserConfigDSL(parserFactory, this);
            conf.parseParams({ parsers });
            return conf;
        };
    }
    constructor ({ parsers }) {
        this.parsers = parsers.map(AcceptParserUtil.adapt);
    }
    parse (lexer) {
        const results = [];
        for ( const parser of this.parsers ) {
            const subLexer = lexer.fork();
            const result = parser.parse(subLexer);
            if ( result.status === ParseResult.UNRECOGNIZED ) {
                return;
            }
            if ( result.status === ParseResult.INVALID ) {
                // TODO: this is wrong
                return { done: true, value: result };
            }
            lexer.join(subLexer);
            results.push(result.value);
        }

        return { $: 'sequence', results };
    }
}

export class ChoiceParserImpl {
    static createFunction ({ parserFactory }) {
        return (...parsers) => {
            const conf = new ParserConfigDSL(parserFactory, this);
            conf.parseParams({ parsers });
            return conf;
        };
    }
    constructor ({ parsers }) {
        this.parsers = parsers.map(AcceptParserUtil.adapt);
    }
    parse (lexer) {
        for ( const parser of this.parsers ) {
            const subLexer = lexer.fork();
            const result = parser.parse(subLexer);
            if ( result.status === ParseResult.UNRECOGNIZED ) {
                continue;
            }
            if ( result.status === ParseResult.INVALID ) {
                // TODO: this is wrong
                return { done: true, value: result };
            }
            lexer.join(subLexer);
            return result.value;
        }

        return;
    }
}

export class RepeatParserImpl {
    static createFunction ({ parserFactory }) {
        return (delegate) => {
            const conf = new ParserConfigDSL(parserFactory, this);
            conf.parseParams({ delegate });
            return conf;
        };
    }
    constructor ({ delegate }) {
        delegate = AcceptParserUtil.adapt(delegate);
        this.delegate = delegate;
    }

    parse (lexer) {
        const results = [];
        for ( ;; ) {
            const subLexer = lexer.fork();
            const result = this.delegate.parse(subLexer);
            if ( result.status === ParseResult.UNRECOGNIZED ) {
                break;
            }
            if ( result.status === ParseResult.INVALID ) {
                return { done: true, value: result };
            }
            lexer.join(subLexer);
            results.push(result.value);
        }

        return { $: 'repeat', results };
    }
}

export class NoneParserImpl {
    static createFunction ({ parserFactory }) {
        return () => {
            const conf = new ParserConfigDSL(parserFactory, this);
            return conf;
        };
    }
    parse () {
        return { $: 'none', $discard: true };
    }
}
