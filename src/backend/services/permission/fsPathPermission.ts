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
import type { AclMode } from '../acl/ACLService.js';
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
    // The list is only checked for being an array, so an element is anything.
    if (typeof permission !== 'string') return null;
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

export interface ParsedFsUidPermission {
    uid: string;
    mode: string;
}

/** Splits `fs:<uid>:<mode>`. Null for the path form, `manage:`, and longer. */
export function parseFsUidPermission(
    permission: string,
): ParsedFsUidPermission | null {
    // The list is only checked for being an array, so an element is anything.
    if (typeof permission !== 'string') return null;
    if (!permission.startsWith('fs:')) return null;
    const parts = PermissionUtil.split(permission);
    if (parts.length !== 3) return null;
    const [, uid, mode] = parts;
    // A leading slash is the path form, which `parseFsPathPermission` reads.
    if (!uid || !mode || uid.startsWith('/')) return null;
    return { uid, mode };
}

/** The `fs:` scopes ACL answers; anything else keeps the permission scan. */
const ACL_ANSWERABLE_MODES = new Set(['see', 'list', 'read', 'write']);

/**
 * The entry and mode of an `fs:` scope ACL answers, in either spelling, so the
 * same file cannot answer two ways. Null for anything else.
 */
export const aclAnswerableFsPermission = (
    permission: string,
): { uid?: string; path?: string; mode: string } | null => {
    const byUid = parseFsUidPermission(permission);
    if (byUid) {
        return ACL_ANSWERABLE_MODES.has(byUid.mode) ? byUid : null;
    }
    const byPath = parseFsPathPermission(permission);
    if (!byPath || byPath.hasManage || byPath.rest.length !== 1) return null;
    const mode = byPath.rest[0]!;
    return ACL_ANSWERABLE_MODES.has(mode) ? { path: byPath.path, mode } : null;
};

/** `fs:<uid>:<mode>`, or `manage:fs:<uid>` for `manage`. */
export const fsEntryPermission = (uid: string, mode: string): string =>
    mode === MANAGE_PERM_PREFIX
        ? PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', uid)
        : PermissionUtil.join('fs', uid, mode);

/** The modes whose grant satisfies each mode, weakest asked first. */
export const FS_MODES_ABOVE: Record<AclMode, AclMode[]> = {
    see: ['see', 'list', 'read', 'write'],
    list: ['list', 'read', 'write'],
    read: ['read', 'write'],
    write: ['write'],
    [MANAGE_PERM_PREFIX]: [MANAGE_PERM_PREFIX],
};

/**
 * Permissions on `uid` that satisfy `mode`. `manage` sits above the whole
 * family: it answers any mode, but nothing answers it. Also answers the reverse
 * question: which stored checks a just-withdrawn grant held up.
 */
export const fsPermissionsFor = (uid: string, mode: AclMode): string[] => {
    const manage = fsEntryPermission(uid, MANAGE_PERM_PREFIX);
    if (mode === MANAGE_PERM_PREFIX) return [manage];
    return [
        ...FS_MODES_ABOVE[mode].map((m) => fsEntryPermission(uid, m)),
        manage,
    ];
};

/**
 * The prefixes every grant on `uid` sits under: `manage:fs:<uid>` is not under
 * `fs:<uid>`, so a prefix read that misses it leaves a manage grant behind.
 */
export const fsEntryPrefixes = (uid: string): string[] => [
    PermissionUtil.join('fs', uid),
    PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', uid),
];

export interface ParsedFsEntryPermission {
    /** The uid (or, before a rewrite, the path) the grant names. */
    uid: string;
    /** `manage` for the manage arm; null when the grant names no mode. */
    mode: string | null;
}

/** `fs:<uid>[:mode]` or `manage:fs:<uid>` read back; null for anything else. */
export function parseFsEntryPermission(
    permission: string,
): ParsedFsEntryPermission | null {
    const parts = PermissionUtil.split(permission);
    const manage = parts[0] === MANAGE_PERM_PREFIX;
    const fsAt = manage ? 1 : 0;
    const uid = parts[fsAt + 1];
    if (parts[fsAt] !== 'fs' || !uid) return null;
    return {
        uid,
        mode: manage ? MANAGE_PERM_PREFIX : (parts[fsAt + 2] ?? null),
    };
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
    // fsentries.path collates case-insensitively, so a differently-cased
    // segment names the same row — the refusal must match that.
    const first = segments[0]?.toLowerCase();
    if (first === 'appdata' || first === 'trash') {
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

/** Whether `path` is inside this user's own home tree. */
export function isOwnHomePath(path: string, username: string): boolean {
    const home = `/${username}`;
    return path === home || path.startsWith(`${home}/`);
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
 * Absent means create: a missing path is provisioned unless the caller passes
 * `false`. Deliberately does not accept the strings `'true'`/`'false'` — the
 * GUI normalizes the popup query param before it reaches here.
 */
export function parseCreateFlag(value: unknown): boolean | FsCreateKind {
    if (value === undefined || value === null) return true;
    if (value === true || value === false) return value;
    if (value === 'dir' || value === 'file') return value;
    throw new HttpError(400, 'Invalid `create`', { legacyCode: 'bad_request' });
}
