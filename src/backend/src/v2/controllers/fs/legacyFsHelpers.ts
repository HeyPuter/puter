import { posix as pathPosix } from 'node:path';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryService } from '../../services/fs/FSEntryService.js';
import type { ACLService, AclMode } from '../../services/acl/ACLService.js';
import type { Actor } from '../../core/actor.js';
import type { EventClient } from '../../clients/EventClient.js';
import { HttpError } from '../../core/http/HttpError.js';
import { resolveNode, normalizeAbsolutePath, joinChildPath } from '../../services/fs/resolveNode.js';

/**
 * Shared helpers used by the v1 legacy FS route shims (LegacyFSController).
 *
 * All v1 clients speak snake_case and expect specific response shapes —
 * these helpers encapsulate that translation so the route handlers stay
 * terse.
 */

// ── Body parsing ─────────────────────────────────────────────────────

export function asRecord (value: unknown): Record<string, unknown> {
    if ( !value || typeof value !== 'object' || Array.isArray(value) ) return {};
    return value as Record<string, unknown>;
}

export function getString (record: Record<string, unknown>, ...keys: string[]): string | undefined {
    for ( const key of keys ) {
        const value = record[key];
        if ( typeof value === 'string' && value.length > 0 ) return value;
    }
    return undefined;
}

export function getBoolean (record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
    for ( const key of keys ) {
        const value = record[key];
        if ( typeof value === 'boolean' ) return value;
        if ( typeof value === 'number' ) {
            if ( value === 1 ) return true;
            if ( value === 0 ) return false;
        }
        if ( typeof value === 'string' ) {
            const normalized = value.trim().toLowerCase();
            if ( ['1', 'true', 'yes', 'on'].includes(normalized) ) return true;
            if ( ['0', 'false', 'no', 'off'].includes(normalized) ) return false;
        }
    }
    return undefined;
}

// Accepts either `{ path }` or `{ uid }` or `{ id }` or `{ parent, name }`
// from a v1 body field. Returns a resolved entry (throwing 404 if not found
// or 400 if no usable ref is present).
export async function resolveV1Selector (
    svc: FSEntryService,
    raw: unknown,
    userId: number,
): Promise<FSEntry> {
    // String shorthand: raw path.
    if ( typeof raw === 'string' ) {
        const entry = await resolveNode(svc.entryRepository, { path: raw }, { userId, required: true });
        if ( ! entry ) throw new HttpError(404, `Entry not found: ${raw}`);
        return entry;
    }

    const record = asRecord(raw);

    // {parent, name}: v1 "child selector" — resolve parent, then child by name.
    if ( record.parent !== undefined && typeof record.name === 'string' ) {
        const parent = await resolveV1Selector(svc, record.parent, userId);
        const childPath = joinChildPath(parent.path, record.name);
        const child = await resolveNode(svc.entryRepository, { path: childPath }, { userId, required: true });
        if ( ! child ) throw new HttpError(404, `Entry not found: ${childPath}`);
        return child;
    }

    const ref = {
        path: typeof record.path === 'string' ? record.path : undefined,
        uid: typeof record.uid === 'string' ? record.uid : (typeof record.uuid === 'string' ? record.uuid : undefined),
        id: (typeof record.id === 'number' || typeof record.id === 'string') ? record.id : undefined,
    };
    const entry = await resolveNode(svc.entryRepository, ref, { userId, required: true });
    if ( ! entry ) throw new HttpError(404, 'Entry not found');
    return entry;
}

// ── ACL ──────────────────────────────────────────────────────────────

export async function assertAccess (
    aclService: ACLService,
    fsEntryService: FSEntryService,
    actor: Actor,
    path: string,
    mode: AclMode,
): Promise<void> {
    let ancestors: Promise<Array<{ uid: string; path: string }>> | null = null;
    const descriptor = {
        path,
        resolveAncestors () {
            if ( ! ancestors ) {
                ancestors = fsEntryService.getAncestorChain(path);
            }
            return ancestors;
        },
    };
    const allowed = await aclService.check(actor, descriptor, mode);
    if ( allowed ) return;
    const safe = await aclService.getSafeAclError(actor, descriptor, mode) as {
        status?: unknown; message?: unknown; fields?: { code?: unknown };
    };
    const status = Number(safe?.status);
    const message = typeof safe?.message === 'string' && safe.message.length > 0 ? safe.message : 'Access denied';
    const code = typeof safe?.fields?.code === 'string' ? safe.fields.code : undefined;
    const legacyCode = code === 'forbidden' ? 'access_denied' : code;
    if ( status === 404 ) {
        throw new HttpError(404, message, { ...(legacyCode ? { legacyCode } : {}) });
    }
    throw new HttpError(403, message, { legacyCode: legacyCode ?? 'access_denied' });
}

// ── Response shaping ────────────────────────────────────────────────

/**
 * Produce the snake_case entry shape v1 clients expect. If `thumbnail` is
 * set, asks the thumbnail extension (via `thumbnail.read` event) to swap an
 * S3 URL for a signed one, matching legacy behaviour.
 */
export async function toLegacyEntry (eventClient: EventClient | undefined, entry: FSEntry): Promise<Record<string, unknown>> {
    const dirname = pathPosix.dirname(entry.path);
    const extension = pathPosix.extname(entry.name).slice(1).toLowerCase();
    const response: Record<string, unknown> = {
        id: entry.uuid,
        uid: entry.uuid,
        uuid: entry.uuid,
        user_id: entry.userId,
        parent_id: entry.parentUid,
        parent_uid: entry.parentUid,
        path: entry.path,
        dirname,
        dirpath: dirname,
        name: entry.name,
        is_dir: entry.isDir,
        is_shortcut: entry.isShortcut ? 1 : 0,
        shortcut_to: entry.shortcutTo,
        is_symlink: entry.isSymlink ? 1 : 0,
        symlink_path: entry.symlinkPath,
        type: entry.isDir ? 'folder' : extension,
        writable: true,
        is_public: entry.isPublic,
        thumbnail: entry.thumbnail,
        immutable: entry.immutable,
        metadata: entry.metadata,
        modified: entry.modified,
        created: entry.created,
        accessed: entry.accessed,
        size: entry.size,
        associated_app_id: entry.associatedAppId,
    };

    // Let the thumbnail extension swap an s3:// key for a signed URL.
    if ( typeof response.thumbnail === 'string' && (response.thumbnail as string).length > 0 && eventClient ) {
        const thumbnailEntry = { uuid: entry.uuid, thumbnail: response.thumbnail as string };
        try {
            await eventClient.emit('thumbnail.read', thumbnailEntry, {});
        } catch {
            // ignore — non-critical.
        }
        response.thumbnail = typeof thumbnailEntry.thumbnail === 'string' && thumbnailEntry.thumbnail.length > 0
            ? thumbnailEntry.thumbnail
            : null;
    }

    return response;
}

export { normalizeAbsolutePath };
