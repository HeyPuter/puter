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

/**
 * Addresses for entries reached through a share. A recipient sees
 * `~/share/<root-uid>/rel/path`, which tells them what was shared without
 * telling them where the owner keeps it or what sits alongside it.
 */

/** Virtual directory holding one entry per share the actor holds. */
export const SHARE_ROOT = '~/share';

const SHARE_ROOT_PREFIX = `${SHARE_ROOT}/`;

// Deliberately strict: a real folder the user made at `~/share` must keep
// working, and the only thing distinguishing the two is whether the segment
// after it reads as an entry uid.
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface SharePathParts {
    /** Uid of the shared entry the path is rooted at. */
    rootUid: string;
    /** Path below that entry, `''` for the root itself. No leading slash. */
    rest: string;
}

/**
 * Read `~/share/<uid>/rel/path`. Returns null for anything else, including a
 * real `~/share/...` directory whose next segment is not a uid.
 */
export function parseSharePath(path: string): SharePathParts | null {
    if (typeof path !== 'string') return null;
    const trimmed = path.trim();
    if (trimmed === SHARE_ROOT) return null;
    if (!trimmed.startsWith(SHARE_ROOT_PREFIX)) return null;

    const [rootUid, ...restParts] = trimmed
        .slice(SHARE_ROOT_PREFIX.length)
        .split('/');
    if (!rootUid || !UID.test(rootUid)) return null;

    return { rootUid, rest: restParts.filter(Boolean).join('/') };
}

/** Whether `path` addresses the virtual share directory itself. */
export function isShareRoot(path: string): boolean {
    return typeof path === 'string' && path.trim() === SHARE_ROOT;
}

/** Build `~/share/<uid>/rel/path`. */
export function toSharePath(rootUid: string, rest = ''): string {
    const suffix = rest.replace(/^\/+/u, '');
    return suffix
        ? `${SHARE_ROOT_PREFIX}${rootUid}/${suffix}`
        : `${SHARE_ROOT_PREFIX}${rootUid}`;
}

/**
 * Re-root a real path onto the shared root that reaches it. Returns null when
 * `realPath` is not `rootPath` or below it.
 */
export function maskUnder(
    realPath: string,
    rootPath: string,
    rootUid: string,
): string | null {
    if (realPath === rootPath) return toSharePath(rootUid);
    if (!realPath.startsWith(`${rootPath}/`)) return null;
    return toSharePath(rootUid, realPath.slice(rootPath.length + 1));
}
