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
import { DEFAULT_OPTIONS } from '../coreutils/coreutil_lib/help.js';

export class OptionCompleter {
    async getCompletions (ctx, inputState) {
        const { builtins } = ctx.registries;
        const query = inputState.input;

        if ( query === '' ) {
            return [];
        }

        // TODO: Query the command through the providers system.
        //       Or, we could include the command in the context that's given to completers?
        const command = builtins[inputState.tokens[0]];
        if ( ! command ) {
            return [];
        }

        const completions = [];

        const processOptions = (options) => {
            for ( const optionName of Object.keys(options) ) {
                const prefixedOptionName = `--${optionName}`;
                if ( prefixedOptionName.startsWith(query) ) {
                    completions.push(prefixedOptionName.slice(query.length));
                }
            }
        };

        // TODO: Only check these for builtins!
        processOptions(DEFAULT_OPTIONS);

        if ( command.args?.options ) {
            processOptions(command.args.options);
        }

        return completions;
    }
}
