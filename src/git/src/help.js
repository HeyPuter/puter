/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Puter's Git client.
 *
 * Puter's Git client is free software: you can redistribute it and/or modify
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
 * Throw this from a subcommand's execute() in order to print its usage text to stderr.
 * @type {symbol}
 */
export const SHOW_USAGE = Symbol('SHOW_USAGE');

/**
 * Full manual page for the command.
 * @param command
 * @returns {string}
 */
export const produce_help_string = (command) => {
    const { name, usage, description, args } = command;
    const options = args?.options;

    let s = '';
    const indent = '    ';

    const heading = (text) => {
        s += `\n\x1B[34;1m${text}:\x1B[0m\n`
    };

    heading('SYNOPSIS');
    if (!usage) {
        s += `${indent}git ${name}\n`;
    } else if (typeof usage === 'string') {
        s += `${indent}${usage}\n`;
    } else {
        let first = true;
        for (const usage_line of usage) {
            if (first) {
                first = false;
                s += `${indent}${usage_line}\n`;
            } else {
                s += `${indent}${usage_line}\n`;
            }
        }
    }

    if (description) {
        heading('DESCRIPTION');
        s += `${indent}${description}\n`;
    }

    if (typeof options === 'object' && Object.keys(options).length > 0) {
        heading('OPTIONS');
        // Figure out how long each invocation is, so we can align the descriptions
        for (const [name, option] of Object.entries(options)) {
            // Invocation
            s += indent;
            if (option.short)
                s += `-${option.short}, `;
            s += `--${name}`;
            if (option.type !== 'boolean')
                s += ` <${option.type}>`;
            s += '\n';

            // Description
            s += `${indent}${indent}${option.description}\n\n`;
        }
    }

    if (!s.endsWith('\n\n'))
        s += '\n';

    return s;
}

/**
 * Usage for the command, which is a short summary.
 * @param command
 * @returns {string}
 */
export const produce_usage_string = (command) => {
    const { name, usage, args } = command;
    const options = args?.options;

    let s = '';

    // Usage
    if (!usage) {
        s += `usage: git ${name}\n`;
    } else if (typeof usage === 'string') {
        s += `usage: ${usage}\n`;
    } else {
        let first = true;
        for (const usage_line of usage) {
            if (first) {
                first = false;
                s += `usage: ${usage_line}\n`;
            } else {
                s += `   or: ${usage_line}\n`;
            }
        }
    }

    // List of options
    if (typeof options === 'object' && Object.keys(options).length > 0) {
        // Figure out how long each invocation is, so we can align the descriptions
        const option_strings = Object.entries(options).map(([name, option]) => {
            let invocation = '';
            if (option.short)
                invocation += `-${option.short}, `;
            invocation += `--${name}`;
            if (option.type !== 'boolean')
                invocation += ` <${option.type}>`;

            return [invocation, option.description];
        });

        const indent_size = 2 + option_strings.reduce(
            (max_length, option) => Math.max(max_length, option[0].length), 0);

        s += '\n';
        for (const [invocation, description] of option_strings) {
            s += `    ${invocation}`;
            if (indent_size - invocation.length > 0)
                s += ' '.repeat(indent_size - invocation.length);
            s += `${description}\n`;
        }
    }

    return s;
}
