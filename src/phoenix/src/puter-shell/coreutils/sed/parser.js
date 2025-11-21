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
import { Address, AddressRange } from './address.js';
import {
    AppendTextCommand,
    BranchCommand,
    DebugPrintCommand,
    DeleteCommand,
    ExchangeCommand,
    GetCommand,
    GroupEndCommand,
    GroupStartCommand,
    HoldCommand,
    InsertTextCommand,
    LabelCommand,
    LineNumberCommand,
    PrintCommand,
    QuitCommand,
    ReplaceCommand,
    SubstituteCommand,
    SubstituteFlags,
    TransliterateCommand,
    ZapCommand,
} from './command.js';
import { Script } from './script.js';
import { parsely } from '@heyputer/parsers';
const { GrammarContext, standard_parsers } = parsely;
const { StringStream } = parsely.streams;
const { Parser, UNRECOGNIZED, VALUE } = parsely;

/**
 * A slight hack: Parsely doesn't yet have an equivalent of backreferences.
 * So, while parsing /foo/bar/, where the `/` can be any character, we set the current_delimiter variable
 * to that delimiter character temporarily, so we can refer to it in the subsequent delimiters.
 */
class DelimiterParser extends Parser {
    static current_delimiter;

    _create ({ first = false, character = null } = {}) {
        this.character = character;
        this.first = first;
    }

    _parse (stream) {
        const sub_stream = stream.fork();

        let { done, value } = sub_stream.next();
        if ( done ) return UNRECOGNIZED;

        if ( this.first ) {
            if ( this.character && this.character !== value )
            {
                return UNRECOGNIZED;
            }
            // Backslash and newline are disallowed as delimiters.
            if ( value === '\n' || value === '\\' )
            {
                return UNRECOGNIZED;
            }
            DelimiterParser.current_delimiter = value;
        } else if ( DelimiterParser.current_delimiter !== value ) {
            return UNRECOGNIZED;
        }

        stream.join(sub_stream);
        return { status: VALUE, $: 'delimiter', value };
    }
}

