import { GrammarContext, standard_parsers } from '../../../packages/newparser/exports.js';
import { Parser, UNRECOGNIZED, VALUE } from '../../../packages/newparser/lib.js';

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

class StringStream {
    constructor (str, startIndex = 0) {
        this.str = str;
        this.i = startIndex;
    }

    value_at (index) {
        if ( index >= this.str.length ) {
            return { done: true, value: undefined };
        }

        return { done: false, value: this.str[index] };
    }

    look () {
        return this.value_at(this.i);
    }

    next () {
        const result = this.value_at(this.i);
        this.i++;
        return result;
    }

    fork () {
        return new StringStream(this.str, this.i);
    }

    join (forked) {
        this.i = forked.i;
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
        await out.write("STARTING CONCEPT PARSER\n");
        const grammar_context = new GrammarContext(standard_parsers());
        await out.write("Constructed a grammar context\n");

        const parser = grammar_context.define_parser({
            element: a => a.sequence(
                a.symbol('whitespace'),
                a.symbol('value'),
                a.symbol('whitespace'),
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
                a.symbol('whitespace'),
                a.optional(
                    a.repeat(
                        a.symbol('element'),
                        a.literal(','),
                        { trailing: true },
                    ),
                ),
                a.symbol('whitespace'),
                a.literal(']'),
            ),
            member: a => a.sequence(
                a.symbol('whitespace'),
                a.symbol('string'),
                a.symbol('whitespace'),
                a.literal(':'),
                a.symbol('whitespace'),
                a.symbol('value'),
                a.symbol('whitespace'),
            ),
            object: a => a.sequence(
                a.literal('{'),
                a.symbol('whitespace'),
                a.optional(
                    a.repeat(
                        a.symbol('member'),
                        a.literal(','),
                        { trailing: true },
                    ),
                ),
                a.symbol('whitespace'),
                a.literal('}'),
            ),
            true: a => a.literal('true'),
            false: a => a.literal('false'),
            null: a => a.literal('null'),
            number: a => new NumberParser(),
            string: a => new StringParser(),
            whitespace: a => a.optional(
                a.stringOf(' \r\n\t'.split('')),
            ),
        }, {
            element: it => it[0].value,
            value: it => it,
            array: it => {
                // A parsed array contains 3 values: `[`, the entries array, and `]`, so we only care about index 1.
                // If it's less than 3, there were no entries.
                if (it.length < 3) return [];
                return (it[1].value || [])
                    .filter(it => it.$ !== 'literal')
                    .map(it => it.value);
            },
            member: it => {
                // A parsed member contains 3 values: a name, `:`, and a value.
                const [ name_part, colon, value_part ] = it;
                return { name: name_part.value, value: value_part.value };
            },
            object: it => {
                console.log('OBJECT!!!!');
                console.log(it[1]);
                // A parsed object contains 3 values: `{`, the members array, and `}`, so we only care about index 1.
                // If it's less than 3, there were no members.
                if (it.length < 3) return {};
                const result = {};
                // FIXME: This is all wrong!!!
                (it[1].value || [])
                    .filter(it => it.$ === 'member')
                    .forEach(it => {
                        result[it.name] = it.value;
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

        // TODO: What do we want our streams to be like?
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