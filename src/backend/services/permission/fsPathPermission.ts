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

import { HttpError } from '../../core/http/HttpError.js';
import { MANAGE_PERM_PREFIX } from './consts.js';
import { PermissionUtil } from './permissionUtil.js';

export interface ParsedFsPathPermission {
    hasManage: boolean;
    /** Raw path as written in the permission string, e.g. `/dan/.mail`. */
    path: string;
    /** Everything after the path (mode and beyond). */
    rest: string[];
}

/**
 * Splits `fs:/path:mode` / `manage:fs:/path:mode` into its parts. Null for
 * anything else — a uid-addressed `fs:` permission, a non-`fs:` permission, or
 * a bare `fs` with nothing after it.
 */
export function parseFsPathPermission(
    permission: string,
): ParsedFsPathPermission | null {
    if (
        !permission.startsWith('fs:') &&
        !permission.startsWith(`${MANAGE_PERM_PREFIX}:fs:`)
    )
        return null;
    // Parse on component boundaries: a path can contain `fs:` (e.g. a home dir named `…fs`), which a raw split mistakes for the mode delimiter.
    const parts = PermissionUtil.split(permission);
    const hasManage = parts[0] === MANAGE_PERM_PREFIX;
    const fsIndex = hasManage ? 1 : 0;
    const path = parts[fsIndex + 1];
    if (!path || !path.startsWith('/')) return null;
    return { hasManage, path, rest: parts.slice(fsIndex + 2) };
}

/** Most path components a `create` grant may add below the home root. */
export const MAX_CREATE_DEPTH = 16;

/** Most entries one grant request may bring into existence. */
export const MAX_CREATED_ENTRIES_PER_GRANT = 4;

/**
 * Throws unless `path` is somewhere a `create` grant may provision: strictly
 * inside the given user's own home directory, outside AppData/Trash, and no
 * more than `MAX_CREATE_DEPTH` components below the home root.
 */
export function assertCreatablePath(path: string, username: string): void {
    const home = `/${username}`;
    if (!path.startsWith(`${home}/`)) {
        throw new HttpError(403, 'Cannot create outside your home directory', {
            legacyCode: 'forbidden',
        });
    }
    const segments = path.slice(home.length + 1).split('/');
    if (segments[0] === 'AppData' || segments[0] === 'Trash') {
        throw new HttpError(403, 'Cannot create at this location', {
            legacyCode: 'forbidden',
        });
    }
    if (segments.length > MAX_CREATE_DEPTH) {
        throw new HttpError(400, 'Path is too deep to create', {
            legacyCode: 'directory_depth_limit_exceeded',
        });
    }
}

export type FsCreateKind = 'dir' | 'file';

/**
 * A basename with a dot beyond a single leading one is a file; otherwise a
 * directory. `.mail` -> dir, `notes.txt` -> file, `.env.local` -> file.
 */
export function fsCreateKindFor(basename: string): FsCreateKind {
    const stripped = basename.startsWith('.') ? basename.slice(1) : basename;
    return stripped.includes('.') ? 'file' : 'dir';
}

/**
 * Normalizes a caller-supplied `create` flag; throws 400 on anything else.
 * Deliberately does not accept the strings `'true'`/`'false'` — the GUI
 * normalizes the popup query param before it reaches here.
 */
export function parseCreateFlag(value: unknown): boolean | FsCreateKind {
    if (value === undefined || value === null) return false;
    if (value === true || value === false) return value;
    if (value === 'dir' || value === 'file') return value;
    throw new HttpError(400, 'Invalid `create`', { legacyCode: 'bad_request' });
}
