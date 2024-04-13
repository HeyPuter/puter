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
import path_ from "path-browserify";
import { resolveRelativePath } from '../../util/path.js';

export class FileCompleter {
    async getCompletions (ctx, inputState) {
        const { filesystem } = ctx.platform;

        if ( inputState.input === '' ) {
            return [];
        }

        let path = resolveRelativePath(ctx.vars, inputState.input);
        let dir = path_.dirname(path);
        let base = path_.basename(path);

        const completions = [];

        const result = await filesystem.readdir(dir);
        if ( result === undefined ) {
            return [];
        }

        for ( const item of result ) {
            if ( item.name.startsWith(base) ) {
                completions.push(item.name.slice(base.length));
            }
        }
        
        return completions;
    }
}
