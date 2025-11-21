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
import { resolveRelativePath } from './path.js';

// Iterate the given file, one line at a time.
// TODO: Make this read one line at a time, instead of all at once.
export async function* fileLines (ctx, relPath, options = { dashIsStdin: true }) {
    let lines = [];
    if ( options.dashIsStdin && relPath === '-' ) {
        lines = await ctx.externs.in_.collect();
    } else {
        const absPath = resolveRelativePath(ctx.vars, relPath);
        const fileData = await ctx.platform.filesystem.read(absPath);
        if ( fileData instanceof Blob ) {
            const arrayBuffer = await fileData.arrayBuffer();
            const fileText = new TextDecoder().decode(arrayBuffer);
            lines = fileText.split(/\n|\r|\r\n/).map(it => `${it }\n`);
        } else if ( typeof fileData === 'string' ) {
            lines = fileData.split(/\n|\r|\r\n/).map(it => `${it }\n`);
        } else {
            // ArrayBuffer or TypedArray
            const fileText = new TextDecoder().decode(fileData);
            lines = fileText.split(/\n|\r|\r\n/).map(it => `${it }\n`);
        }
    }

    for ( const line of lines ) {
        yield line;
    }
}