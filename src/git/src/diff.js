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
import * as Diff from 'diff';
import git from 'isomorphic-git';
import path from 'path-browserify';

/**
 * Produce an array of diffs from two git tree.
 * @param fs
 * @param dir
 * @param gitdir
 * @param cache
 * @param env
 * @param a_tree A walker object for the left comparison, usually a TREE(), STAGE() or WORKDIR()
 * @param b_tree A walker object for the right comparison, usually a TREE(), STAGE() or WORKDIR()
 * @param read_a Callback run to extract the data from each file in a
 * @param read_b Callback run to extract the data from each file in b
 * @param context_lines Number of context lines to include in diff
 * @param path_filters Array of strings to filter which files to include
 * @returns {Promise<any>} An array of diff objects, suitable for passing to format_diffs()
 */
export const diff_git_trees = ({
    fs,
    dir,
    gitdir,
    cache,
    env,
    a_tree,
    b_tree,
    read_a,
    read_b,
    context_lines = 3,
    path_filters = [],
}) => {
    return git.walk({
        fs,
        dir,
        gitdir,
        cache,
        trees: [ a_tree, b_tree ],
        map: async (filepath, [ a, b ]) => {

            // Reject paths that don't match path_filters.
            // Or if path_filters is empty, match everything.
            const abs_filepath = path.resolve(env.PWD, filepath);
            if (path_filters.length > 0 && !path_filters.some(abs_path =>
                (filepath === '.') || (abs_filepath.startsWith(abs_path)) || (path.dirname(abs_filepath) === abs_path),
            )) {
                return null;
            }

            if (await git.isIgnored({ fs, dir, gitdir, filepath }))
                return null;

            const [ a_type, b_type ] = await Promise.all([ a?.type(), b?.type() ]);

            // Exclude directories from results
            if ((!a_type || a_type === 'tree') && (!b_type || b_type === 'tree'))
                return;

            const [
                a_content,
                a_oid,
                a_mode,
                b_content,
                b_oid,
                b_mode,
            ] = await Promise.all([
                read_a(a),
                a?.oid() ?? '00000000',
                a?.mode(),
                read_b(b),
                b?.oid() ?? '00000000',
                b?.mode(),
            ]);

            const diff = Diff.structuredPatch(
                a_content !== undefined ? filepath : '/dev/null',
                b_content !== undefined ? filepath : '/dev/null',
                a_content ?? '',
                b_content ?? '',
                undefined,
                undefined,
                {
                    context: context_lines,
                    newlineIsToken: true,
                });

            // Diffs with no changes lines, but a changed mode, still need to show up.
            if (diff.hunks.length === 0 && a_mode === b_mode)
                return;

            const mode_string = (mode) => {
                if (!mode)
                    return '000000';
                return Number(mode).toString(8);
            };

            return {
                a: {
                    oid: a_oid,
                    mode: mode_string(a_mode),
                },
                b: {
                    oid: b_oid,
                    mode: mode_string(b_mode),
                },
                diff,
            };
        },
    });
};
