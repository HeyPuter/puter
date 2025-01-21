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
import { fileLines } from '../../util/file.js';

const TAB_SIZE = 8;

export default {
    name: 'wc',
    usage: 'wc [OPTIONS] [FILE...]',
    description: 'Count newlines, words, and bytes in each specified FILE, and print them in a table.\n\n' +
        'If no FILE is specified, or FILE is `-`, read standard input. ' +
        'If more than one FILE is specified, also print a line for the totals.\n\n' +
        'The outputs are always printed in the order: newlines, words, characters, bytes, maximum line length, followed by the file name. ' +
        'If no options are given to output specific counts, the default is `-lwc`.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            bytes: {
                description: 'Output the number of bytes in each file',
                type: 'boolean',
                short: 'c'
            },
            chars: {
                description: 'Output the number of characters in each file',
                type: 'boolean',
                short: 'm'
            },
            lines: {
                description: 'Output the number of newlines in each file',
                type: 'boolean',
                short: 'l'
            },
            'max-line-length': {
                description: 'Output the maximum line length in each file. Tabs are expanded to the nearest multiple of 8',
                type: 'boolean',
                short: 'L'
            },
            words: {
                description: 'Output the number of words in each file. A word is a sequence of non-whitespace characters',
                type: 'boolean',
                short: 'w'
            },
        }
    },
    execute: async ctx => {
        const { positionals, values } = ctx.locals;
        const { filesystem } = ctx.platform;

        const paths = [...positionals];
        // "If no input file operands are specified, no name shall be written and no <blank> characters preceding the
        //  pathname shall be written."
        // For convenience, we add '-' to paths, but make a note not to output the filename.
        let emptyStdinPath = false;
        if (paths.length < 1) {
            emptyStdinPath = true;
            paths.push('-');
        }

        let { bytes: printBytes, chars: printChars, lines: printNewlines, 'max-line-length': printMaxLineLengths, words: printWords } = values;
        const anyOutputOptionsSpecified = printBytes || printChars || printNewlines || printMaxLineLengths || printWords;
        if (!anyOutputOptionsSpecified) {
            printBytes = true;
            printNewlines = true;
            printWords = true;
        }

        let perFile = [];
        let newlinesWidth = 1;
        let wordsWidth = 1;
        let charsWidth = 1;
        let bytesWidth = 1;
        let maxLineLengthWidth = 1;

        for (const relPath of paths) {
            let counts = {
                filename: relPath,
                newlines: 0,
                words: 0,
                chars: 0,
                bytes: 0,
                maxLineLength: 0,
            };

            let inWord = false;
            let currentLineLength = 0;

            for await (const line of fileLines(ctx, relPath)) {
                counts.chars += line.length;
                if (printBytes) {
                    const byteInput = new TextEncoder().encode(line);
                    counts.bytes += byteInput.length;
                }

                for (const char of line) {
                    // "The wc utility shall consider a word to be a non-zero-length string of characters delimited by white space."
                    if (/\s/.test(char)) {
                        if (char === '\r' || char === '\n') {
                            counts.newlines++;
                            counts.maxLineLength = Math.max(counts.maxLineLength, currentLineLength);
                            currentLineLength = 0;
                        } else if (char === '\t') {
                            currentLineLength = (Math.floor(currentLineLength / TAB_SIZE) + 1) * TAB_SIZE;
                        } else {
                            currentLineLength++;
                        }
                        inWord = false;
                        continue;
                    }
                    currentLineLength++;
                    if (!inWord) {
                        counts.words++;
                        inWord = true;
                    }
                }
            }

            counts.maxLineLength = Math.max(counts.maxLineLength, currentLineLength);

            newlinesWidth = Math.max(newlinesWidth, counts.newlines.toString().length);
            wordsWidth = Math.max(wordsWidth, counts.words.toString().length);
            charsWidth = Math.max(charsWidth, counts.chars.toString().length);
            bytesWidth = Math.max(bytesWidth, counts.bytes.toString().length);
            maxLineLengthWidth = Math.max(maxLineLengthWidth, counts.maxLineLength.toString().length);
            perFile.push(counts);
        }

        let printCounts = async (count) => {
            let output = '';
            const append = (string) => {
                if (output.length !== 0) output += ' ';
                output += string;
            };

            if (printNewlines)       append(count.newlines.toString().padStart(newlinesWidth, ' '));
            if (printWords)          append(count.words.toString().padStart(wordsWidth, ' '));
            if (printChars)          append(count.chars.toString().padStart(charsWidth, ' '));
            if (printBytes)          append(count.bytes.toString().padStart(bytesWidth, ' '));
            if (printMaxLineLengths) append(count.maxLineLength.toString().padStart(maxLineLengthWidth, ' '));
            // The only time emptyStdinPath is true, is if we had no file paths given as arguments. That means only one
            // input (stdin), so this won't be called to print a "totals" line.
            if (!emptyStdinPath) append(count.filename);
            output += '\n';
            await ctx.externs.out.write(output);
        }

        let totalCounts = {
            filename: 'total', // POSIX: This is locale-dependent
            newlines: 0,
            words: 0,
            chars: 0,
            bytes: 0,
            maxLineLength: 0,
        };
        for (const count of perFile) {
            totalCounts.newlines += count.newlines;
            totalCounts.words += count.words;
            totalCounts.chars += count.chars;
            totalCounts.bytes += count.bytes;
            totalCounts.maxLineLength = Math.max(totalCounts.maxLineLength, count.maxLineLength);
            await printCounts(count);
        }
        if (perFile.length > 1) {
            await printCounts(totalCounts);
        }
    }
};
