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
import { parsely } from '@heyputer/parsers';
const { GrammarContext, standard_parsers } = parsely;
const { Parser, UNRECOGNIZED, VALUE } = parsely;
const { StringStream } = parsely.streams;

class NumberParser extends Parser {
    static data = {
        startDigit: /[1-9]/,
        digit: /[0-9]/,
    }
    _parse (stream) {
        const subStream = stream.fork();

        const { startDigit, digit } = this.constructor.data;

        let { done, value } = subStream.look();
        if ( done ) return UNRECOGNIZED;
        let text = '';

        // Returns true if there is a next character
        const consume = () => {
            text += value;
            subStream.next();
            ({ done, value } = subStream.look());

            return !done;
        };

        // Returns the number of consumed characters
        const consumeDigitSequence = () => {
            let consumed = 0;
            while (!done && digit.test(value)) {
                consumed++;
                consume();
            }
            return consumed;
        };

        // Sign
        if ( value === '-' ) {
            if ( !consume() ) return UNRECOGNIZED;
        }

        // Digits
        if (value === '0') {
            if ( !consume() ) return UNRECOGNIZED;
        } else if (startDigit.test(value)) {
            if (consumeDigitSequence() === 0) return UNRECOGNIZED;
        } else {
            return UNRECOGNIZED;
        }

        // Decimal + digits
        if (value === '.') {
            if ( !consume() ) return UNRECOGNIZED;
            if (consumeDigitSequence() === 0) return UNRECOGNIZED;
        }

        // Exponent
        if (value === 'e' || value === 'E') {
            if ( !consume() ) return UNRECOGNIZED;

            if (value === '+' || value === '-') {
                if ( !consume() ) return UNRECOGNIZED;
            }
            if (consumeDigitSequence() === 0) return UNRECOGNIZED;
        }

        if ( text.length === 0 ) return UNRECOGNIZED;
        stream.join(subStream);
        return { status: VALUE, $: 'number', value: Number.parseFloat(text) };
    }
}

class StringParser extends Parser {
    static data = {
        escapes: {
            '"': '"',
            '\\': '\\',
            '/': '/',
            'b': String.fromCharCode(8),
            'f': String.fromCharCode(0x0C),
            '\n': '\n',
            '\r': '\r',
            '\t': '\t',
        },
        hexDigit: /[0-9A-Fa-f]/,
    }
    _parse (stream) {
        const { escapes, hexDigit } = this.constructor.data;

        const subStream = stream.fork();
        let { done, value } = subStream.look();
        if ( done ) return UNRECOGNIZED;

        let text = '';

        // Returns true if there is a next character
        const next = () => {
            subStream.next();
            ({ done, value } = subStream.look());
            return !done;
        };

        // Opening "
        if (value === '"') {
            if (!next()) return UNRECOGNIZED;
        } else {
            return UNRECOGNIZED;
        }

        let insideString = true;
        while (insideString) {
            if (value === '"')
                break;

            // Escape sequences
            if (value === '\\') {
                if (!next()) return UNRECOGNIZED;
                const escape = escapes[value];
                if (escape) {
                    text += escape;
                    if (!next()) return UNRECOGNIZED;
                    continue;
                }

                if (value === 'u') {
                    if (!next()) return UNRECOGNIZED;

                    // Consume 4 hex digits, and decode as a unicode codepoint
                    let hexString = '';
                    while (!done && hexString.length < 4) {
                        if (hexDigit.test(value)) {
                            hexString += value;
                            if (!next()) return UNRECOGNIZED;
                            continue;
                        }
                        // Less than 4 hex digits read
                        return UNRECOGNIZED;
                    }
                    let codepoint = Number.parseInt(hexString, 16);
                    text += String.fromCodePoint(codepoint);
                    continue;
                }

                // Otherwise, it's an invalid escape sequence
                return UNRECOGNIZED;
            }

            // Anything else is valid string content
            text += value;
            if (!next()) return UNRECOGNIZED;
        }

        // Closing "
        if (value === '"') {
            next();
        } else {
            return UNRECOGNIZED;
        }

        if ( text.length === 0 ) return UNRECOGNIZED;
        stream.join(subStream);
        return { status: VALUE, $: 'string', value: text };
    }
}

export default {
    name: 'concept-parser',
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        const { in_, out, err } = ctx.externs;
        const grammar_context = new GrammarContext(standard_parsers());

        const parser = grammar_context.define_parser({
            element: a => a.sequence(
                a.optional(a.symbol('whitespace')),
                a.symbol('value'),
                a.optional(a.symbol('whitespace')),
            ),
            value: a => a.firstMatch(
                a.symbol('object'),
                a.symbol('array'),
                a.symbol('string'),
                a.symbol('number'),
                a.symbol('true'),
                a.symbol('false'),
                a.symbol('null'),
            ),
            array: a => a.sequence(
                a.literal('['),
                a.firstMatch(
                    a.repeat(
                        a.symbol('element'),
                        a.literal(','),
                        { trailing: false },
                    ),
                    a.optional(a.symbol('whitespace')),
                ),
                a.literal(']'),
            ),
            member: a => a.sequence(
                a.optional(a.symbol('whitespace')),
                a.symbol('string'),
                a.optional(a.symbol('whitespace')),
                a.literal(':'),
                a.symbol('element'),
            ),
            object: a => a.sequence(
                a.literal('{'),
                a.firstMatch(
                    a.repeat(
                        a.symbol('member'),
                        a.literal(','),
                        { trailing: false },
                    ),
                    a.optional(a.symbol('whitespace')),
                ),
                a.literal('}'),
            ),
            true: a => a.literal('true'),
            false: a => a.literal('false'),
            null: a => a.literal('null'),
            number: a => new NumberParser(),
            string: a => new StringParser(),
            whitespace: a => a.stringOf(c => ' \r\n\t'.includes(c)),
        }, {
            element: it => it.filter(it => it.$ === 'value')[0].value,
            value: it => it,
            array: it => {
                // A parsed array contains 3 values: `[`, the entries array, and `]`, so we only care about index 1.
                // If it's less than 3, there were no entries.
                if (it.length < 3) return [];
                return (it[1].value || [])
                    .filter(it => it.$ === 'element')
                    .map(it => it.value);
            },
            member: it => {
                const [ name_part, value_part ] = it.filter(it => it.$ === 'string' || it.$ === 'element');
                return { name: name_part.value, value: value_part.value };
            },
            object: it => {
                // A parsed object contains 3 values: `{`, the members array, and `}`, so we only care about index 1.
                // If it's less than 3, there were no members.
                if (it.length < 3) return {};
                const result = {};
                (it[1].value || [])
                    .filter(it => it.$ === 'member')
                    .forEach(it => {
                        result[it.value.name] = it.value.value;
                    });
                return result;
            },
            true: _ => true,
            false: _ => false,
            null: _ => null,
            number: it => it,
            string: it => it,
            whitespace: _ => {},
        });

        const input = ctx.locals.positionals.shift();
        const stream = new StringStream(input);
        try {
            const result = parser(stream, 'element');
            console.log('Parsed something!', result);
            await out.write('Parsed: `' + JSON.stringify(result, undefined, 2) + '`\n');
        } catch (e) {
            await err.write(`Error while parsing: ${e.toString()}\n`);
            await err.write(e.stack + '\n');
        }
    }
}
