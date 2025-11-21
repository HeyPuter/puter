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

// TODO: add logic to check if directory is empty
// TODO: add check for `--dir`
// TODO: allow multiple paths

// DRY: very similar to `cd`
export default {
    name: 'rm',
    usage: 'rm [OPTIONS] PATH',
    description: 'Remove the file or directory at PATH.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            dir: {
                description: 'Remove empty directories',
                type: 'boolean',
                short: 'd',
            },
            recursive: {
                description: 'Recursively remove directories and their contents',
                type: 'boolean',
                short: 'r',
            },
            force: {
                description: 'Ignore non-existent paths, and never prompt',
                type: 'boolean',
                short: 'f',
            },
        },
    },
    execute: async ctx => {
        // ctx.params to access processed args
        // ctx.args to access raw args
        const { positionals, values } = ctx.locals;
        const { filesystem } = ctx.platform;

        let [ target ] = positionals;
        target = resolveRelativePath(ctx.vars, target);

        await filesystem.rm(target, { recursive: values.recursive });
    },
};
