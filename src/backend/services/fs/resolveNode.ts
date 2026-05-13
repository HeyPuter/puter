/**
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

import { posix as pathPosix } from 'node:path';
import { HttpError } from '../../core/http/HttpError.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';

/**
 * Resolve an entry by one of several reference shapes (path, uid, id) to
 * a plain FSEntry row. Everything else (size, descendants, subdomains,
 * shares) is fetched by explicit service methods as needed.
 *
 * If a caller wants a batch resolve, do N individual calls — the repository
 * caches each result in Redis on first read.
 */

export interface NodeRef {
    /** Absolute path, e.g. '/danielsalazar/Documents/foo.txt'. */
    path?: string;
    /** UUID of the entry. Aliased as `uid` in request shapes. */
    uid?: string;
    uuid?: string;
    /** Numeric MySQL id. */
    id?: number | string;
    /** Pre-fetched entry (no-op resolution — pass-through). */
    entry?: FSEntry;
}

export interface ResolveNodeOptions {
    /** Throw a 404 HttpError when nothing resolves; default `false` returns null. */
    required?: boolean;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export async function resolveNode(
    fsEntryStore: FSEntryStore,
    ref: NodeRef,
    options: ResolveNodeOptions = {},
): Promise<FSEntry | null> {
    if (ref.entry) return ref.entry;

    const uuid = ref.uid ?? ref.uuid;
    if (isNonEmptyString(uuid)) {
        const entry = await fsEntryStore.getEntryByUuid(uuid);
        if (entry) return entry;
        return notFoundOrNull(
            options.required,
            `Entry not found: uuid=${uuid}`,
        );
    }

    if (ref.id !== undefined && ref.id !== null && String(ref.id).length > 0) {
        const numericId = Number(ref.id);
        if (!Number.isFinite(numericId)) {
            throw new HttpError(400, 'Invalid id', {
                legacyCode: 'bad_request',
            });
        }
        const entry = await fsEntryStore.getEntryById(numericId);
        if (entry) return entry;
        return notFoundOrNull(
            options.required,
            `Entry not found: id=${numericId}`,
        );
    }

    if (isNonEmptyString(ref.path)) {
        const entry = await fsEntryStore.getEntryByPath(ref.path);
        if (entry) return entry;
        return notFoundOrNull(
            options.required,
            `Entry not found: path=${ref.path}`,
        );
    }

    throw new HttpError(
        400,
        'Missing entry reference (expected one of: path, uid, id)',
        { legacyCode: 'bad_request' },
    );
}

function notFoundOrNull(required: boolean | undefined, message: string): null {
    if (required) {
        throw new HttpError(404, message, {
            legacyCode: 'subject_does_not_exist',
        });
    }
    return null;
}

/**
 * Split an absolute path into `{ parentPath, name }`. Used for operations that
 * accept "create child X of parent Y" shape (touch/mkdir/write), plus the
 * `{ parent, name }` selector style (parent resolves first, then we append
 * name to parent.path).
 */
export function splitParentAndName(absolutePath: string): {
    parentPath: string;
    name: string;
} {
    const normalized = normalizeAbsolutePath(absolutePath);
    if (normalized === '/') {
        throw new HttpError(400, 'Cannot derive parent of root', {
            legacyCode: 'bad_request',
        });
    }
    const parentPath = pathPosix.dirname(normalized);
    const name = pathPosix.basename(normalized);
    return { parentPath: parentPath === '.' ? '/' : parentPath, name };
}

export function normalizeAbsolutePath(path: string): string {
    const trimmed = typeof path === 'string' ? path.trim() : '';
    if (trimmed.length === 0) {
        throw new HttpError(400, 'Path cannot be empty', {
            legacyCode: 'bad_request',
        });
    }
    let normalized = pathPosix.normalize(trimmed);
    if (!normalized.startsWith('/')) {
        normalized = `/${normalized}`;
    }
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/**
 * Expand a leading `~` (home-dir shorthand) to `/<username>`. Preserves
 * non-tilde paths as-is. Throws 400 when the path needs expansion but no
 * username was supplied. Used by legacy FS endpoints (stat/readdir/etc.)
 * that accept user-authored paths verbatim.
 */
export function expandTildePath(path: string, username?: string): string {
    if (typeof path !== 'string') return path;
    const trimmed = path.trim();
    if (trimmed !== '~' && !trimmed.startsWith('~/')) return path;
    if (!username) {
        throw new HttpError(400, 'Unable to resolve home path', {
            legacyCode: 'bad_request',
        });
    }
    return `/${username}${trimmed.slice(1)}`;
}

/**
 * Build an absolute child path from a parent path + child name. Rejects names
 * containing `/`.
 */
export function joinChildPath(parentPath: string, name: string): string {
    if (typeof name !== 'string' || name.length === 0) {
        throw new HttpError(400, 'Name cannot be empty', {
            legacyCode: 'bad_request',
        });
    }
    if (name.includes('/')) {
        throw new HttpError(400, 'Name cannot contain a slash', {
            legacyCode: 'bad_request',
        });
    }
    const parent = normalizeAbsolutePath(parentPath);
    return parent === '/' ? `/${name}` : `${parent}/${name}`;
}
