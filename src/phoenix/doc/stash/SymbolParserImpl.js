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
// Here for safe-keeping - wasn't correct for shell tokens but
// it will be needed later for variable assignments

export class SymbolParserImpl {
    static meta = {
        inputs: 'bytes',
        outputs: 'node'
    }
    static data = {
        rexp0: /[A-Za-z_]/,
        rexpN: /[A-Za-z0-9_]/,
    }
    parse (lexer) {
        let { done, value } = lexer.look();
        if ( done ) return;

        const { rexp0, rexpN } = this.constructor.data;

        value = String.fromCharCode(value);
        if ( ! rexp0.test(value) ) return;

        let text = '' + value;
        lexer.next();

        for ( ;; ) {
            ({ done, value } = lexer.look());
            if ( done ) break;
            value = String.fromCharCode(value);
            if ( ! rexpN.test(value) ) break;
            text += value;
            lexer.next();
        }
        
        return { $: 'symbol', text };
    }
}
