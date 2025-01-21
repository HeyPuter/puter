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
import chalk from 'chalk';

export const color_options = {
    'color': {
        // TODO: '--color[=<when>]' syntax, once we have an args parser that supports optional string option-arguments.
        description: 'Force colored output.',
        type: 'boolean',
    },
    'no-color': {
        description: 'Disable colored output.',
        type: 'boolean',
    },
}

/**
 * Process command-line options related to color, and modify them in place.
 * Sets the chalk color level based on whether color is enabled or disabled.
 * @param options Parsed command-line options, which will be modified in place.
 */
export const process_color_options = (options) => {

    if (!options['color'] && !options['no-color']) {
        // TODO: Default to whether we're running in a TTY, once we have that concept.
        options['color'] = true;
    }

    if (options['no-color']) {
        options['color'] = false;
        delete options['no-color'];
    }

    chalk.level = options.color ? 3 : 0;
}
