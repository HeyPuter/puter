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
import { ParserConfigDSL } from "../dsl/ParserBuilder.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default class LiteralParserImpl {
    static meta = {
        inputs: 'bytes',
        outputs: 'node'
    }
    static createFunction ({ parserFactory }) {
        return (value) => {
            const conf = new ParserConfigDSL(parserFactory, this);
            conf.parseParams({ value });
            return conf;
        };
    }
    constructor ({ value }) {
        // adapt value
        if ( typeof value === 'string' ) {
            value = encoder.encode(value);
        }

        if ( value.length === 0 ) {
            throw new Error(
                'tried to construct a LiteralParser with an ' +
                'empty value, which could cause infinite ' +
                'iteration'
            );
        }

        this.value = value;
    }
    parse (lexer) {
        for ( let i=0 ; i < this.value.length ; i++ ) {
            let { done, value } = lexer.next();
            if ( done ) return;
            if ( this.value[i] !== value ) return;
        }

        const text = decoder.decode(this.value);
        return { $: 'literal', text };
    }
}
