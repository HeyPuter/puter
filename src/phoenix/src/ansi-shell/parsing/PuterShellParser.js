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
import { strataparse } from '@heyputer/parsers';
const { StrataParser, StringPStratumImpl } = strataparse;
import { buildParserFirstHalf } from './buildParserFirstHalf.js';
import { buildParserSecondHalf } from './buildParserSecondHalf.js';

export class PuterShellParser {
    constructor () {
    }
    parseLineForSyntax () {
    }
    parseLineForProcessing (input) {
        const sp = new StrataParser();
        sp.add(new StringPStratumImpl(input));
        // TODO: optimize by re-using this parser
        // buildParserFirstHalf(sp, "interpreting");
        buildParserFirstHalf(sp, 'syntaxHighlighting');
        buildParserSecondHalf(sp);
        const result = sp.parse();
        if ( sp.error ) {
            throw new Error(sp.error);
        }
        return result;
    }
    parseScript (input) {
        const sp = new StrataParser();
        sp.add(new StringPStratumImpl(input));
        buildParserFirstHalf(sp, 'syntaxHighlighting');
        buildParserSecondHalf(sp, { multiline: true });
        const result = sp.parse();
        if ( sp.error ) {
            throw new Error(sp.error);
        }
        return result;
    }
}
