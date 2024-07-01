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
export class CommandCompleter {
    async getCompletions (ctx, inputState) {
        const { builtins } = ctx.registries;
        const query = inputState.input;

        if ( query === '' ) {
            return [];
        }

        return (await ctx.externs.commandProvider.complete(query, { ctx }))
            // Remove any duplicate results
            .filter((item, pos, self) => self.indexOf(item) === pos)
            // TODO: Sort completions?
            // Remove the `query` part of each result, as that's what is expected
            // TODO: Supply whole results instead?
            .map(it => it.slice(query.length));
    }
}
