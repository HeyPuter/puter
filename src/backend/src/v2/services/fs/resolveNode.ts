import { posix as pathPosix } from 'node:path';
import { HttpError } from '../../core/http/HttpError.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';


/**
 * Minimal replacement for v1's FSNodeContext + selector class hierarchy.
 *
 * v1 exposed a rich object (FSNodeContext) that lazily fetched, cached via
 * ECMAP, and chained property lookups across the request. In practice, we
 * only need: "given this reference shape, fetch the plain FSEntry row".
 * Everything else (size, descendants, subdomains, shares) is fetched by
 * explicit service methods as needed.
 *
 * If a caller wants a batch resolve, do N individual calls — the repository
 * caches each result in Redis on first read.
 */

export interface NodeRef {
    /** Absolute path, e.g. '/danielsalazar/Documents/foo.txt'. */
    path?: string;
    /** UUID of the entry. Aliased as `uid` in v1 request shapes. */
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
    /** When resolving by path, the path is resolved in this user's namespace. */
    userId?: number;
}

function isNonEmptyString (value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export async function resolveNode (
    fsEntryStore: FSEntryStore,
    ref: NodeRef,
    options: ResolveNodeOptions = {},
): Promise<FSEntry | null> {
    if ( ref.entry ) return ref.entry;

    const uuid = ref.uid ?? ref.uuid;
    if ( isNonEmptyString(uuid) ) {
        const entry = await fsEntryStore.getEntryByUuid(uuid);
        if ( entry ) return entry;
        return notFoundOrNull(options.required, `Entry not found: uuid=${uuid}`);
    }

    if ( ref.id !== undefined && ref.id !== null && String(ref.id).length > 0 ) {
        const numericId = Number(ref.id);
        if ( ! Number.isFinite(numericId) ) {
            throw new HttpError(400, 'Invalid id');
        }
        const entry = await fsEntryStore.getEntryById(numericId);
        if ( entry ) return entry;
        return notFoundOrNull(options.required, `Entry not found: id=${numericId}`);
    }

    if ( isNonEmptyString(ref.path) ) {
        const entry = options.userId !== undefined
            ? await fsEntryStore.getEntryByPathForUser(ref.path, options.userId)
            : await fsEntryStore.getEntryByPath(ref.path);
        if ( entry ) return entry;
        return notFoundOrNull(options.required, `Entry not found: path=${ref.path}`);
    }

    throw new HttpError(400, 'Missing entry reference (expected one of: path, uid, id)');
}

function notFoundOrNull (required: boolean | undefined, message: string): null {
    if ( required ) throw new HttpError(404, message);
    return null;
}

/**
 * Split an absolute path into `{ parentPath, name }`. Used for operations that
 * accept "create child X of parent Y" shape (touch/mkdir/write), plus v1's
 * legacy `{ parent, name }` selector style (parent resolves first, then we
 * append name to parent.path).
 */
export function splitParentAndName (absolutePath: string): { parentPath: string; name: string } {
    const normalized = normalizeAbsolutePath(absolutePath);
    if ( normalized === '/' ) {
        throw new HttpError(400, 'Cannot derive parent of root');
    }
    const parentPath = pathPosix.dirname(normalized);
    const name = pathPosix.basename(normalized);
    return { parentPath: parentPath === '.' ? '/' : parentPath, name };
}

export function normalizeAbsolutePath (path: string): string {
    const trimmed = typeof path === 'string' ? path.trim() : '';
    if ( trimmed.length === 0 ) {
        throw new HttpError(400, 'Path cannot be empty');
    }
    let normalized = pathPosix.normalize(trimmed);
    if ( ! normalized.startsWith('/') ) {
        normalized = `/${normalized}`;
    }
    if ( normalized.length > 1 && normalized.endsWith('/') ) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/**
 * Build an absolute child path from a parent path + child name. Rejects names
 * containing `/` (v1 behaviour).
 */
export function joinChildPath (parentPath: string, name: string): string {
    if ( typeof name !== 'string' || name.length === 0 ) {
        throw new HttpError(400, 'Name cannot be empty');
    }
    if ( name.includes('/') ) {
        throw new HttpError(400, 'Name cannot contain a slash');
    }
    const parent = normalizeAbsolutePath(parentPath);
    return parent === '/' ? `/${name}` : `${parent}/${name}`;
}
