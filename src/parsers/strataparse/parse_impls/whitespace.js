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
export default class WhitespaceParserImpl {
    static meta = {
        inputs: 'bytes',
        outputs: 'node'
    }
    static data = {
        whitespaceCharCodes: ' \r\t'.split('')
            .map(chr => chr.charCodeAt(0))
    }
    parse (lexer) {
        const { whitespaceCharCodes } = this.constructor.data;

        let text = '';

        for ( ;; ) {
            const { done, value } = lexer.look();
            if ( done ) break;
            if ( ! whitespaceCharCodes.includes(value) ) break;
            text += String.fromCharCode(value);
            lexer.next();
        }

        if ( text.length === 0 ) return;

        return { $: 'whitespace', text };
    }
}
