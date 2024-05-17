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
import path from 'path-browserify';

/**
 * Attempt to locate the git repository directory.
 * @throws Error If no git repository could be found, or another error occurred.
 * @param fs Filesystem API
 * @param pwd Directory to search from
 * @returns {Promise<{repository_dir: (string|*), git_dir: (string|string)}>}
 */
export const find_repo_root = async (fs, pwd) => {
    if (!path.isAbsolute(pwd))
        throw new Error(`PWD is not absolute: ${pwd}`);

    let current_path = path.normalize(pwd);
    while (true) {
        let stat;
        const current_git_path = path.resolve(current_path, './.git');
        try {
            stat = await fs.promises.stat(current_git_path);
        } catch (e) {
            if (e.code === 'ENOENT') {
                if (current_path === '/')
                    break;

                current_path = path.dirname(current_path);
                continue;
            }

            throw e;
        }

        // If .git exists, we're probably in a git repo so call that good.
        // TODO: The git cli seems to check other things, maybe try to match that behaviour.

        const result = {
            repository_dir: current_path,
            git_dir: current_git_path,
        };

        // Non-default-git-folder repos have .git as a text file containing the git dir path.
        if (stat.isFile()) {
            const contents = await fs.promises.readFile(current_git_path, { encoding: 'utf8' });
            // The format of .git is `gitdir: /path/to/git/dir`
            const prefix = 'gitdir:';
            if (!contents.startsWith(prefix))
                throw new Error(`invalid gitfile format: ${current_git_path}`);
            result.git_dir = contents.slice(prefix.length).trim();
        }

        return result;
    }

    throw new Error('not a git repository (or any of the parent directories): .git');
}

/**
 * Produce a shortened version of the given hash, which is still unique within the repo.
 * TODO: Ensure that whatever we produce is unique within the repo.
 *       For now this is just a convenience function, so there's one place to change later.
 * @param hash
 * @returns {String} The shortened hash
 */
export const shorten_hash = (hash) => {
    // TODO: Ensure that whatever we produce is unique within the repo
    return hash.slice(0, 7);
}
