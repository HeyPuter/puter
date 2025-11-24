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
const {
    StringPStratumImpl,
    StrataParser,
    ParserFactory,
} = strataparse;
import { buildParserFirstHalf } from './src/ansi-shell/parsing/buildParserFirstHalf.js';
import { buildParserSecondHalf } from './src/ansi-shell/parsing/buildParserSecondHalf.js';

const sp = new StrataParser();

const cstParserFac = new ParserFactory();
cstParserFac.concrete = true;
cstParserFac.rememberSource = true;

sp.add(new StringPStratumImpl(`
        ls | tail -n 2 "ab" > "te\\"st"
    `));

// buildParserFirstHalf(sp, 'syntaxHighlighting');
buildParserFirstHalf(sp, 'interpreting');
buildParserSecondHalf(sp);

const result = sp.parse();
console.log(result && JSON.stringify(result, undefined, '  '));
if ( sp.error ) {
    console.log('has error:', sp.error);
}
