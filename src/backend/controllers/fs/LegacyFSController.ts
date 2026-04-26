import type { Request, RequestHandler, Response } from 'express';
import Busboy from 'busboy';
import { posix as pathPosix } from 'node:path';
import { Context } from '../../core/context.js';
import { isAccessTokenActor } from '../../core/actor.js';
import { contentType as contentTypeFromMime } from 'mime-types';
import { PuterController } from '../types.js';
import { FS_COSTS } from './costs.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import type { ACLService } from '../../services/acl/ACLService.js';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    asRecord,
    assertAccess,
    getBoolean,
    getString,
    resolveV1Selector,
    signingConfigFromAppConfig,
    signEntry,
    toLegacyEntry,
} from './legacyFsHelpers.js';
import { verifySignature } from '../../util/fileSigning.js';
import type { SignedFile } from '../../util/fileSigning.js';

/**
 * Legacy FS routes, implemented as thin shims over `FSService`.
 *
 * Each shim parses the request shape (FSNodeParam-style `{ path, uid, id }`
 * or `{ parent, name }`), invokes the service method, and returns the
 * snake_case response clients expect.
 */

type RouterCache = Map<string, RequestHandler | null>;

const additionalRoutePaths: Record<string, string> = {};

async function loadAdditionalRouter(
    key: string,
): Promise<RequestHandler | null> {
    const path = additionalRoutePaths[key];
    if (!path) return null;
    try {
        const mod = await import(path);
        return (mod.default ?? mod) as RequestHandler;
    } catch (err) {
        console.error(
            `[legacy-fs] failed to load additional route module '${key}':`,
            err,
        );
        return null;
    }
}

// ── Controller ──────────────────────────────────────────────────────

export class LegacyFSController extends PuterController {
    #additionalCache: RouterCache = new Map();

