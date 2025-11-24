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
const decoder = new TextDecoder();

export class MergeWhitespacePStratumImpl {
    static meta = {
        inputs: 'node',
        outputs: 'node',
    };
    constructor (tabWidth) {
        this.tabWidth = tabWidth ?? 1;
        this.line = 0;
        this.col = 0;
    }
    countChar (c) {
        if ( c === '\n' ) {
            this.line++;
            this.col = 0;
            return;
        }
        if ( c === '\t' ) {
            this.col += this.tabWidth;
            return;
        }
        if ( c === '\r' ) return;
        this.col++;
    }
    next (api) {
        const lexer = api.delegate;

        for ( ;; ) {
            const { value, done } = lexer.next();
            if ( done ) return { value, done };

            if ( value.$ === 'whitespace' ) {
                for ( const c of value.text ) {
                    this.countChar(c);
                }
                return { value, done: false };
                // continue;
            }

            value.$cst = {
                ...(value.$cst ?? {}),
                line: this.line,
                col: this.col,
            };

            if ( value.hasOwnProperty('$source') ) {
                let source = value.$source;
                if ( source instanceof Uint8Array ) {
                    source = decoder.decode(source);
                }
                for ( let c of source ) {
                    this.countChar(c);
                }
            } else {
                console.warn('source missing; can\'t count position');
            }

            return { value, done: false };
        }
    }
}
