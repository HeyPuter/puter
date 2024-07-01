/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
/* eslint-disable no-control-regex */

export function lengthIgnoringEscapes(text) {
    const escape = '\x1b';
    // There are a lot of different ones, but we only use graphics-mode ones, so only parse those for now.
    // TODO: Parse other escape sequences as needed.
    // Format is: ESC, '[', DIGIT, 0 or more characters, and then 'm'
    const escapeSequenceRegex = /^\x1B\[\d.*?m/;

    let length = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === escape) {
            // Consume an ANSI escape sequence
            const match = text.substring(i).match(escapeSequenceRegex);
            if (match) {
                i += match[0].length - 1;
            }
            continue;
        }
        length++;
    }
    return length;
}

// TODO: Ensure this works with multi-byte characters (UTF-8)
export const wrapText = (text, width) => {
    const whitespaceChars = ' \t'.split('');
    const isWhitespace = c => {
        return whitespaceChars.includes(c);
    };

    // If width was invalid, just return the original text as a failsafe.
    if (typeof width !== 'number' || width < 1)
        return [text];

    const lines = [];
    let currentLine = '';
    const splitWordIfTooLong = (word) => {
        while (lengthIgnoringEscapes(word) > width) {
            lines.push(word.substring(0, width - 1) + '-');
            word = word.substring(width - 1);
        }

        currentLine = word;
    };

    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        // Handle special characters
        if (char === '\n') {
            lines.push(currentLine.trimEnd());
            currentLine = '';
            // Don't skip whitespace after a newline, to allow for indentation.
            continue;
        }
        // TODO: Handle \t?
        if (/\S/.test(char)) {
            // Grab next word
            let word = char;
            while ((i+1) < text.length && /\S/.test(text[i + 1])) {
                word += text[i+1];
                i++;
            }
            if (lengthIgnoringEscapes(currentLine) === 0) {
                splitWordIfTooLong(word);
                continue;
            }
            if ((lengthIgnoringEscapes(currentLine) + lengthIgnoringEscapes(word)) > width) {
                // Next line
                lines.push(currentLine.trimEnd());
                splitWordIfTooLong(word);
                continue;
            }
            currentLine += word;
            continue;
        }

        currentLine += char;
        if (lengthIgnoringEscapes(currentLine) >= width) {
            lines.push(currentLine.trimEnd());
            currentLine = '';
            // Skip whitespace at end of line.
            while (isWhitespace(text[i + 1])) {
                i++;
            }
            continue;
        }
    }
    if (currentLine.length >= 0) { // Not lengthIgnoringEscapes!
        lines.push(currentLine);
    }

    return lines;
};