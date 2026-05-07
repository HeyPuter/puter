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
import { contentType as contentTypeFromMime } from 'mime-types';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { FSService } from '../../services/fs/FSService.js';
import type { ACLService, AclMode } from '../../services/acl/ACLService.js';
import type { Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import type { EventClient } from '../../clients/event/EventClient.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    resolveNode,
    normalizeAbsolutePath,
    joinChildPath,
    expandTildePath,
} from '../../services/fs/resolveNode.js';
import {
    signFile,
    type SigningConfig,
    type SignedFile,
} from '../../util/fileSigning.js';
import type { IConfig } from '../../types.js';

/**
 * Shared helpers used by the legacy FS route shims (LegacyFSController).
 *
 * Legacy clients speak snake_case and expect specific response shapes —
 * these helpers encapsulate that translation so the route handlers stay
 * terse.
 */

// ── Body parsing ─────────────────────────────────────────────────────

export function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

export function getString(
    record: Record<string, unknown>,
    ...keys: string[]
): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

export function getBoolean(
    record: Record<string, unknown>,
    ...keys: string[]
): boolean | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        }
    }
    return undefined;
}

// Accepts either `{ path }` or `{ uid }` or `{ id }` or `{ parent, name }`
// from a legacy body field. Returns a resolved entry (throwing 404 if not
// found or 400 if no usable ref is present).
//
// `~` / `~/...` paths are expanded to `/<username>/...` using the actor's
// username, read from the ALS-backed Context. Legacy clients send tilde-
// rooted paths (e.g. `~/AppData/<app-uid>/...`); FSController does the same
// expansion via its own `#normalizePath` helper.
export async function resolveV1Selector(
    fsEntryStore: FSEntryStore,
    raw: unknown,
): Promise<FSEntry> {
    const username = Context.get('actor')?.user?.username;

    // String shorthand — either an absolute path (`/a/b/c`) or a UUID.
    // The legacy API accepts both interchangeably; dispatch on the leading
    // character rather than guessing by regex. Anything that doesn't start
    // with `/` is treated as a uid. Tilde-rooted paths are path-shaped.
    if (typeof raw === 'string') {
        const isPath = raw.startsWith('/') || raw.startsWith('~');
        const ref = isPath
            ? { path: expandTildePath(raw, username) }
            : { uid: raw };
        const entry = await resolveNode(fsEntryStore, ref, { required: true });
        if (!entry) throw new HttpError(404, `Entry not found: ${raw}`);
        return entry;
    }

    const record = asRecord(raw);

    // {parent, name}: "child selector" — resolve parent, then child by name.
    if (record.parent !== undefined && typeof record.name === 'string') {
        const parent = await resolveV1Selector(fsEntryStore, record.parent);
        const childPath = joinChildPath(parent.path, record.name);
        const child = await resolveNode(
            fsEntryStore,
            { path: childPath },
            { required: true },
        );
        if (!child) throw new HttpError(404, `Entry not found: ${childPath}`);
        return child;
    }

    const rawPath = typeof record.path === 'string' ? record.path : undefined;
    const ref = {
        path:
            rawPath !== undefined
                ? expandTildePath(rawPath, username)
                : undefined,
        uid:
            typeof record.uid === 'string'
                ? record.uid
                : typeof record.uuid === 'string'
                  ? record.uuid
                  : undefined,
        id:
            typeof record.id === 'number' || typeof record.id === 'string'
                ? record.id
                : undefined,
    };
    const entry = await resolveNode(fsEntryStore, ref, { required: true });
    if (!entry) throw new HttpError(404, 'Entry not found');
    return entry;
}

// ── ACL ──────────────────────────────────────────────────────────────

export async function assertAccess(
    aclService: ACLService,
    fsService: FSService,
    actor: Actor,
    path: string,
    mode: AclMode,
): Promise<void> {
    let ancestors: Promise<Array<{ uid: string; path: string }>> | null = null;
    const descriptor = {
        path,
        resolveAncestors() {
            if (!ancestors) {
                ancestors = fsService.getAncestorChain(path);
            }
            return ancestors;
        },
    };
    const allowed = await aclService.check(actor, descriptor, mode);
    if (allowed) return;
    const safe = (await aclService.getSafeAclError(
        actor,
        descriptor,
        mode,
    )) as {
        status?: unknown;
        message?: unknown;
        fields?: { code?: unknown };
    };
    const status = Number(safe?.status);
    const message =
        typeof safe?.message === 'string' && safe.message.length > 0
            ? safe.message
            : 'Access denied';
    const code =
        typeof safe?.fields?.code === 'string' ? safe.fields.code : undefined;
    const legacyCode = code === 'forbidden' ? 'access_denied' : code;

    // App-under-user actors see denials as 404 "subject_does_not_exist"
    // so existence of a sibling user's / other-app's files isn't leaked
    // through the error code. User-actor denials keep the real 403.
    const isAppActor = Boolean((actor as { app?: unknown })?.app);
    if (isAppActor) {
        throw new HttpError(404, `Entry not found: path=${path}`, {
            legacyCode: 'subject_does_not_exist',
        });
    }

    if (status === 404) {
        throw new HttpError(404, message, {
            ...(legacyCode ? { legacyCode } : {}),
        });
    }
    throw new HttpError(403, message, {
        legacyCode: legacyCode ?? 'access_denied',
    });
}

