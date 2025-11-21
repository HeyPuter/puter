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
import { resolveRelativePath } from '../../util/path.js';

const lxor = (a, b) => a ? !b : b;

import path_ from 'path-browserify';

export default {
    name: 'grep',
    usage: 'grep [OPTIONS] PATTERN FILE...',
    description: 'Search FILE(s) for PATTERN, and print any matches.',
    input: {
        syncLines: true,
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            'ignore-case': {
                description: 'Match the pattern case-insensitively',
                type: 'boolean',
                short: 'i',
            },
            'invert-match': {
                description: 'Print lines that do not match the pattern',
                type: 'boolean',
                short: 'v',
            },
            'line-number': {
                description: 'Print the line number before each result',
                type: 'boolean',
                short: 'n',
            },
            recursive: {
                description: 'Recursively search in directories',
                type: 'boolean',
                short: 'r',
            },
        },
    },
    output: 'text',
    execute: async ctx => {
        const { positionals, values } = ctx.locals;
        const { filesystem } = ctx.platform;

        const [ pattern, ...files ] = positionals;

        const do_grep_dir = async ( path ) => {
            const entries = await filesystem.readdir(path);

            for ( const entry of entries ) {
                const entryPath = path_.join(path, entry.name);

                if ( entry.type === 'directory' ) {
                    if ( values.recursive ) {
                        await do_grep_dir(entryPath);
                    }
                } else {
                    await do_grep_file(entryPath);
                }
            }
        };

        const do_grep_line = async ( line, lineNumber ) => {
            if ( line.endsWith('\n') ) line = line.slice(0, -1);
            const re = new RegExp(pattern,
                            values['ignore-case'] ? 'i' : '');

            console.log('Attempting to match line',
                            line,
                            'with pattern',
                            pattern,
                            'and re',
                            re,
                            'and parameters',
                            values);

            if ( lxor(values['invert-match'], re.test(line)) ) {
                const lineToPrint = values['line-number']
                    ? `${lineNumber + 1}:${line}`
                    : line;

                console.log(`LINE{${lineToPrint}}`);
                await ctx.externs.out.write(`${lineToPrint }\n`);
            }
        };

        const do_grep_lines = async ( lines ) => {
            for ( let i = 0 ; i < lines.length ; i++ ) {
                const line = lines[i];

                await do_grep_line(line, i);
            }
        };

        const do_grep_file = async ( path ) => {
            console.log('about to read path', path);
            const data_blob = await filesystem.read(path);
            const data_string = await data_blob.text();

            const lines = data_string.split('\n');

            await do_grep_lines(lines);
        };

        if ( files.length === 0 ) {
            if ( values.recursive ) {
                files.push('.');
            } else {
                files.push('-');
            }
        }

        console.log('FILES', files);

        for ( let file of files ) {
            if ( file === '-' ) {
                for ( let i = 0; ; i++ ) {
                    const { value, done } = await ctx.externs.in_.read();
                    if ( done ) break;
                    await do_grep_line(value, i);
                }
            } else {
                file = resolveRelativePath(ctx.vars, file);
                const stat = await filesystem.stat(file);
                if ( stat.is_dir ) {
                    if ( values.recursive ) {
                        await do_grep_dir(file);
                    } else {
                        await ctx.externs.err.write(`grep: ${ file }: Is a directory\n`);
                    }
                } else {
                    await do_grep_file(file);
                }
            }
        }
    },
};