export const parseScript = (script_string, options) => {

    const grammar_context = new GrammarContext({
        ...standard_parsers(),
        delimiter: DelimiterParser,
    });

    let group_start_id = 0;
    let group_end_id = 0;

    const parser = grammar_context.define_parser({
        script: a => a.repeat(a.optional(a.symbol('command')),
                        a.firstMatch(a.literal('\n'),
                                        a.literal(';'))),
        command: a => a.sequence(a.symbol('whitespace'),
                        a.optional(a.symbol('address_range')),
                        a.symbol('whitespace'),
                        a.firstMatch(a.discard(a.symbol('comment')),
                                        a.symbol('{'),
                                        a.symbol('}'),
                                        a.symbol(':'),
                                        a.symbol('='),
                                        a.symbol('a'),
                                        a.symbol('b'),
                                        a.symbol('c'),
                                        a.symbol('d'),
                                        a.symbol('D'),
                                        a.symbol('g'),
                                        a.symbol('G'),
                                        a.symbol('h'),
                                        a.symbol('H'),
                                        a.symbol('i'),
                                        a.symbol('l'),
                                        a.symbol('p'),
                                        a.symbol('P'),
                                        a.symbol('q'),
                                        a.symbol('Q'),
                                        a.symbol('s'),
                                        a.symbol('t'),
                                        a.symbol('T'),
                                        a.symbol('x'),
                                        a.symbol('y'),
                                        a.symbol('z'))),
        address_range: a => a.sequence(a.optional(a.sequence(a.symbol('address'),
                        a.optional(a.sequence(a.literal(','),
                                        a.symbol('address'))))),
        a.optional(a.sequence(a.symbol('whitespace'),
                        a.literal('!')))),
        address: a => a.firstMatch(
                        // TODO: A dollar sign, for "final line"
                        a.symbol('decimal_number'),
                        a.symbol('regex')),
        decimal_number: a => a.stringOf(c => /\d/.test(c)),
        regex: a => a.sequence(a.firstMatch(a.delimiter({ first: true, character: '/' }),
                        a.sequence(a.literal('\\'),
                                        a.delimiter({ first: true }))),
        a.stringUntil(c => c === DelimiterParser.current_delimiter),
        a.delimiter()),
        whitespace: a => a.discard(a.optional(a.stringOf(c => /[ \t]/.test(c)))),
        label: a => a.stringOf(c => {
            // POSIX defines this as being characters within "the portable filename character set".
            return /[A-Za-z0-9.\-_]/.test(c);
        }),
        filename: a => a.stringOf(c => {
            return /[A-Za-z0-9.\-_]/.test(c);
        }),
        text: a => a.stringUntil('\n'),
        comment: a => a.sequence(a.literal('#'),
                        a.stringOf(c => c !== '\n')),
        '{': a => a.literal('{'),
        '}': a => a.literal('}'),
        ':': a => a.sequence(a.literal(':'),
                        a.symbol('label')),
        '=': a => a.literal('='),
        a: a => a.sequence(a.literal('a\\\n'),
                        a.symbol('text')),
        b: a => a.sequence(a.literal('b'),
                        a.optional(a.sequence(a.symbol('whitespace'),
                                        a.symbol('label')))),
        c: a => a.sequence(a.literal('c\\\n'),
                        a.symbol('text')),
        d: a => a.literal('d'),
        D: a => a.literal('D'),
        g: a => a.literal('g'),
        G: a => a.literal('G'),
        h: a => a.literal('h'),
        H: a => a.literal('H'),
        i: a => a.sequence(a.literal('i\\\n'),
                        a.symbol('text')),
        l: a => a.literal('l'),
        p: a => a.literal('p'),
        P: a => a.literal('P'),
        q: a => a.literal('q'),
        Q: a => a.literal('Q'),
        s: a => a.sequence(a.literal('s'),
                        a.delimiter({ first: true }),
                        a.stringUntil(c => c === DelimiterParser.current_delimiter),
                        a.delimiter(),
                        a.stringUntil(c => c === DelimiterParser.current_delimiter),
                        a.delimiter(),
                        a.optional(a.repeat(a.firstMatch(a.literal('g'),
                                        a.literal('p'),
                                        a.symbol('decimal_number'),
                                        a.sequence(a.literal('w'),
                                                        a.symbol('whitespace'),
                                                        a.symbol('filename')))))),
        t: a => a.sequence(a.literal('t'),
                        a.optional(a.sequence(a.symbol('whitespace'),
                                        a.symbol('label')))),
        T: a => a.sequence(a.literal('T'),
                        a.optional(a.sequence(a.symbol('whitespace'),
                                        a.symbol('label')))),
        x: a => a.literal('x'),
        y: a => a.sequence(a.literal('y'),
                        a.delimiter({ first: true }),
                        a.stringUntil(c => c === DelimiterParser.current_delimiter),
                        a.delimiter(),
                        a.stringUntil(c => c === DelimiterParser.current_delimiter),
                        a.delimiter()),
        z: a => a.literal('z'),
    }, {
        script: script => {
            const commands = script
                .filter(it => {
                    return it.$ === 'command' && it.value;
                }).map(it => {
                    return it.value;
                });

            // Record all labels that exist in the script, so we can validate branch commands.
            const labels = new Set();
            for ( const command of commands ) {
                if ( command instanceof LabelCommand ) {
                    labels.add(command.label);
                }
            }

            // Validate commands
            let group_depth = 0;
            for ( const command of commands ) {
                // Ensure branches all go to labels that exist
                if ( command instanceof BranchCommand ) {
                    // Note: Branches to the end of the script don't have a label.
                    if ( command.label && !labels.has(command.label) )
                    {
                        throw new Error(`Label "${command.label}" does not exist in the script.`);
                    }
                }

                if ( command instanceof GroupStartCommand ) {
                    group_depth++;
                }

                if ( command instanceof GroupEndCommand ) {
                    if ( group_depth < 1 )
                    {
                        throw new Error('Unexpected "}": no open groups');
                    }
                    group_depth--;
                }
            }

            if ( group_depth !== 0 )
            {
                throw new Error(`${group_depth} groups left open`);
            }

            return new Script(commands);
        },
        command: command => {
            // Comments show up as empty commands. Just skip them.
            if ( command.length === 0 )
            {
                return;
            }

            let addresses_provided = 0;
            let address_range, func;
            switch ( command.length ) {
            case 1:
                address_range = new AddressRange();
                func = command[0];
                break;
            default:
                address_range = command[0].value;
                func = command[1];
                addresses_provided = address_range.addressCount;
                break;
            }

            const require_max_address_count = (count) => {
                if ( addresses_provided > count )
                {
                    throw new Error(`Too many addresses provided to '${func.$}' command, most is ${count}`);
                }
            };

            // Decode func into its command type
            switch ( func.$ ) {
            case '{': {
                require_max_address_count(2);
                return new GroupStartCommand(address_range, ++group_start_id);
            }
            case '}': {
                require_max_address_count(0);
                return new GroupEndCommand(++group_end_id);
            }
            case ':': {
                require_max_address_count(0);
                return new LabelCommand(func.value);
            }
            case '=': {
                require_max_address_count(1);
                return new LineNumberCommand(address_range);
            }
            case 'a': {
                require_max_address_count(1);
                return new AppendTextCommand(address_range, func.value);
            }
            case 'b': {
                require_max_address_count(2);
                return new BranchCommand(address_range, func.value);
            }
            case 'c': {
                require_max_address_count(2);
                return new ReplaceCommand(address_range, func.value);
            }
            case 'd':
            case 'D': {
                require_max_address_count(2);
                return new DeleteCommand(address_range, func.$ === 'D');
            }
            case 'g':
            case 'G': {
                require_max_address_count(2);
                return new GetCommand(address_range, func.$ === 'G');
            }
            case 'h':
            case 'H': {
                require_max_address_count(2);
                return new HoldCommand(address_range, func.$ === 'H');
            }
            case 'i': {
                require_max_address_count(1);
                return new InsertTextCommand(address_range, func.value);
            }
            case 'l': {
                require_max_address_count(2);
                return new DebugPrintCommand(address_range);
            }
            case 'p':
            case 'P': {
                require_max_address_count(2);
                return new PrintCommand(address_range, func.$ === 'P');
            }
            case 'q':
            case 'Q': {
                require_max_address_count(1);
                return new QuitCommand(address_range, func.$ === 'Q');
            }
            case 's': {
                require_max_address_count(2);
                const { regex, replacement, flags } = func.value;
                return new SubstituteCommand(address_range, regex, replacement, flags);
            }
            case 't':
            case 'T': {
                require_max_address_count(2);
                return new BranchCommand(address_range, func.value, func.$ === 't');
            }
            case 'x': {
                require_max_address_count(2);
                return new ExchangeCommand(address_range);
            }
            case 'y': {
                require_max_address_count(2);
                const { input, replacement } = func.value;
                return new TransliterateCommand(address_range, input, replacement);
            }
            case 'z': {
                require_max_address_count(2);
                return new ZapCommand(address_range);
            }
            default:
                throw new Error(`Unimplemented command '${func.$}'`);
            }
        },
        address_range: address_range => {
            if ( address_range.length === 0 )
            {
                return new AddressRange();
            }

            if ( address_range.length === 1 ) {
                if ( address_range[0].value[0].$ === 'address' ) {
                    // Either 1 or two addresses
                    const parts = address_range[0].value;
                    const start = parts[0].value;
                    const end = parts[1] ? parts[1].value[1].value : null;
                    return new AddressRange({ start, end });
                }

                // No addresses, just inverted
                return new AddressRange({ inverted: true });
            }

            // Addresses and inverted
            const parts = address_range[0].value;
            const start = parts[0].value;
            const end = parts[1] ? parts[1].value[1].value : null;
            return new AddressRange({ start, end, inverted: true });
        },
        address: address => {
            if ( address instanceof RegExp )
            {
                return new Address(address);
            }
            return new Address(Number(address));
        },
        regex: regex => new RegExp(regex[1].value),

        // Functions with arguments
        ':': it => it[1].value,
        a: it => it[1].value,
        b: it => {
            if ( it.length < 2 ) return null;
            return it[1].value[0].value;
        },
        c: it => it[1].value,
        i: it => it[1].value,
        s: it => {
            const [ s, _, regex, __, replacement, ___, flag_values ] = it;
            const flags = {
                global: false,
                nthOccurrence: null,
                print: false,
                writeToFile: null,
            };
            if ( flag_values && flag_values.value.length ) {
                for ( const flag of flag_values.value ) {
                    if ( flag.value instanceof Array ) {
                        // It's a 'w'
                        if ( flags.writeToFile )
                        {
                            throw new Error('Multiple \'w\' flags given to s command');
                        }
                        flags.writeToFile = flag.value[1].value;

                    } else if ( flag.value === 'g' ) {
                        if ( flags.global )
                        {
                            throw new Error('Multiple \'g\' flags given to s command');
                        }
                        flags.global = true;

                    } else if ( flag.value === 'p' ) {
                        if ( flags.print )
                        {
                            throw new Error('Multiple \'p\' flags given to s command');
                        }
                        flags.print = true;

                    } else {
                        // Should be a number
                        if ( flags.nthOccurrence !== null )
                        {
                            throw new Error('Multiple number flags given to s command');
                        }
                        flags.nthOccurrence = Number.parseInt(flag.value);
                    }
                }
            }
            return {
                regex: new RegExp(regex.value),
                replacement: replacement.value,
                flags: new SubstituteFlags(flags),
            };
        },
        t: it => {
            if ( it.length < 2 ) return null;
            return it[1].value[0].value;
        },
        T: it => {
            if ( it.length < 2 ) return null;
            return it[1].value[0].value;
        },
        y: it => {
            const input = it[2].value;
            const replacement = it[4].value;
            if ( input.length !== replacement.length )
            {
                throw new Error('Input and replacement parts of y command must have the same length');
            }

            return { input, replacement };
        },
    });

    const stream = new StringStream(script_string);
    const result = parser(stream, 'script', { must_consume_all_input: true });
    return result.value;
};
