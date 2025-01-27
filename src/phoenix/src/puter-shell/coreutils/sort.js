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

export default {
    name: 'sort',
    usage: 'sort [FILE...]',
    description: 'Sort the combined lines from the files provided, and output them.\n\n' +
        'If no FILE is specified, or FILE is `-`, read standard input.',
    input: {
        syncLines: true
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            'dictionary-order': {
                description: 'Only consider alphanumeric characters and whitespace',
                type: 'boolean',
                short: 'd'
            },
            'ignore-case': {
                description: 'Sort case-insensitively',
                type: 'boolean',
                short: 'f'
            },
            'ignore-nonprinting': {
                description: 'Only consider printable characters',
                type: 'boolean',
                short: 'i'
            },
            output: {
                description: 'Output to this file, instead of standard output',
                type: 'string',
                short: 'o'
            },
            unique: {
                description: 'Remove duplicates of previous lines',
                type: 'boolean',
                short: 'u'
            },
            reverse: {
                description: 'Sort in reverse order',
                type: 'boolean',
                short: 'r'
            },
        }
    },
    execute: async ctx => {
        const { in_, out, err } = ctx.externs;
        const { positionals, values } = ctx.locals;
        const { filesystem } = ctx.platform;

        let relPaths = [...positionals];
        if (relPaths.length === 0) {
            relPaths.push('-');
        }

        const lines = [];

        for (const relPath of relPaths) {
            if (relPath === '-') {
                lines.push(...await in_.collect());
            } else {
                const absPath = resolveRelativePath(ctx.vars, relPath);
                const fileData = await filesystem.read(absPath);
                // DRY: Similar logic in wc and tail
                if (fileData instanceof Blob) {
                    const arrayBuffer = await fileData.arrayBuffer();
                    const fileText = new TextDecoder().decode(arrayBuffer);
                    lines.push(...fileText.split(/\n|\r|\r\n/).map(it => it + '\n'));
                } else if (typeof fileData === 'string') {
                    lines.push(...fileData.split(/\n|\r|\r\n/).map(it => it + '\n'));
                } else {
                    // ArrayBuffer or TypedArray
                    const fileText = new TextDecoder().decode(fileData);
                    lines.push(...fileText.split(/\n|\r|\r\n/).map(it => it + '\n'));
                }
            }
        }

        const compareStrings = (a,b) => {
            let aIndex = 0;
            let bIndex = 0;

            const skipIgnored = (string, index) => {
                if (values['dictionary-order'] && values['ignore-nonprinting']) {
                    // Combining --dictionary-order and --ignore-nonprinting is unspecified.
                    // We'll treat that as "must be alphanumeric only".
                    while (index < string.length && ! /[a-zA-Z0-9]/.test(string[index])) {
                        index++;
                    }
                    return index;
                }
                if (values['dictionary-order']) {
                    // Only consider whitespace and alphanumeric characters
                    while (index < string.length && ! /[a-zA-Z0-9\s]/.test(string[index])) {
                        index++;
                    }
                    return index;
                }
                if (values['ignore-nonprinting']) {
                    // Only consider printing characters
                    // So, ignore anything below an ascii space, inclusive. TODO: detect unicode control characters too?
                    while (index < string.length && string[index] <= ' ') {
                        index++;
                    }
                    return index;
                }

                return index;
            };

            aIndex = skipIgnored(a, aIndex);
            bIndex = skipIgnored(b, bIndex);
            while (aIndex < a.length && bIndex < b.length) {
                // POSIX: Sorting should be locale-dependent
                let comparedCharA = a[aIndex];
                let comparedCharB = b[bIndex];
                if (values['ignore-case']) {
                    comparedCharA = comparedCharA.toUpperCase();
                    comparedCharB = comparedCharB.toUpperCase();
                }

                if (comparedCharA !== comparedCharB) {
                    if (values.reverse) {
                        return comparedCharA < comparedCharB ? 1 : -1;
                    }
                    return comparedCharA < comparedCharB ? -1 : 1;
                }

                aIndex++;
                bIndex++;
                aIndex = skipIgnored(a, aIndex);
                bIndex = skipIgnored(b, bIndex);
            }

            // If we got here, we reached the end of one of the strings.
            // If we reached the end of both, they're equal. Otherwise, return whichever ended.
            if (aIndex >= a.length) {
                if (bIndex >= b.length) {
                    return 0;
                }
                return -1;
            }
            return 1;
        };

        lines.sort(compareStrings);

        let resultLines = lines;
        if (values.unique) {
            resultLines = lines.filter((value, index, array) => {
                return !index || compareStrings(value, array[index - 1]) !== 0;
            });
        }

        if (values.output) {
            const outputPath = resolveRelativePath(ctx.vars, values.output);
            await filesystem.write(outputPath, resultLines.join(''));
        } else {
            for (const line of resultLines) {
                await out.write(line);
            }
        }
    }
};
