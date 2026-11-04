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

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Identifies the build a process runs: a hash of every file under `root` by
 * relative path, size and modification time, skipping `node_modules`. Processes
 * started from one image share it; a rebuilt image gets another, even from the
 * same source, because compiling writes new modification times. `null` when the
 * tree can't be read.
 */
export const buildId = (root: string): string | null => {
    try {
        const hash = createHash('sha256');
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'node_modules') walk(path);
                } else if (entry.isFile()) files.push(path);
            }
        };
        walk(root);
        // Directory listing order is not specified, so sort for a stable hash.
        files.sort();
        for (const file of files) {
            const { size, mtimeMs } = statSync(file);
            hash.update(`${relative(root, file)}\0${size}\0${mtimeMs}\n`);
        }
        return hash.digest('hex').slice(0, 16);
    } catch {
        return null;
    }
};
