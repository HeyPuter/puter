/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

/**
 * Strip ANSI escape sequences from a string (e.g. color codes)
 * and then return the length of the resulting string.
 *
 * @param {*} str
 */
const visible_length = (str) => {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '').length;
};

/**
 * Split a string into lines according to the terminal width,
 * preserving ANSI escape sequences, and return an array of lines.
 *
 * @param {*} str
 */
const split_lines = (str) => {
    const lines = [];
    let line = '';
    let line_length = 0;
    for (const c of str) {
        line += c;
        if (c === '\n') {
            lines.push(line);
            line = '';
            line_length = 0;
        } else {
            line_length++;
            if (line_length >= process.stdout.columns) {
                lines.push(line);
                line = '';
                line_length = 0;
            }
        }
    }
    if (line.length) {
        lines.push(line);
    }
    return lines;
};


module.exports = {
    visible_length,
    split_lines,
};

