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
import { AcceptParserUtil, ParseResult, Parser } from "../parse.js";

export default class FirstRecognizedPStratumImpl {
    static meta = {
        description: `
            Implements a layer of top-down parsing by
            iterating over parsers for higher-level constructs
            and returning the first recognized value that was
            produced from lower-level constructs.
        `
    }
    constructor ({ parsers }) {
        this.parsers = parsers.map(AcceptParserUtil.adapt);
        this.valid = true;
    }
    next (api) {
        if ( ! this.valid ) return { done: true };
        const lexer = api.delegate;

        for ( const parser of this.parsers ) {
            {
                const { done } = lexer.look();
                if ( done ) return { done };
            }

            const subLexer = lexer.fork();
            const result = parser.parse(subLexer);
            if ( result.status === ParseResult.UNRECOGNIZED ) {
                continue;
            }
            if ( result.status === ParseResult.INVALID ) {
                return { done: true, value: result };
            }
            lexer.join(subLexer);
            return { done: false, value: result.value };
        }

        return { done: true, value: 'ran out of parsers' };
    }
}