/**
 * Authorize creation of a new entry at `targetPath`. The standard rule is
 * write on the parent, but we also allow it when the actor has explicit
 * write on the target itself — this covers an app creating its own
 * `/<user>/AppData/<app_uid>` folder (parent `AppData` is off-limits, but
 * the target is the app's own subtree per ACLService's short-circuit) and
 * shares granted directly on a not-yet-created path.
 *
 * On failure, delegates to `assertAccess` on the parent so the error
 * shape stays identical to the previous parent-only check.
 */
export async function assertCanCreate(
    aclService: ACLService,
    fsService: FSService,
    actor: Actor,
    targetPath: string,
): Promise<void> {
    const parent = pathPosix.dirname(targetPath);
    const parentForCheck = parent === '/' ? targetPath : parent;

    const makeDescriptor = (path: string) => {
        let cache: Promise<Array<{ uid: string; path: string }>> | null = null;
        return {
            path,
            resolveAncestors() {
                if (!cache) cache = fsService.getAncestorChain(path);
                return cache;
            },
        };
    };

    if (
        await aclService.check(actor, makeDescriptor(parentForCheck), 'write')
    ) {
        return;
    }
    if (await aclService.check(actor, makeDescriptor(targetPath), 'write')) {
        return;
    }
    await assertAccess(aclService, fsService, actor, parentForCheck, 'write');
}

// ── Response shaping ────────────────────────────────────────────────

type AppRowLookup = {
    getByIds: (ids: number[]) => Promise<Map<number, Record<string, unknown>>>;
};

const toIntBool = (v: unknown): number => (v ? 1 : 0);

/**
 * Convert an AppStore-normalized app row into the v1 `associated_app` shape
 * embedded in legacy FS entries. Booleans round-trip back to integers (0/1)
 * because the v1 wire contract emits them that way and existing clients key
 * off it. Other columns pass through as-is — `metadata` is already parsed.
 */
function mapAppForLegacyAssociatedApp(
    app: Record<string, unknown>,
): Record<string, unknown> {
    return {
        id: app.id,
        uid: app.uid,
        owner_user_id: app.owner_user_id,
        icon: app.icon,
        name: app.name,
        title: app.title,
        description: app.description,
        godmode: toIntBool(app.godmode),
        maximize_on_start: toIntBool(app.maximize_on_start),
        index_url: app.index_url,
        approved_for_listing: toIntBool(app.approved_for_listing),
        approved_for_opening_items: toIntBool(app.approved_for_opening_items),
        approved_for_incentive_program: toIntBool(
            app.approved_for_incentive_program,
        ),
        timestamp: app.timestamp ?? null,
        last_review: app.last_review ?? null,
        tags: app.tags ?? null,
        app_owner: app.app_owner ?? null,
        background: toIntBool(app.background),
        metadata: app.metadata ?? null,
        protected: toIntBool(app.protected),
        is_private: toIntBool(app.is_private),
    };
}

/**
 * Batch-load `associated_app` payloads for a set of entries. Dedupes app ids
 * across the input, hands them to `AppStore.getByIds` (one pipelined Redis
 * MGET + a single `id IN (…)` query for any cache misses), and returns a map
 * keyed by app id holding the v1-shaped embed. Callers pass the result to
 * `toLegacyEntry` via `opts.appsById` so each entry hydrates without a
 * second round-trip.
 *
 * Empty input short-circuits — readdir on a directory of plain files makes
 * zero extra calls.
 */
export async function loadLegacyAssociatedApps(
    appStore: AppRowLookup,
    entries: FSEntry[],
): Promise<Map<number, Record<string, unknown>>> {
    const ids = [
        ...new Set(
            entries
                .map((e) => e.associatedAppId)
                .filter((id): id is number => typeof id === 'number'),
        ),
    ];
    const out = new Map<number, Record<string, unknown>>();
    if (ids.length === 0) return out;
    const apps = await appStore.getByIds(ids);
    for (const [id, app] of apps) {
        out.set(id, mapAppForLegacyAssociatedApp(app));
    }
    return out;
}

/**
 * Produce the snake_case entry shape legacy clients expect. If `thumbnail`
 * is set, asks the thumbnail extension (via `thumbnail.read` event) to swap
 * an S3 URL for a signed one. Pass `fsEntryStore`/`userStore` to hydrate
 * `is_empty` (directories) and `owner` — both are required fields per
 * the legacy stat contract but need extra DB lookups. Pass `appsById`
 * (built via `loadLegacyAssociatedApps`) to populate `associated_app`.
 */