    registerRoutes(router: PuterRouter): void {
        const apiOptions = { subdomain: 'api', requireVerified: true } as const;
        // Signed-URL routes: the handler validates the URL signature itself,
        // so no auth gate is applied (matches v1, which mounted these routers
        // with no middleware).
        const signedOptions = { subdomain: 'api' } as const;

        // Core filesystem_api routes — direct handlers over the FS service.
        router.post('/stat', apiOptions, this.stat);
        router.post('/readdir', apiOptions, this.readdir);
        router.post('/mkdir', apiOptions, this.mkdir);
        router.post('/copy', apiOptions, this.copy);
        router.post('/move', apiOptions, this.move);
        router.post('/delete', apiOptions, this.delete);
        router.post('/rename', apiOptions, this.rename);
        router.post('/touch', apiOptions, this.touch);
        router.post('/search', apiOptions, this.search);
        router.get('/read', apiOptions, this.read);
        router.get(
            '/token-read',
            { subdomain: 'api', requireVerified: false },
            this.tokenRead,
        );

        router.post('/batch', apiOptions, this.batch);

        // Signed-URL + meta routes.
        router.post('/sign', apiOptions, this.sign);
        router.post('/writeFile', signedOptions, this.writeFile);
        router.get('/file', signedOptions, this.file);
        router.all('/df', apiOptions, this.df);
        router.post('/open_item', apiOptions, this.openItem);
        router.post(
            '/auth/request-app-root-dir',
            apiOptions,
            this.requestAppRootDir,
        );
        router.post('/auth/check-app-acl', apiOptions, this.checkAppAcl);

        // `/down` — session-auth'd file download. Unlike `/file` (signed URL)
        // this accepts a path on the user's behalf and streams as attachment.
        // Matches v1 semantics: mounted on both root and api subdomains
        // because the GUI triggers it from `window.origin`, not the api host.
        router.post(
            '/down',
            {
                subdomain: ['api', ''],
                requireUserActor: true,
                requireVerified: true,
                antiCsrf: true,
            },
            this.down,
        );
        // /itemMetadata is deprecated; not called by puter-js. Return 410 Gone.
        router.get('/itemMetadata', apiOptions, (_req, res) => {
            res.status(410).json({
                error: 'itemMetadata is deprecated; use /fs/stat',
            });
        });

        router.get('/get-launch-apps', apiOptions, async (req, res) => {
            const recommendedSvc = this.services.recommendedApps as unknown as
                | { getRecommendedApps?: () => Promise<unknown[]> }
                | undefined;
            const recommended = recommendedSvc?.getRecommendedApps
                ? await recommendedSvc.getRecommendedApps()
                : [];

            let recent: unknown[] = [];
            const userId = req.actor?.user?.id;
            if (userId) {
                const recentUids =
                    (await (
                        this.stores.app as unknown as {
                            getRecentAppOpens?: (
                                id: number,
                                opts?: { limit?: number },
                            ) => Promise<string[]>;
                        }
                    ).getRecentAppOpens?.(userId, { limit: 10 })) ?? [];
                const apps: unknown[] = [];
                for (const uid of recentUids) {
                    const app = await (
                        this.stores.app as unknown as {
                            getByUid: (
                                uid: string,
                            ) => Promise<Record<string, unknown> | null>;
                        }
                    ).getByUid(uid);
                    if (app) {
                        apps.push({
                            uuid: app.uid,
                            name: app.name,
                            title: app.title,
                            icon: app.icon ?? null,
                            godmode: Boolean(app.godmode),
                            maximize_on_start: Boolean(app.maximize_on_start),
                            index_url: app.index_url,
                        });
                    }
                }
                recent = apps;
            }

            res.json({ recommended, recent });
        });

        router.post('/suggest_apps', apiOptions, async (req, res) => {
            const suggestSvc = this.services.suggestedApps;
            if (!suggestSvc?.getSuggestedApps) {
                res.json([]);
                return;
            }
            const body = req.body ?? {};
            // Client sends { uid } or { path } identifying a file entry.
            // Resolve the entry to get its name/path for extension detection.
            const userId = req.actor?.user?.id;
            let entryName: string | undefined;
            let entryPath: string | undefined;
            if (body.uid || body.path) {
                try {
                    const entry = await resolveV1Selector(
                        this.stores.fsEntry,
                        body,
                        userId ?? NaN,
                    );
                    entryName = entry?.name;
                    entryPath = entry?.path;
                } catch {
                    // If we can't resolve, fall back to empty
                }
            }
            const suggestions = await suggestSvc.getSuggestedApps({
                name: entryName,
                path: entryPath,
            });
            res.json(suggestions);
        });

        // puter-js polls this to decide whether to purge its in-memory FS
        // cache. SocketService bumps a per-user Redis key on every
        // `outer.gui.item.*` mutation — read it back here.
        router.get(
            '/cache/last-change-timestamp',
            apiOptions,
            async (req, res) => {
                const userId = req.actor?.user?.id;
                if (!userId) {
                    res.json({ timestamp: 0 });
                    return;
                }
                const socket = this.services.socket as unknown as
                    | {
                          getLastChangeTimestamp?: (
                              id: number,
                          ) => Promise<number>;
                      }
                    | undefined;
                const timestamp = socket?.getLastChangeTimestamp
                    ? await socket.getLastChangeTimestamp(userId)
                    : 0;
                res.json({ timestamp });
            },
        );

        // ── POST /readdir-subdomains ────────────────────────────────
        router.post(
            '/readdir-subdomains',
            apiOptions,
            async (req: Request, res: Response) => {
                const userId = req.actor?.user?.id;
                if (!userId)
                    throw new HttpError(401, 'Authentication required');
                const rows = await this.clients.db.read(
                    'SELECT `subdomain`, `root_dir_id`, `uuid`, `ts` FROM `subdomains` WHERE `user_id` = ?',
                    [userId],
                );
                res.json(rows);
            },
        );

        // ── POST /update-fsentry-thumbnail ──────────────────────────
        router.post(
            '/update-fsentry-thumbnail',
            apiOptions,
            async (req: Request, res: Response) => {
                const userId = req.actor?.user?.id;
                if (!userId)
                    throw new HttpError(401, 'Authentication required');
                const { uid, thumbnail } = (req.body ?? {}) as {
                    uid?: string;
                    thumbnail?: string;
                };
                if (!uid) throw new HttpError(400, 'Missing `uid`');
                if (!thumbnail) throw new HttpError(400, 'Missing `thumbnail`');

                const entry = await this.stores.fsEntry.getEntryByUuid(uid);
                if (!entry || entry.userId !== userId)
                    throw new HttpError(403, 'Access denied');

                // Emit thumbnail.created so the thumbnails extension can S3-upload.
                // emitAndWait is required — the extension rewrites `event.url`
                // from a data URL to an `s3://` pointer, and the DB write below
                // needs to see that rewrite.
                const event = { url: thumbnail };
                await this.clients.event.emitAndWait(
                    'thumbnail.created',
                    event,
                    {},
                );

                await this.clients.db.write(
                    'UPDATE `fsentries` SET `thumbnail` = ? WHERE `uuid` = ?',
                    [event.url, uid],
                );
                res.json({ thumbnail: event.url });
            },
        );

        for (const key of Object.keys(additionalRoutePaths)) {
            router.use(
                this.#createLazyHandler(
                    key,
                    this.#additionalCache,
                    loadAdditionalRouter,
                ),
            );
        }
    }

    // ── Route implementations ───────────────────────────────────────────
    //
    // Handlers are public arrow class fields so they auto-bind `this` and can
    // be passed directly to `router.post(...)` without `.bind(this)`. Express
    // 5 catches their async rejections and routes them to the error handler.

    stat = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            body,
            userId,
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            entry.path,
            'see',
        );

        entry.suggestedApps =
            await this.services.suggestedApps.getSuggestedApps(entry);

        const shaped = await toLegacyEntry(this.clients.event, entry, {
            fsEntryStore: this.stores.fsEntry,
            userStore: this.stores.user as unknown as {
                getById: (
                    id: number,
                ) => Promise<Record<string, unknown> | null>;
            },
        });

        // Optional hydrations:
        if (entry.isDir && getBoolean(body, 'return_size')) {
            shaped.size = await this.services.fs.getSubtreeSize(
                userId,
                entry.path,
            );
        }
        // Legacy clients sometimes ask for `return_versions`, `return_owner`,
        // `return_shares`. We don't have parity for these yet — return empty
        // arrays/null to avoid breaking `response.x.forEach(...)` patterns.
        if (getBoolean(body, 'return_versions')) shaped.versions = [];
        if (getBoolean(body, 'return_shares')) shaped.shares = [];
        if (getBoolean(body, 'return_owner'))
            shaped.owner = { user_id: entry.userId };

        res.json(shaped);
    };

    readdir = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        if (this.#isRootPathRef(body)) {
            const { listRootEntries } =
                await import('../../services/fs/rootListing.js');
            const rootChildren = await listRootEntries(
                actor,
                this.stores.fsEntry,
                this.services.permission,
            );
            const rootSuggestions =
                await this.services.suggestedApps.getSuggestedAppsForEntries(
                    rootChildren,
                );
            for (let index = 0; index < rootChildren.length; index++) {
                const child = rootChildren[index];
                if (child) {
                    child.suggestedApps = rootSuggestions[index] ?? [];
                }
            }
            const shaped = await Promise.all(
                rootChildren.map((c) => toLegacyEntry(this.clients.event, c)),
            );
            res.json(shaped);
            return;
        }

        const parent = await resolveV1Selector(
            this.stores.fsEntry,
            body,
            userId,
        );
        if (!parent.isDir) {
            throw new HttpError(400, 'Target is not a directory');
        }
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            parent.path,
            'list',
        );

        const children = await this.services.fs.listDirectory(parent.uuid, {
            sortBy: this.#parseSortBy(body),
            sortOrder: this.#parseSortOrder(body),
        });

        const suggestions =
            await this.services.suggestedApps.getSuggestedAppsForEntries(
                children,
            );
        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            if (child) {
                child.suggestedApps = suggestions[index] ?? [];
            }
        }

        const shaped = await Promise.all(
            children.map((c) => toLegacyEntry(this.clients.event, c)),
        );
        res.json(shaped);
    };

    mkdir = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const rawPath = getString(body, 'path');
        if (!rawPath) throw new HttpError(400, '`path` is required');

        // Supports `{ parent, path }` where `path` is a relative suffix.
        let targetPath = rawPath;
        if (body.parent !== undefined && !rawPath.startsWith('/')) {
            const parent = await resolveV1Selector(
                this.stores.fsEntry,
                body.parent,
                userId,
            );
            targetPath =
                parent.path === '/'
                    ? `/${rawPath}`
                    : `${parent.path}/${rawPath}`;
        }

        const parentPath = pathPosix.dirname(
            targetPath.startsWith('/') ? targetPath : `/${targetPath}`,
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            parentPath === '/' ? targetPath : parentPath,
            'write',
        );

        const entry = await this.services.fs.mkdir(userId, {
            path: targetPath,
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
            createMissingParents:
                getBoolean(
                    body,
                    'create_missing_parents',
                    'create_missing_ancestors',
                ) ?? false,
        });
        await this.#emitGuiEvent('outer.gui.item.added', entry);

        res.json(await toLegacyEntry(this.clients.event, entry));
    };

    copy = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const source = await resolveV1Selector(
            this.stores.fsEntry,
            body.source,
            userId,
        );
        const destinationParent = await resolveV1Selector(
            this.stores.fsEntry,
            body.destination,
            userId,
        );

        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            source.path,
            'read',
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            destinationParent.path,
            'write',
        );

        const copy = await this.services.fs.copy(userId, {
            source,
            destinationParent,
            newName: getString(body, 'new_name'),
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
        });
        await this.#emitGuiEvent('outer.gui.item.added', copy);

        // Legacy response shape: `[{copied: fsentry, overwritten?}]`.
        // Array is historical — originally supported bulk copy.
        const copied = await toLegacyEntry(this.clients.event, copy, {
            fsEntryStore: this.stores.fsEntry,
            userStore: this.stores.user as unknown as {
                getById: (
                    id: number,
                ) => Promise<Record<string, unknown> | null>;
            },
        });
        res.json([{ copied }]);
    };

    move = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const source = await resolveV1Selector(
            this.stores.fsEntry,
            body.source,
            userId,
        );
        const destinationParent = await resolveV1Selector(
            this.stores.fsEntry,
            body.destination,
            userId,
        );

        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            source.path,
            'write',
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            destinationParent.path,
            'write',
        );

        const moved = await this.services.fs.move(userId, {
            source,
            destinationParent,
            newName: getString(body, 'new_name'),
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
            // Trash/restore rides on this: GUI sends
            // `{ original_name, original_path, trashed_ts }` when moving into
            // Trash, and `null`/`{}` when restoring. See
            // `src/gui/src/helpers.js` → `window.move_items`.
            newMetadata: (body.new_metadata ?? undefined) as
                | Record<string, unknown>
                | null
                | undefined,
        });
        const oldPath = source.path;
        await this.#emitGuiEvent('outer.gui.item.moved', moved, {
            old_path: oldPath,
        });

        // Legacy response shape: `{moved: fsentry, old_path}`.
        const movedEntry = await toLegacyEntry(this.clients.event, moved, {
            fsEntryStore: this.stores.fsEntry,
            userStore: this.stores.user as unknown as {
                getById: (
                    id: number,
                ) => Promise<Record<string, unknown> | null>;
            },
        });
        res.json({ moved: movedEntry, old_path: oldPath });
    };

    delete = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        // /delete can take `paths: []` for bulk delete, or a single selector.
        const descendantsOnly = getBoolean(body, 'descendants_only') ?? false;
        const pathsArray = Array.isArray(body.paths) ? body.paths : null;
        if (pathsArray) {
            const removedEntries: unknown[] = [];
            for (const raw of pathsArray) {
                const entry = await resolveV1Selector(
                    this.stores.fsEntry,
                    raw,
                    userId,
                );
                await assertAccess(
                    this.services.acl,
                    this.services.fs,
                    actor,
                    entry.path,
                    'write',
                );
                await this.services.fs.remove(userId, {
                    entry,
                    recursive: getBoolean(body, 'recursive') ?? true,
                    descendantsOnly,
                });
                await this.#emitGuiEvent('outer.gui.item.removed', entry, {
                    descendants_only: descendantsOnly,
                });
                removedEntries.push(
                    await toLegacyEntry(this.clients.event, entry),
                );
            }
            res.json(removedEntries);
            return;
        }

        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            body,
            userId,
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            entry.path,
            'write',
        );
        await this.services.fs.remove(userId, {
            entry,
            recursive: getBoolean(body, 'recursive') ?? true,
            descendantsOnly,
        });
        await this.#emitGuiEvent('outer.gui.item.removed', entry, {
            descendants_only: descendantsOnly,
        });
        res.json({ ok: true, uid: entry.uuid });
    };

    rename = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const newName = getString(body, 'new_name');
        if (!newName) throw new HttpError(400, '`new_name` is required');

        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            body,
            userId,
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            entry.path,
            'write',
        );

        const renamed = await this.services.fs.rename(entry, newName);
        await this.#emitGuiEvent('outer.gui.item.updated', renamed);
        res.json(await toLegacyEntry(this.clients.event, renamed));
    };

    touch = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const rawPath = getString(body, 'path');
        if (!rawPath) throw new HttpError(400, '`path` is required');

        const parentPath = pathPosix.dirname(
            rawPath.startsWith('/') ? rawPath : `/${rawPath}`,
        );
        if (parentPath === '/') {
            throw new HttpError(400, 'Cannot touch in root');
        }
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            parentPath,
            'write',
        );

        await this.services.fs.touch(userId, {
            path: rawPath,
            setAccessed: getBoolean(body, 'set_accessed_to_now') ?? false,
            setModified: getBoolean(body, 'set_modified_to_now') ?? false,
            setCreated: getBoolean(body, 'set_created_to_now') ?? false,
            createMissingParents:
                getBoolean(body, 'create_missing_parents') ?? false,
        });
        // /touch historically returns an empty body.
        res.send('');
    };

    search = async (req: Request, res: Response): Promise<void> => {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const query = getString(body, 'query', 'text') ?? '';
        if (query.trim().length === 0)
            throw new HttpError(400, '`query` is required');

        const results = await this.services.fs.searchByName(userId, query, 200);
        const shaped = await Promise.all(
            results.map((r) => toLegacyEntry(this.clients.event, r)),
        );
        res.json(shaped);
    };

    read = async (req: Request, res: Response, options = {}): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const query = asRecord(req.query);

        // Legacy v1 /read aliased `file` onto either path or uid depending on
        // whether the value starts with `/`. resolveV1Selector does the same
        // dispatch when handed a raw string.
        const selector =
            typeof query.file === 'string' && query.file.length > 0
                ? query.file
                : query;
        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            selector,
            userId,
        );
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            entry.path,
            'read',
        );

        if (entry.isDir) {
            throw new HttpError(400, 'Cannot read a directory');
        }

        const range =
            typeof req.headers.range === 'string'
                ? req.headers.range
                : undefined;
        const download = await this.services.fs.readContent(entry, {
            range,
        });

        // Force `application/octet-stream` on this endpoint for wire parity
        // with v1. puter-js's `parseResponse` branches on Content-Type —
        // `application/octet-stream` returns the raw Blob while other
        // types wrap in `{success, result: Blob}`. Clients (including the
        // GUI) expect the raw-Blob shape. Use `/fs/read` for type-aware
        // streaming.
        if (options.realMime) {
            res.setHeader('Content-Type', contentTypeFromMime(entry.name));
        } else {
            res.setHeader('Content-Type', 'application/octet-stream');
        }

        if (download.contentLength !== null)
            res.setHeader('Content-Length', String(download.contentLength));
        if (download.contentRange)
            res.setHeader('Content-Range', download.contentRange);
        if (download.etag) res.setHeader('ETag', download.etag);
        if (download.lastModified)
            res.setHeader('Last-Modified', download.lastModified.toUTCString());
        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(entry.name)}"`,
        );
        res.status(range ? 206 : 200);

        // Best-effort egress metering.
        const metering = this.services.metering as
            | {
                  batchIncrementUsages?: (
                      actor: unknown,
                      entries: unknown[],
                  ) => void;
              }
            | undefined;
        if (metering?.batchIncrementUsages && download.contentLength) {
            download.body.once('end', () => {
                try {
                    const bytes = download.contentLength!;
                    metering.batchIncrementUsages!(actor, [
                        {
                            usageType: 'filesystem:egress:bytes',
                            usageAmount: bytes,
                            costOverride:
                                FS_COSTS['filesystem:egress:bytes'] * bytes,
                        },
                    ]);
                } catch {
                    // ignore — non-critical.
                }
            });
        }
        download.body.on('error', (err) => {
            res.destroy(err);
        });
        download.body.pipe(res);
    };

    tokenRead = async (req: Request, res: Response): Promise<void> => {
        const query = asRecord(req.query);
        const accessToken = getString(query, 'token');
        if (!accessToken) {
            throw new HttpError(401, 'Token authentication failed', {
                legacyCode: 'token_auth_failed',
            });
        }

        const actor =
            await this.services.auth.authenticateFromToken(accessToken);
        if (!isAccessTokenActor(actor)) {
            throw new HttpError(401, 'Token authentication failed', {
                legacyCode: 'token_auth_failed',
            });
        }

        req.actor = actor;
        Context.set('actor', actor);

        // Forward back to regular read after setting actor
        return this.read(req, res, { realMime: true });
    };

    // ── Signed-URL + meta routes ────────────────────────────────────────

    /**
     * POST /sign
     * Body: `{ items: [{ uid?, path?, action }], app_uid? }`. Returns
     * `{ signatures: [...], token? }`. Apps may only sign files under their
     * own AppData subtree.
     */
    sign = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) throw new HttpError(400, '`items` is required');

        const isApp = Boolean((actor as { app?: unknown }).app);
        const signingCfg = signingConfigFromAppConfig(this.config);

        // Apps can only sign inside their AppData root.
        let appDataRoot: string | null = null;
        if (isApp) {
            const username = (actor as { user?: { username?: string } }).user
                ?.username;
            const appUid = (actor as { app?: { uid?: string } }).app?.uid;
            if (!username || !appUid) throw new HttpError(403, 'Forbidden');
            appDataRoot = `/${username}/AppData/${appUid}`;
        }

        type SignedOrEmpty =
            | (SignedFile & { path?: string })
            | Record<string, never>;
        const result: { signatures: SignedOrEmpty[]; token?: string } = {
            signatures: [],
        };

        // Optional app grant: provide app_uid to grant permissions + token.
        let grantApp: { uid: string } | null = null;
        if (typeof body.app_uid === 'string' && body.app_uid.length > 0) {
            const app = await this.stores.app.getByUid(body.app_uid);
            if (!app) throw new HttpError(404, 'App not found');
            grantApp = { uid: app.uid };
            result.token = this.services.auth.getUserAppToken(actor, app.uid);
        }

        for (const rawItem of items) {
            const item = asRecord(rawItem);
            const uid = typeof item.uid === 'string' ? item.uid : undefined;
            const path = typeof item.path === 'string' ? item.path : undefined;
            const action =
                typeof item.action === 'string' ? item.action : 'read';
            if (!uid && !path) {
                result.signatures.push({});
                continue;
            }
            try {
                const entry = await resolveV1Selector(
                    this.stores.fsEntry,
                    { uid, path },
                    userId,
                );

                // App-sandbox check.
                const withinAppRoot = appDataRoot
                    ? entry.path === appDataRoot ||
                      entry.path.startsWith(`${appDataRoot}/`)
                    : true;
                if (!withinAppRoot) {
                    throw new HttpError(403, 'Forbidden');
                }

                // ACL: always require read; downgrade write→read silently.
                await assertAccess(
                    this.services.acl,
                    this.services.fs,
                    actor,
                    entry.path,
                    'read',
                );
                let finalAction: 'read' | 'write' = 'read';
                if (action === 'write') {
                    const writeOk = await this.services.acl.check(
                        actor,
                        {
                            path: entry.path,
                            resolveAncestors: () =>
                                this.services.fs.getAncestorChain(entry.path),
                        },
                        'write',
                    );
                    finalAction = writeOk ? 'write' : 'read';
                }

                if (grantApp) {
                    // Grant the app the permission the user is signing for.
                    await this.services.permission.grantUserAppPermission(
                        actor,
                        grantApp.uid,
                        `fs:${entry.uuid}:${finalAction}`,
                        {},
                        { reason: 'endpoint:sign' },
                    );
                }

                const signed = signEntry(entry, signingCfg);
                result.signatures.push({ ...signed, path: entry.path });
            } catch {
                // Silently skip unresolvable items.
                result.signatures.push({});
            }
        }

        res.json(result);
    };

    /**
     * POST /writeFile?uid=<uid>&operation=<op>
     * Signature-authenticated multipart upload. `operation` dispatches to one
     * of write/copy/move/mkdir/delete/rename/trash. Signature must be valid
     * for `write` action on `uid`.
     */
    writeFile = async (req: Request, res: Response): Promise<void> => {
        const query = asRecord(req.query);
        const signingCfg = signingConfigFromAppConfig(this.config);
        verifySignature(
            {
                uid: query.uid as string,
                expires: query.expires as string,
                signature: query.signature as string,
            },
            'write',
            signingCfg,
        );

        const uid = typeof query.uid === 'string' ? query.uid : '';
        const targetEntry = await resolveV1Selector(
            this.stores.fsEntry,
            { uid },
            NaN,
        );
        if (!targetEntry) throw new HttpError(404, 'Item not found');

        // Owner suspension check.
        const owner = await this.stores.user.getById(targetEntry.userId);
        if (!owner) throw new HttpError(500, 'Owner not found');
        if ((owner as { suspended?: unknown }).suspended)
            throw new HttpError(401, 'Account suspended');

        const userId = targetEntry.userId;
        const operation =
            typeof query.operation === 'string' ? query.operation : 'write';

        // `write` — multipart upload, streamed directly to the v2 write path.
        if (operation === 'write') {
            const body = asRecord(req.body);
            const parentEntry = targetEntry.isDir
                ? targetEntry
                : await this.#resolveParentOfEntry(targetEntry);
            const name =
                typeof body.name === 'string'
                    ? body.name
                    : targetEntry.isDir
                      ? `upload-${Date.now()}`
                      : targetEntry.name;
            const targetPath =
                parentEntry.path === '/'
                    ? `/${name}`
                    : `${parentEntry.path}/${name}`;

            // Parse multipart and pipe the first `file` part into fsService.write.
            const uploadResult = await this.#multipartWrite(
                req,
                userId,
                targetPath,
            );
            await this.#emitGuiEvent(
                'outer.gui.item.added',
                uploadResult.fsEntry,
            );
            const signed = signEntry(uploadResult.fsEntry, signingCfg);
            res.json({ ...signed, path: uploadResult.fsEntry.path });
            return;
        }

        // Non-write operations: route to existing service methods and sign the result.
        const record = asRecord(req.body);
        if (operation === 'mkdir') {
            const folderName =
                typeof record.name === 'string'
                    ? record.name
                    : `folder-${Date.now()}`;
            const entry = await this.services.fs.mkdir(userId, {
                path: targetEntry.isDir
                    ? `${targetEntry.path === '/' ? '' : targetEntry.path}/${folderName}`
                    : targetEntry.path,
                dedupeName: true,
            });
            await this.#emitGuiEvent('outer.gui.item.added', entry);
            res.json({ ...signEntry(entry, signingCfg), path: entry.path });
            return;
        }
        if (operation === 'rename') {
            const newName =
                typeof record.new_name === 'string' ? record.new_name : '';
            if (!newName) throw new HttpError(400, '`new_name` required');
            const renamed = await this.services.fs.rename(targetEntry, newName);
            await this.#emitGuiEvent('outer.gui.item.updated', renamed);
            res.json({ ...signEntry(renamed, signingCfg), path: renamed.path });
            return;
        }
        if (operation === 'delete' || operation === 'trash') {
            // Treat trash == delete (recursive). Most clients just call delete
            // directly; if a trash folder becomes important we can revisit.
            await this.services.fs.remove(userId, {
                entry: targetEntry,
                recursive: true,
            });
            await this.#emitGuiEvent('outer.gui.item.removed', targetEntry);
            res.json({ ok: true, uid: targetEntry.uuid });
            return;
        }
        if (operation === 'copy' || operation === 'move') {
            const destRef =
                record.destination ??
                record.destination_uid ??
                record.dest_path;
            if (!destRef) throw new HttpError(400, '`destination` required');
            const destinationParent = await resolveV1Selector(
                this.stores.fsEntry,
                destRef,
                userId,
            );
            const method = operation === 'copy' ? 'copy' : 'move';
            const result = await this.services.fs[method](userId, {
                source: targetEntry,
                destinationParent,
                newName:
                    typeof record.new_name === 'string'
                        ? record.new_name
                        : undefined,
                overwrite: getBoolean(record, 'overwrite') ?? false,
                dedupeName: getBoolean(record, 'dedupe_name') ?? false,
            });
            await this.#emitGuiEvent(
                operation === 'copy'
                    ? 'outer.gui.item.added'
                    : 'outer.gui.item.moved',
                result,
                operation === 'move'
                    ? { old_path: targetEntry.path }
                    : undefined,
            );
            res.json({ ...signEntry(result, signingCfg), path: result.path });
            return;
        }

        throw new HttpError(
            400,
            `Unsupported writeFile operation: '${operation}'`,
        );
    };

    /**
     * GET /file?uid=<uid>&signature=...&expires=...
     * Signature-authenticated file read. Directories return a signed listing
     * of children; files stream bytes (with Range support when `download`
     * isn't requested).
     */
    file = async (req: Request, res: Response): Promise<void> => {
        const query = asRecord(req.query);
        const signingCfg = signingConfigFromAppConfig(this.config);
        verifySignature(
            {
                uid: query.uid as string,
                expires: query.expires as string,
                signature: query.signature as string,
            },
            'read',
            signingCfg,
        );

        const uid = typeof query.uid === 'string' ? query.uid : '';
        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            { uid },
            NaN,
        );

        // Owner-suspension guard — matches v1's /file. A signed URL stays
        // valid forever by default, so a signature minted before a suspension
        // would otherwise keep leaking content.
        const owner = await this.stores.user.getById(entry.userId);
        if ((owner as { suspended?: unknown } | null)?.suspended) {
            throw new HttpError(401, 'Account suspended');
        }

        // Directory: return a signed listing of direct children.
        if (entry.isDir) {
            const children = await this.services.fs.listDirectory(entry.uuid);
            const signedChildren = children.map((child) => ({
                ...signEntry(child, signingCfg),
                path: child.path,
            }));
            res.json(signedChildren);
            return;
        }

        // File: stream bytes with Range support.
        const range =
            typeof req.headers.range === 'string'
                ? req.headers.range
                : undefined;
        const download = await this.services.fs.readContent(entry, {
            range,
        });
        const wantsAttachment =
            query.download === 'true' ||
            query.download === '1' ||
            query.download === true;

        if (download.contentType)
            res.setHeader('Content-Type', download.contentType);
        if (download.contentLength !== null)
            res.setHeader('Content-Length', String(download.contentLength));
        if (download.contentRange)
            res.setHeader('Content-Range', download.contentRange);
        if (download.etag) res.setHeader('ETag', download.etag);
        if (download.lastModified)
            res.setHeader('Last-Modified', download.lastModified.toUTCString());
        res.setHeader(
            'Content-Disposition',
            `${wantsAttachment ? 'attachment' : 'inline'}; filename="${encodeURIComponent(entry.name)}"`,
        );
        res.status(range ? 206 : 200);

        download.body.on('error', (err) => {
            res.destroy(err);
        });
        download.body.pipe(res);
    };

    /** GET|POST /df — user storage allowance. */
    df = async (req: Request, res: Response): Promise<void> => {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const allowance =
            await this.services.fs.getUsersStorageAllowance(userId);
        res.json({
            used: allowance.curr,
            capacity: allowance.max,
        });
    };

    /**
     * POST /open_item — resolve an entry, grant the default suggested app
     * write access to it, and return a signed URL + user-app token so the
     * launched app can read/write the file via its app-under-user token.
     *
     * Matches v1 semantics: permission is always granted as `write` — the
     * underlying user's permission check still caps the effective access
     * (grantUserAppPermission doesn't escalate user privileges).
     */
    openItem = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            body,
            userId,
        );

        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            entry.path,
            'read',
        );

        const suggested =
            (await this.services.suggestedApps?.getSuggestedApps({
                name: entry.name,
                path: entry.path,
            })) ?? [];

        let token: string | null = null;
        const defaultAppUid =
            typeof suggested[0]?.uuid === 'string'
                ? (suggested[0].uuid as string)
                : undefined;
        if (defaultAppUid) {
            await this.services.permission.grantUserAppPermission(
                actor,
                defaultAppUid,
                `fs:${entry.uuid}:write`,
                {},
                { reason: 'open_item' },
            );
            token = this.services.auth.getUserAppToken(actor, defaultAppUid);
        }

        const signingCfg = signingConfigFromAppConfig(this.config);
        const signature = { ...signEntry(entry, signingCfg), path: entry.path };
        res.json({
            signature,
            token,
            suggested_apps: suggested,
        });
    };

    /**
     * POST /auth/request-app-root-dir — an app-under-user requests stat on
     * its own app root directory. The app must own itself.
     */
    requestAppRootDir = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const body = asRecord(req.body);
        const appUid = getString(body, 'app_uid');
        if (!appUid) throw new HttpError(400, '`app_uid` is required');

        const actorApp = (actor as { app?: { uid?: string } }).app;
        if (!actorApp?.uid || actorApp.uid !== appUid) {
            throw new HttpError(
                403,
                'Only the app itself may request its root dir',
            );
        }
        const userId = this.#getActorUserId(req);
        const username = (actor as { user?: { username?: string } }).user
            ?.username;
        if (!username) throw new HttpError(401, 'Unauthorized');

        const rootPath = `/${username}/AppData/${appUid}`;
        // Auto-create the AppData/<uid> tree on first call.
        const entry = await this.services.fs.mkdir(userId, {
            path: rootPath,
            createMissingParents: true,
        });
        res.json(await toLegacyEntry(this.clients.event, entry));
    };

    /**
     * POST /auth/check-app-acl — check whether an app has a given mode of
     * access to a subject FS entry.
     */
    checkAppAcl = async (req: Request, res: Response): Promise<void> => {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const subjectRef = body.subject;
        const appRef = body.app;
        const mode = (getString(body, 'mode') ?? 'read') as
            | 'see'
            | 'list'
            | 'read'
            | 'write';
        if (!subjectRef || !appRef)
            throw new HttpError(400, '`subject` and `app` are required');

        const subject = await resolveV1Selector(
            this.stores.fsEntry,
            subjectRef,
            userId,
        );
        let app: { uid: string } | null = null;
        if (typeof appRef === 'string') {
            app =
                (await this.stores.app.getByUid(appRef)) ??
                (await this.stores.app.getByName(appRef));
        }
        if (!app) throw new HttpError(404, 'App not found');

        // Build an actor-under-user shape for the check.
        const actorForApp = {
            user: (req.actor as { user?: unknown }).user,
            app: { uid: (app as { uid: string }).uid },
        } as unknown as Actor;
        const descriptor = {
            path: subject.path,
            resolveAncestors: () =>
                this.services.fs.getAncestorChain(subject.path),
        };
        const allowed = await (this.services.acl as ACLService).check(
            actorForApp,
            descriptor,
            mode,
        );
        res.json({ allowed });
    };

    /**
     * POST /down?path=/absolute/path — session-auth'd, path-based file
     * download. Keeps v1's wire contract: path query param, anti-CSRF body
     * token, attachment response. No signed URL involved — /file (signature
     * based) and /down (session based) are the two download paths.
     */
    down = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);

        const rawPath =
            typeof req.query.path === 'string' ? req.query.path.trim() : '';
        if (!rawPath) throw new HttpError(400, '`path` is required');
        if (rawPath === '/')
            throw new HttpError(400, 'Cannot download a directory');

        const entry = await resolveV1Selector(
            this.stores.fsEntry,
            { path: rawPath },
            userId,
        );
        if (entry.isDir)
            throw new HttpError(400, 'Cannot download a directory');

        // Same ACL gate that /read uses — owners hit the is-owner implicator;
        // shared-file readers get through the permission scan.
        await assertAccess(
            this.services.acl,
            this.services.fs,
            actor,
            entry.path,
            'read',
        );

        const range =
            typeof req.headers.range === 'string'
                ? req.headers.range
                : undefined;
        const download = await this.services.fs.readContent(entry, {
            range,
        });

        res.setHeader('Content-Type', 'application/octet-stream');
        if (download.contentLength !== null)
            res.setHeader('Content-Length', String(download.contentLength));
        if (download.contentRange)
            res.setHeader('Content-Range', download.contentRange);
        if (download.etag) res.setHeader('ETag', download.etag);
        if (download.lastModified)
            res.setHeader('Last-Modified', download.lastModified.toUTCString());
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(entry.name)}"`,
        );
        res.status(range ? 206 : 200);

        download.body.on('error', (err) => {
            res.destroy(err);
        });
        download.body.pipe(res);
    };

    // Helpers for writeFile
    // ── GUI event emission ───────────────────────────────────────────
    //
    // Fire-and-forget `outer.gui.item.*` events so SocketService,
    // BroadcastService, WorkerDriver (hot-reload), and cache-invalidation
    // listeners pick up mutations made through the legacy (bare-path) routes.
    // FSController (v2-native /fs/* routes) emits these from its own handlers;
    // LegacyFSController delegates to the same FSService but needs its
    // own emissions because the service layer deliberately doesn't emit GUI
    // events (that's a controller concern).

    async #emitGuiEvent(
        eventName:
            | 'outer.gui.item.added'
            | 'outer.gui.item.updated'
            | 'outer.gui.item.removed'
            | 'outer.gui.item.moved',
        entry: import('../../stores/fs/FSEntry.js').FSEntry,
        extra?: Record<string, unknown>,
    ): Promise<void> {
        // GUI consumes snake_case fields (`user_id`, `parent_uid`, `is_dir`,
        // …) — spreading the raw FSEntry ships camelCase, which the client
        // silently ignores. Run the entry through `toLegacyEntry` first so
        // the event payload matches what /stat et al. return, then overlay
        // per-op extras (e.g. `old_path` for moves).
        try {
            const response = {
                ...(await toLegacyEntry(this.clients.event, entry)),
                ...extra,
                from_new_service: true,
            };
            await this.clients.event.emit(
                eventName,
                {
                    user_id_list: [entry.userId],
                    response,
                },
                {},
            );
        } catch {
            // Non-critical — GUI event failure must never break the HTTP response.
        }
    }

    async #resolveParentOfEntry(entry: { path: string; userId: number }) {
        const parentPath = pathPosix.dirname(entry.path);
        const parent = await resolveV1Selector(
            this.stores.fsEntry,
            { path: parentPath },
            entry.userId,
        );
        return parent;
    }

    async #multipartWrite(
        req: Request,
        userId: number,
        targetPath: string,
    ): Promise<{ fsEntry: import('../../stores/fs/FSEntry.js').FSEntry }> {
        // Parse the first `file` part via busboy and stream it into write.
        const { Readable: NodeReadable } = await import('node:stream');
        return new Promise((resolve, reject) => {
            const bb = Busboy({ headers: req.headers });
            let dispatched = false;
            let writePromise: Promise<unknown> | null = null;
            let size = 0;

            bb.on('field', () => {
                // Fields are ignored — only the file stream matters here.
            });
            bb.on('file', (_fieldName, fileStream, info) => {
                if (dispatched) {
                    fileStream.resume();
                    return;
                }
                dispatched = true;
                const passthrough = new NodeReadable({
                    read() {
                        // no-op; data pushed from the busboy file stream.
                    },
                });
                fileStream.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    passthrough.push(chunk);
                });
                fileStream.on('end', () => passthrough.push(null));
                fileStream.on('error', (err: Error) =>
                    passthrough.destroy(err),
                );

                const contentType =
                    info && typeof info.mimeType === 'string'
                        ? info.mimeType
                        : undefined;
                writePromise = this.services.fs
                    .write(userId, {
                        fileMetadata: {
                            path: targetPath,
                            size: 0, // real size accumulates as stream drains
                            ...(contentType ? { contentType } : {}),
                            overwrite: true,
                        },
                        fileContent: passthrough,
                    })
                    .then((response) => {
                        resolve({ fsEntry: response.fsEntry });
                    })
                    .catch(reject);
            });
            bb.on('close', () => {
                if (!dispatched) {
                    reject(new HttpError(400, 'No file uploaded'));
                    return;
                }
                if (!writePromise) {
                    reject(new HttpError(500, 'Write did not dispatch'));
                }
                // size is logged only; fsService.write handles quota/size.
                void size;
            });
            bb.on('error', (err) => reject(err));
            req.pipe(bb);
        });
    }

    // ── Batch route ─────────────────────────────────────────────────────
    //
    // `/batch` interleaves multipart JSON operations with optional file
    // uploads. puter-js uses it for `write`, `shortcut`, `mkdir`, `move`,
    // `delete`, and `symlink` — `write` ops are paired with `file` blob
    // parts (by `item_upload_id`, then fallback position) and matching
    // `fileinfo` JSON.
    //
    // File bodies are buffered in memory per op; large uploads should go
    // through the signed `/writeFile` endpoint instead, which streams.
    // The wire shape (multipart/form-data) is preserved for client
    // compatibility. Unknown op-types are rejected per-op.

    batch = async (req: Request, res: Response): Promise<void> => {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const actor = req.actor!;
        const username = actor.user?.username;
        const contentType =
            typeof req.headers['content-type'] === 'string'
                ? req.headers['content-type']
                : '';

        // Parse the request. We support both multipart/form-data (the
        // canonical client shape) and JSON bodies (handy for ad-hoc
        // callers / tests).
        const parsed = contentType.includes('multipart/form-data')
            ? await this.#parseMultipartBatch(req)
            : { ops: this.#parseJsonBatch(req), files: [], fileinfos: [] };
        const { ops: operationSpecs, files, fileinfos } = parsed;

        const results: unknown[] = [];
        let hasError = false;
        let sequentialFileIdx = 0;

        for (const spec of operationSpecs) {
            try {
                const record = asRecord(spec);
                const op = typeof record.op === 'string' ? record.op : '';
                let shaped: unknown;

                if (op === 'write') {
                    // Pair with a file part — prefer `item_upload_id`
                    // index (what puter-js sets), fall back to the op's
                    // order among write ops for safety.
                    const uploadIdRaw = record.item_upload_id;
                    let fileIdx =
                        typeof uploadIdRaw === 'number'
                            ? uploadIdRaw
                            : typeof uploadIdRaw === 'string' &&
                                /^\d+$/.test(uploadIdRaw)
                              ? Number(uploadIdRaw)
                              : sequentialFileIdx;
                    if (fileIdx >= files.length) fileIdx = sequentialFileIdx;
                    sequentialFileIdx += 1;
                    const filePart = files[fileIdx];
                    if (!filePart) {
                        throw new HttpError(
                            400,
                            `write op has no paired file (item_upload_id=${uploadIdRaw})`,
                        );
                    }
                    const fileInfo = fileinfos[fileIdx] ?? {};
                    const name =
                        getString(record, 'name') ??
                        (typeof fileInfo.name === 'string'
                            ? fileInfo.name
                            : undefined);
                    if (!name) {
                        throw new HttpError(400, 'write op missing `name`');
                    }
                    const parentPath = getString(record, 'path') ?? '';
                    const expandedParent = this.#expandTilde(
                        parentPath,
                        username,
                    );
                    const targetPath =
                        expandedParent && expandedParent !== '/'
                            ? `${expandedParent.replace(/\/+$/, '')}/${name}`
                            : `/${name}`;
                    const dedupeName =
                        getBoolean(record, 'dedupe_name') ?? true;
                    const overwrite = getBoolean(record, 'overwrite') ?? false;
                    const createMissingParents =
                        getBoolean(
                            record,
                            'create_missing_ancestors',
                            'create_missing_parents',
                        ) ?? false;
                    const writeContentType =
                        typeof fileInfo.type === 'string'
                            ? fileInfo.type
                            : filePart.mimeType;
                    const response = await this.services.fs.write(userId, {
                        fileMetadata: {
                            path: targetPath,
                            size: filePart.content.length,
                            ...(writeContentType
                                ? { contentType: writeContentType }
                                : {}),
                            overwrite,
                            dedupeName,
                            createMissingParents,
                        },
                        fileContent: filePart.content,
                    });
                    await this.#emitGuiEvent(
                        'outer.gui.item.added',
                        response.fsEntry,
                    );
                    shaped = await toLegacyEntry(
                        this.clients.event,
                        response.fsEntry,
                    );
                } else if (op === 'mkdir') {
                    const parentPath = getString(record, 'path') ?? '';
                    const name = getString(record, 'name');
                    if (!name) {
                        throw new HttpError(400, 'mkdir op missing `name`');
                    }
                    const expandedParent = this.#expandTilde(
                        parentPath,
                        username,
                    );
                    const targetPath =
                        expandedParent && expandedParent !== '/'
                            ? `${expandedParent.replace(/\/+$/, '')}/${name}`
                            : `/${name}`;
                    const entry = await this.services.fs.mkdir(userId, {
                        path: targetPath,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? true,
                        createMissingParents:
                            getBoolean(
                                record,
                                'create_missing_ancestors',
                                'create_missing_parents',
                            ) ?? false,
                    });
                    await this.#emitGuiEvent('outer.gui.item.added', entry);
                    shaped = await toLegacyEntry(this.clients.event, entry);
                } else if (op === 'shortcut') {
                    const parentPath = getString(record, 'path') ?? '';
                    const name = getString(record, 'name');
                    const shortcutToUid =
                        getString(record, 'shortcut_to_uid') ??
                        getString(record, 'shortcut_to');
                    if (!name) {
                        throw new HttpError(400, 'shortcut op missing `name`');
                    }
                    if (!shortcutToUid) {
                        throw new HttpError(
                            400,
                            'shortcut op missing `shortcut_to_uid`',
                        );
                    }
                    const target = await resolveV1Selector(
                        this.stores.fsEntry,
                        { uid: shortcutToUid },
                        userId,
                    );
                    const expandedParent = this.#expandTilde(
                        parentPath,
                        username,
                    );
                    const parent = await resolveV1Selector(
                        this.stores.fsEntry,
                        { path: expandedParent || '/' },
                        userId,
                    );
                    const link = await this.services.fs.mkshortcut(userId, {
                        parent,
                        name,
                        target,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? true,
                    });
                    await this.#emitGuiEvent('outer.gui.item.added', link);
                    shaped = await toLegacyEntry(this.clients.event, link);
                } else if (op === 'move') {
                    const source = await resolveV1Selector(
                        this.stores.fsEntry,
                        record.source,
                        userId,
                    );
                    const destinationParent = await resolveV1Selector(
                        this.stores.fsEntry,
                        record.destination,
                        userId,
                    );
                    await assertAccess(
                        this.services.acl,
                        this.services.fs,
                        actor,
                        source.path,
                        'write',
                    );
                    await assertAccess(
                        this.services.acl,
                        this.services.fs,
                        actor,
                        destinationParent.path,
                        'write',
                    );
                    const moved = await this.services.fs.move(userId, {
                        source,
                        destinationParent,
                        newName: getString(record, 'new_name'),
                        overwrite: getBoolean(record, 'overwrite') ?? false,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? false,
                    });
                    await this.#emitGuiEvent('outer.gui.item.moved', moved, {
                        old_path: source.path,
                    });
                    shaped = await toLegacyEntry(this.clients.event, moved);
                } else if (op === 'delete') {
                    const entry = await resolveV1Selector(
                        this.stores.fsEntry,
                        getString(record, 'path') ?? record,
                        userId,
                    );
                    await assertAccess(
                        this.services.acl,
                        this.services.fs,
                        actor,
                        entry.path,
                        'write',
                    );
                    const descendantsOnly =
                        getBoolean(record, 'descendants_only') ?? false;
                    await this.services.fs.remove(userId, {
                        entry,
                        recursive: getBoolean(record, 'recursive') ?? true,
                        descendantsOnly,
                    });
                    await this.#emitGuiEvent('outer.gui.item.removed', entry, {
                        descendants_only: descendantsOnly,
                    });
                    shaped = { ok: true, uid: entry.uuid };
                } else {
                    throw new HttpError(400, `Unsupported batch op: '${op}'`);
                }
                results.push(shaped);
            } catch (err) {
                hasError = true;
                results.push(this.#serializeBatchError(err));
            }
        }

        res.status(hasError ? 218 : 200).json({ results });
    };

    async #parseMultipartBatch(req: Request): Promise<{
        ops: unknown[];
        files: Array<{ content: Buffer; mimeType?: string; filename?: string }>;
        fileinfos: Array<Record<string, unknown>>;
    }> {
        return new Promise((resolve, reject) => {
            const ops: unknown[] = [];
            const files: Array<{
                content: Buffer;
                mimeType?: string;
                filename?: string;
            }> = [];
            const fileinfos: Array<Record<string, unknown>> = [];
            let parseError: Error | null = null;
            const bb = Busboy({ headers: req.headers });

            bb.on('field', (fieldName, value) => {
                try {
                    if (fieldName === 'operation') {
                        ops.push(JSON.parse(value));
                    } else if (fieldName === 'fileinfo') {
                        const parsed = JSON.parse(value);
                        fileinfos.push(
                            parsed && typeof parsed === 'object'
                                ? (parsed as Record<string, unknown>)
                                : {},
                        );
                    }
                    // Ignore operation_id / socket_id / misc fields — not
                    // needed for v2 batch semantics.
                } catch (err) {
                    parseError =
                        err instanceof Error ? err : new Error(String(err));
                }
            });

            // Buffer file parts into memory so batched writes can be
            // processed in any order relative to the operation specs.
            // For streaming uploads use the signed `/writeFile` endpoint.
            bb.on('file', (_fieldName, stream, info) => {
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => {
                    files.push({
                        content: Buffer.concat(chunks),
                        mimeType:
                            info && typeof info.mimeType === 'string'
                                ? info.mimeType
                                : undefined,
                        filename:
                            info && typeof info.filename === 'string'
                                ? info.filename
                                : undefined,
                    });
                });
                stream.on('error', (err: Error) => {
                    parseError = err;
                });
            });

            bb.on('close', () => {
                if (parseError) reject(parseError);
                else resolve({ ops, files, fileinfos });
            });
            bb.on('error', (err) => reject(err));

            req.pipe(bb);
        });
    }

    #parseJsonBatch(req: Request): unknown[] {
        const body = asRecord(req.body);
        if (Array.isArray(body.operations)) return body.operations;
        if (Array.isArray(body.ops)) return body.ops;
        return [];
    }

    #expandTilde(path: string, username: string | undefined): string {
        if (!path) return path;
        if (path !== '~' && !path.startsWith('~/')) return path;
        if (!username) throw new HttpError(400, 'Unable to resolve home path');
        return `/${username}${path.slice(1)}`;
    }

    #serializeBatchError(err: unknown): Record<string, unknown> {
        if (err instanceof HttpError) {
            return {
                error: true,
                status: err.statusCode,
                message: err.message,
                code: err.legacyCode ?? err.code,
            };
        }
        if (err instanceof Error) {
            return { error: true, status: 500, message: err.message };
        }
        return { error: true, status: 500, message: 'Unknown batch error' };
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    #parsePositiveIntegerQuery(
        query: Record<string, unknown>,
        key: string,
        message: string,
    ): number | undefined {
        const value = query[key];
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new HttpError(400, message);
        }
        return parsed;
    }

    #parseNonNegativeIntegerQuery(
        query: Record<string, unknown>,
        key: string,
        message: string,
    ): number | undefined {
        const value = query[key];
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new HttpError(400, message);
        }
        return parsed;
    }

    #normalizeRangeHeader(rangeHeader: string): string | undefined {
        const firstRange = rangeHeader.includes(',')
            ? rangeHeader.split(',')[0]?.trim()
            : rangeHeader.trim();
        if (!firstRange) return undefined;

        const matches = firstRange.match(/^bytes=(\d+)-(\d*)$/);
        if (!matches) return undefined;

        const [, start, end] = matches;
        return end ? `bytes=${start}-${end}` : `bytes=${start}-`;
    }

    #pipeLimitedLines(
        source: NodeJS.ReadableStream,
        res: Response,
        lineCount: number,
    ): void {
        let remainingLines = lineCount;
        let isClosed = false;

        const closeSource = () => {
            if (isClosed) return;
            isClosed = true;
            if ('destroy' in source && typeof source.destroy === 'function') {
                source.destroy();
            }
        };

        source.on('error', (err) => {
            if (!isClosed) {
                isClosed = true;
                res.destroy(err);
            }
        });

        res.on('close', () => {
            closeSource();
        });

        source.on('data', (chunk: Buffer | string) => {
            if (isClosed) return;

            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            let endIndex = buffer.length;

            for (let index = 0; index < buffer.length; index++) {
                if (buffer[index] !== 0x0a) continue;
                remainingLines -= 1;
                if (remainingLines === 0) {
                    endIndex = index + 1;
                    break;
                }
            }

            if (endIndex > 0) {
                const canContinue = res.write(buffer.subarray(0, endIndex));
                if (!canContinue) {
                    source.pause();
                    res.once('drain', () => {
                        if (!isClosed) {
                            source.resume();
                        }
                    });
                }
            }

            if (endIndex !== buffer.length) {
                res.end();
                closeSource();
            }
        });

        source.on('end', () => {
            if (!isClosed) {
                isClosed = true;
                res.end();
            }
        });
    }

    #requireActor(req: Request) {
        const actor = req.actor;
        if (!actor) {
            throw new HttpError(401, 'Unauthorized');
        }
        return actor;
    }

    #getActorUserId(req: Request): number {
        const requestUser = (req as Request & { user?: { id?: unknown } }).user;
        const actorUser = req.actor?.user;
        const candidate = requestUser?.id ?? actorUser?.id;
        if (candidate === undefined || candidate === null) {
            throw new HttpError(401, 'Unauthorized');
        }
        const numeric = Number(candidate);
        if (Number.isNaN(numeric)) throw new HttpError(401, 'Unauthorized');
        return numeric;
    }

    #isRootPathRef(body: Record<string, unknown>): boolean {
        if (body.uid !== undefined || body.uuid !== undefined) return false;
        if (body.id !== undefined) return false;
        if (body.parent !== undefined) return false;
        const path = body.path;
        if (typeof path !== 'string') return false;
        return path.trim() === '/';
    }

    #parseSortBy(
        body: Record<string, unknown>,
    ): 'name' | 'modified' | 'type' | 'size' | null {
        const raw = getString(body, 'sort_by');
        if (!raw) return null;
        const normalized = raw.toLowerCase();
        return (
            (['name', 'modified', 'type', 'size'] as const).find(
                (v) => v === normalized,
            ) ?? null
        );
    }

    #parseSortOrder(body: Record<string, unknown>): 'asc' | 'desc' | null {
        const raw = getString(body, 'sort_order');
        if (!raw) return null;
        const normalized = raw.toLowerCase();
        return (['asc', 'desc'] as const).find((v) => v === normalized) ?? null;
    }

    // Reserved escape hatch for lazy-loading auxiliary route handlers.
    #createLazyHandler(
        key: string,
        cache: RouterCache,
        loader: (key: string) => Promise<RequestHandler | null>,
    ): RequestHandler {
        return async (req, res, next) => {
            let handler = cache.get(key);
            if (handler === undefined) {
                handler = await loader(key);
                cache.set(key, handler);
            }
            if (!handler) {
                next();
                return;
            }
            handler(req, res, next);
        };
    }
}