export async function toLegacyEntry(
    eventClient: EventClient | undefined,
    entry: FSEntry,
    opts: {
        fsEntryStore?: FSEntryStore;
        userStore?: {
            getById: (id: number) => Promise<Record<string, unknown> | null>;
        };
        appsById?: Map<number, Record<string, unknown>>;
    } = {},
): Promise<Record<string, unknown>> {
    const dirname = pathPosix.dirname(entry.path);
    // v1 contract: `type` is a MIME content-type (e.g. "image/png; charset=utf-8")
    // for files, or "folder" for directories. The GUI's icon lookup does
    // `type.startsWith('image/')` etc., so a bare extension breaks every
    // banner that falls through the name-extension ladder in item_icon.js.
    const mimeType = entry.isDir
        ? 'folder'
        : contentTypeFromMime(entry.name) || null;

    const pathComponents = entry.path.split('/');
    const appdata_app =
        pathComponents[2] === 'AppData' ? pathComponents[3] : undefined;

    const response: Record<string, unknown> = {
        id: entry.uuid,
        uid: entry.uuid,
        uuid: entry.uuid,
        parent_id: entry.parentUid,
        parent_uid: entry.parentUid,
        path: entry.path,
        dirname,
        dirpath: dirname,
        name: entry.name,
        is_dir: Boolean(entry.isDir),
        is_shortcut: entry.isShortcut ? 1 : 0,
        shortcut_to: entry.shortcutTo,
        is_symlink: entry.isSymlink ? 1 : 0,
        symlink_path: entry.symlinkPath,
        type: mimeType,
        writable: true,
        is_public: entry.isPublic,
        thumbnail: entry.thumbnail,
        immutable: Boolean(entry.immutable),
        metadata: entry.metadata,
        modified: entry.modified,
        created: entry.created,
        accessed: entry.accessed,
        size: entry.size,
        layout: entry.layout,
        subdomains: entry.subdomains,
        workers: entry.workers,
        has_website: entry.hasWebsite ?? entry.subdomains.length > 0,
        suggested_apps: entry.suggestedApps,
        associated_app:
            entry.associatedAppId !== null && opts.appsById
                ? (opts.appsById.get(entry.associatedAppId) ?? null)
                : null,
        appdata_app,
    };

    // `is_empty` — only meaningful for directories. Single-row probe so we
    // don't pay for listing every child.
    if (entry.isDir && opts.fsEntryStore) {
        try {
            const children = await opts.fsEntryStore.listChildren(entry.uuid, {
                limit: 1,
            });
            response.is_empty = children.length === 0;
        } catch {
            response.is_empty = false;
        }
    } else if (!entry.isDir) {
        response.is_empty = false;
    }

    // `owner` — username-only. Matches the legacy safe-entry contract.
    if (opts.userStore) {
        try {
            const owner = await opts.userStore.getById(entry.userId);
            if (owner && typeof owner.username === 'string') {
                response.owner = { username: owner.username };
            }
        } catch {
            /* best-effort */
        }
    }

    // Let the thumbnail extension swap an s3:// key for a signed URL.
    if (
        typeof response.thumbnail === 'string' &&
        (response.thumbnail as string).length > 0 &&
        eventClient
    ) {
        const thumbnailEntry = {
            uuid: entry.uuid,
            thumbnail: response.thumbnail as string,
        };
        try {
            // emitAndWait — listener mutates `thumbnail` on the payload;
            // plain `emit` is fire-and-forget and would drop the rewrite.
            await eventClient.emitAndWait('thumbnail.read', thumbnailEntry, {});
        } catch {
            // ignore — non-critical.
        }
        response.thumbnail =
            typeof thumbnailEntry.thumbnail === 'string' &&
            thumbnailEntry.thumbnail.length > 0
                ? thumbnailEntry.thumbnail
                : null;
    }

    return response;
}

export { normalizeAbsolutePath };

// ── Signing ─────────────────────────────────────────────────────────

/**
 * Pull the signing config off the app config. Throws if either value is
 * missing — these are required for signed URL routes to function.
 */
export function signingConfigFromAppConfig(config: IConfig): SigningConfig {
    const secret = config.url_signature_secret;
    const apiBaseUrl = config.api_base_url;
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new HttpError(
            500,
            'Server misconfiguration: url_signature_secret not set',
        );
    }
    if (typeof apiBaseUrl !== 'string' || apiBaseUrl.length === 0) {
        throw new HttpError(
            500,
            'Server misconfiguration: api_base_url not set',
        );
    }
    return { secret, apiBaseUrl };
}

/**
 * Convenience wrapper: turn an FSEntry into a signed-file response object.
 */
export function signEntry(
    entry: {
        uuid: string;
        name: string;
        isDir: boolean;
        size: number | null;
        accessed: number | null;
        modified: number;
        created: number | null;
    },
    config: SigningConfig,
): SignedFile {
    return signFile(entry as Parameters<typeof signFile>[0], config);
}
