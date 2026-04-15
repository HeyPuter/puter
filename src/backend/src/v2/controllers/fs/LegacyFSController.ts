import type { Request, RequestHandler, Response } from 'express';
import Busboy from 'busboy';
import { posix as pathPosix } from 'node:path';
import { PuterController } from '../types.js';
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
 * Legacy v1 FS routes, re-implemented as thin shims over v2 `FSEntryService`.
 *
 * Each shim parses the v1 request shape (FSNodeParam-style `{ path, uid, id }`
 * or `{ parent, name }`), invokes the v2 service method, and returns the
 * snake_case response v1 clients expect. No v1 runtime context required.
 *
 * Some auxiliary routes (writeFile, open_item, itemMetadata, down, file,
 * sign, suggest_apps, df, set_layout, set_sort_by) still load from v1 via
 * dynamic import — they'll be migrated in follow-up work.
 */

// ── Auxiliary routes still delegated to v1 via dynamic import ──────────

type RouterCache = Map<string, RequestHandler | null>;

// All v1 FS routes now have v2 replacements. `suggest_apps` returns an
// empty array until a v2 SuggestedAppsService is written (tracked in the
// post-FS-migration audit).
const additionalRoutePaths: Record<string, string> = {};

async function loadAdditionalRouter (key: string): Promise<RequestHandler | null> {
    const path = additionalRoutePaths[key];
    if ( ! path ) return null;
    try {
        const mod = await import(path);
        return (mod.default ?? mod) as RequestHandler;
    } catch ( err ) {
        console.error(`[legacy-fs] failed to load additional route module '${key}':`, err);
        return null;
    }
}

// ── Controller ──────────────────────────────────────────────────────

export class LegacyFSController extends PuterController {
    #additionalCache: RouterCache = new Map();

    registerRoutes (router: PuterRouter): void {
        const apiOptions = { subdomain: 'api' } as const;

        // Core v1 filesystem_api routes — direct handlers over v2 service.
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
        router.get('/token-read', apiOptions, this.read);

        router.post('/batch', apiOptions, this.batch);

        // Signed-URL + meta routes.
        router.post('/sign', apiOptions, this.sign);
        router.post('/writeFile', apiOptions, this.writeFile);
        router.get('/file', apiOptions, this.file);
        router.all('/df', apiOptions, this.df);
        router.post('/open_item', apiOptions, this.openItem);
        router.post('/auth/request-app-root-dir', apiOptions, this.requestAppRootDir);
        router.post('/auth/check-app-acl', apiOptions, this.checkAppAcl);

        // Redirect /down → /file?download=true to consolidate download paths.
        router.post('/down', apiOptions, this.redirectToFile);
        // /itemMetadata was buggy in v1 (MIME from undefined field) and not
        // called by puter-js. Return 410 Gone rather than resurrecting the bug.
        router.get('/itemMetadata', apiOptions, (_req, res) => {
            res.status(410).json({ error: 'itemMetadata is deprecated; use /fs/stat' });
        });

        // /get-launch-apps returns an empty shape until recommended-apps
        // and app-icon services are ported to v2. UI clients tolerate
        // empty arrays gracefully.
        router.get('/get-launch-apps', apiOptions, (_req, res) => {
            res.json({ recommended: [], recent: [] });
        });

        // /suggest_apps returns `[]` until a v2 SuggestedAppsService lands.
        router.post('/suggest_apps', apiOptions, (_req, res) => {
            res.json([]);
        });

        // puter-js polls this to decide whether to purge its in-memory FS
        // cache. SocketService bumps a per-user Redis key on every
        // `outer.gui.item.*` mutation — read it back here.
        router.get('/cache/last-change-timestamp', apiOptions, async (req, res) => {
            const userId = req.actor?.user?.id;
            if ( ! userId ) {
                res.json({ timestamp: 0 });
                return;
            }
            const socket = this.services.socket as unknown as { getLastChangeTimestamp?: (id: number) => Promise<number> } | undefined;
            const timestamp = socket?.getLastChangeTimestamp ? await socket.getLastChangeTimestamp(userId) : 0;
            res.json({ timestamp });
        });

        // Remaining v1 routes still delegated to legacy modules.
        for ( const key of Object.keys(additionalRoutePaths) ) {
            router.use(this.#createLazyHandler(key, this.#additionalCache, loadAdditionalRouter));
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

        const entry = await resolveV1Selector(this.stores.fsEntry, body, userId);
        await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'see');

        const shaped = await toLegacyEntry(this.clients.event, entry);

        // Optional hydrations matching v1 HLStat:
        if ( entry.isDir && getBoolean(body, 'return_size') ) {
            shaped.size = await this.services.fsEntry.getSubtreeSize(userId, entry.path);
        }
        if ( getBoolean(body, 'return_subdomains') ) {
            shaped.subdomains = await this.#listSubdomainsForEntry(entry.uuid);
        }
        // Legacy clients sometimes ask for `return_versions`, `return_owner`,
        // `return_shares`. We don't have parity for these yet — return empty
        // arrays/null to avoid breaking `response.x.forEach(...)` patterns.
        if ( getBoolean(body, 'return_versions') ) shaped.versions = [];
        if ( getBoolean(body, 'return_shares') ) shaped.shares = [];
        if ( getBoolean(body, 'return_owner') ) shaped.owner = { user_id: entry.userId };

        res.json(shaped);
    };

    readdir = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const parent = await resolveV1Selector(this.stores.fsEntry, body, userId);
        if ( ! parent.isDir ) {
            throw new HttpError(400, 'Target is not a directory');
        }
        await assertAccess(this.services.acl, this.services.fsEntry, actor, parent.path, 'list');

        const children = await this.services.fsEntry.listDirectory(parent.uuid, {
            sortBy: this.#parseSortBy(body),
            sortOrder: this.#parseSortOrder(body),
        });

        const shaped = await Promise.all(children.map((c) => toLegacyEntry(this.clients.event, c)));
        res.json(shaped);
    };

    mkdir = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const rawPath = getString(body, 'path');
        if ( ! rawPath ) throw new HttpError(400, '`path` is required');

        // v1 supports `{ parent, path }` where `path` is a relative suffix.
        let targetPath = rawPath;
        if ( body.parent !== undefined && !rawPath.startsWith('/') ) {
            const parent = await resolveV1Selector(this.stores.fsEntry, body.parent, userId);
            targetPath = parent.path === '/' ? `/${rawPath}` : `${parent.path}/${rawPath}`;
        }

        const parentPath = pathPosix.dirname(targetPath.startsWith('/') ? targetPath : `/${targetPath}`);
        await assertAccess(
            this.services.acl,
            this.services.fsEntry,
            actor,
            parentPath === '/' ? targetPath : parentPath,
            'write',
        );

        const entry = await this.services.fsEntry.mkdir(userId, {
            path: targetPath,
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
            createMissingParents: getBoolean(body, 'create_missing_parents', 'create_missing_ancestors') ?? false,
        });

        res.json(await toLegacyEntry(this.clients.event, entry));
    };

    copy = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const source = await resolveV1Selector(this.stores.fsEntry, body.source, userId);
        const destinationParent = await resolveV1Selector(this.stores.fsEntry, body.destination, userId);

        await assertAccess(this.services.acl, this.services.fsEntry, actor, source.path, 'read');
        await assertAccess(this.services.acl, this.services.fsEntry, actor, destinationParent.path, 'write');

        const copy = await this.services.fsEntry.copy(userId, {
            source,
            destinationParent,
            newName: getString(body, 'new_name'),
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
        });

        // v1 /copy returns an array (historically supported bulk copies).
        res.json([await toLegacyEntry(this.clients.event, copy)]);
    };

    move = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const source = await resolveV1Selector(this.stores.fsEntry, body.source, userId);
        const destinationParent = await resolveV1Selector(this.stores.fsEntry, body.destination, userId);

        await assertAccess(this.services.acl, this.services.fsEntry, actor, source.path, 'write');
        await assertAccess(this.services.acl, this.services.fsEntry, actor, destinationParent.path, 'write');

        const moved = await this.services.fsEntry.move(userId, {
            source,
            destinationParent,
            newName: getString(body, 'new_name'),
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
        });

        res.json(await toLegacyEntry(this.clients.event, moved));
    };

    delete = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        // v1 /delete can take `paths: []` for bulk delete, or a single selector.
        const pathsArray = Array.isArray(body.paths) ? body.paths : null;
        if ( pathsArray ) {
            const removedEntries: unknown[] = [];
            for ( const raw of pathsArray ) {
                const entry = await resolveV1Selector(this.stores.fsEntry, raw, userId);
                await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'write');
                await this.services.fsEntry.remove(userId, {
                    entry,
                    recursive: getBoolean(body, 'recursive') ?? true,
                    descendantsOnly: getBoolean(body, 'descendants_only') ?? false,
                });
                removedEntries.push(await toLegacyEntry(this.clients.event, entry));
            }
            res.json(removedEntries);
            return;
        }

        const entry = await resolveV1Selector(this.stores.fsEntry, body, userId);
        await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'write');
        await this.services.fsEntry.remove(userId, {
            entry,
            recursive: getBoolean(body, 'recursive') ?? true,
            descendantsOnly: getBoolean(body, 'descendants_only') ?? false,
        });
        res.json({ ok: true, uid: entry.uuid });
    };

    rename = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const newName = getString(body, 'new_name');
        if ( ! newName ) throw new HttpError(400, '`new_name` is required');

        const entry = await resolveV1Selector(this.stores.fsEntry, body, userId);
        await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'write');

        const renamed = await this.services.fsEntry.rename(entry, newName);
        res.json(await toLegacyEntry(this.clients.event, renamed));
    };

    touch = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const rawPath = getString(body, 'path');
        if ( ! rawPath ) throw new HttpError(400, '`path` is required');

        const parentPath = pathPosix.dirname(rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
        if ( parentPath === '/' ) {
            throw new HttpError(400, 'Cannot touch in root');
        }
        await assertAccess(this.services.acl, this.services.fsEntry, actor, parentPath, 'write');

        await this.services.fsEntry.touch(userId, {
            path: rawPath,
            setAccessed: getBoolean(body, 'set_accessed_to_now') ?? false,
            setModified: getBoolean(body, 'set_modified_to_now') ?? false,
            setCreated: getBoolean(body, 'set_created_to_now') ?? false,
            createMissingParents: getBoolean(body, 'create_missing_parents') ?? false,
        });
        // v1 /touch historically returns an empty body.
        res.send('');
    };

    search = async (req: Request, res: Response): Promise<void> => {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const query = getString(body, 'query', 'text') ?? '';
        if ( query.trim().length === 0 ) throw new HttpError(400, '`query` is required');

        const results = await this.services.fsEntry.searchByName(userId, query, 200);
        const shaped = await Promise.all(results.map((r) => toLegacyEntry(this.clients.event, r)));
        res.json(shaped);
    };

    read = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const query = asRecord(req.query);

        const entry = await resolveV1Selector(this.stores.fsEntry, query, userId);
        await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'read');

        if ( entry.isDir ) {
            throw new HttpError(400, 'Cannot read a directory');
        }

        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        const download = await this.services.fsEntry.readContent(entry, { range });

        if ( download.contentType ) res.setHeader('Content-Type', download.contentType);
        if ( download.contentLength !== null ) res.setHeader('Content-Length', String(download.contentLength));
        if ( download.contentRange ) res.setHeader('Content-Range', download.contentRange);
        if ( download.etag ) res.setHeader('ETag', download.etag);
        if ( download.lastModified ) res.setHeader('Last-Modified', download.lastModified.toUTCString());
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(entry.name)}"`);
        res.status(range ? 206 : 200);

        // Best-effort egress metering, matching v1 LLRead behaviour.
        const metering = this.services.metering as {
            batchIncrementUsages?: (actor: unknown, entries: unknown[]) => void;
        } | undefined;
        if ( metering?.batchIncrementUsages && download.contentLength ) {
            download.body.once('end', () => {
                try {
                    metering.batchIncrementUsages!(actor, [{
                        usageType: 'filesystem:egress:bytes',
                        usageAmount: download.contentLength!,
                    }]);
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

    // ── Signed-URL + meta routes ────────────────────────────────────────

    /**
     * POST /sign
     * Body: `{ items: [{ uid?, path?, action }], app_uid? }`. Returns v1-shape
     * `{ signatures: [...], token? }`. Apps may only sign files under their
     * own AppData subtree (matches v1).
     */
    sign = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const items = Array.isArray(body.items) ? body.items : [];
        if ( items.length === 0 ) throw new HttpError(400, '`items` is required');

        const isApp = Boolean((actor as { app?: unknown }).app);
        const signingCfg = signingConfigFromAppConfig(this.config);

        // Apps can only sign inside their AppData root.
        let appDataRoot: string | null = null;
        if ( isApp ) {
            const username = (actor as { user?: { username?: string } }).user?.username;
            const appUid = (actor as { app?: { uid?: string } }).app?.uid;
            if ( !username || !appUid ) throw new HttpError(403, 'Forbidden');
            appDataRoot = `/${username}/AppData/${appUid}`;
        }

        type SignedOrEmpty = SignedFile & { path?: string } | Record<string, never>;
        const result: { signatures: SignedOrEmpty[]; token?: string } = { signatures: [] };

        // Optional app grant (v1: provide app_uid to grant permissions + token).
        let grantApp: { uid: string } | null = null;
        if ( typeof body.app_uid === 'string' && body.app_uid.length > 0 ) {
            const app = await this.stores.app.getByUid(body.app_uid);
            if ( ! app ) throw new HttpError(404, 'App not found');
            grantApp = { uid: app.uid };
            result.token = this.services.auth.getUserAppToken(actor, app.uid);
        }

        for ( const rawItem of items ) {
            const item = asRecord(rawItem);
            const uid = typeof item.uid === 'string' ? item.uid : undefined;
            const path = typeof item.path === 'string' ? item.path : undefined;
            const action = typeof item.action === 'string' ? item.action : 'read';
            if ( !uid && !path ) {
                result.signatures.push({});
                continue;
            }
            try {
                const entry = await resolveV1Selector(this.stores.fsEntry, { uid, path }, userId);

                // App-sandbox check.
                const withinAppRoot = appDataRoot
                    ? entry.path === appDataRoot || entry.path.startsWith(`${appDataRoot}/`)
                    : true;
                if ( ! withinAppRoot ) {
                    throw new HttpError(403, 'Forbidden');
                }

                // ACL: always require read; downgrade write→read silently.
                await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'read');
                let finalAction: 'read' | 'write' = 'read';
                if ( action === 'write' ) {
                    const writeOk = await this.services.acl.check(actor, {
                        path: entry.path,
                        resolveAncestors: () => this.services.fsEntry.getAncestorChain(entry.path),
                    }, 'write');
                    finalAction = writeOk ? 'write' : 'read';
                }

                if ( grantApp ) {
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
                // v1 silently skips unresolvable items.
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
            { uid: query.uid as string, expires: query.expires as string, signature: query.signature as string },
            'write',
            signingCfg,
        );

        const uid = typeof query.uid === 'string' ? query.uid : '';
        const targetEntry = await resolveV1Selector(this.stores.fsEntry, { uid }, NaN);
        if ( ! targetEntry ) throw new HttpError(404, 'Item not found');

        // Owner suspension check.
        const owner = await this.stores.user.getById(targetEntry.userId);
        if ( ! owner ) throw new HttpError(500, 'Owner not found');
        if ( (owner as { suspended?: unknown }).suspended ) throw new HttpError(401, 'Account suspended');

        const userId = targetEntry.userId;
        const operation = typeof query.operation === 'string' ? query.operation : 'write';

        // `write` — multipart upload, streamed directly to the v2 write path.
        if ( operation === 'write' ) {
            const body = asRecord(req.body);
            const parentEntry = targetEntry.isDir
                ? targetEntry
                : await this.#resolveParentOfEntry(targetEntry);
            const name = typeof body.name === 'string' ? body.name
                : (targetEntry.isDir ? `upload-${Date.now()}` : targetEntry.name);
            const targetPath = parentEntry.path === '/' ? `/${name}` : `${parentEntry.path}/${name}`;

            // Parse multipart and pipe the first `file` part into fsEntryService.write.
            const uploadResult = await this.#multipartWrite(req, userId, targetPath);
            const signed = signEntry(uploadResult.fsEntry, signingCfg);
            res.json({ ...signed, path: uploadResult.fsEntry.path });
            return;
        }

        // Non-write operations: route to existing service methods and sign the result.
        const record = asRecord(req.body);
        if ( operation === 'mkdir' ) {
            const folderName = typeof record.name === 'string' ? record.name : `folder-${Date.now()}`;
            const entry = await this.services.fsEntry.mkdir(userId, {
                path: targetEntry.isDir
                    ? `${targetEntry.path === '/' ? '' : targetEntry.path}/${folderName}`
                    : targetEntry.path,
                dedupeName: true,
            });
            res.json({ ...signEntry(entry, signingCfg), path: entry.path });
            return;
        }
        if ( operation === 'rename' ) {
            const newName = typeof record.new_name === 'string' ? record.new_name : '';
            if ( ! newName ) throw new HttpError(400, '`new_name` required');
            const renamed = await this.services.fsEntry.rename(targetEntry, newName);
            res.json({ ...signEntry(renamed, signingCfg), path: renamed.path });
            return;
        }
        if ( operation === 'delete' || operation === 'trash' ) {
            // Trash is just a "move to /Trash" in v1. For v2 we treat trash ==
            // delete (recursive). If a trash folder becomes important we can
            // revisit — most clients just call delete directly.
            await this.services.fsEntry.remove(userId, { entry: targetEntry, recursive: true });
            res.json({ ok: true, uid: targetEntry.uuid });
            return;
        }
        if ( operation === 'copy' || operation === 'move' ) {
            const destRef = record.destination ?? record.destination_uid ?? record.dest_path;
            if ( ! destRef ) throw new HttpError(400, '`destination` required');
            const destinationParent = await resolveV1Selector(this.stores.fsEntry, destRef, userId);
            const method = operation === 'copy' ? 'copy' : 'move';
            const result = await this.services.fsEntry[method](userId, {
                source: targetEntry,
                destinationParent,
                newName: typeof record.new_name === 'string' ? record.new_name : undefined,
                overwrite: getBoolean(record, 'overwrite') ?? false,
                dedupeName: getBoolean(record, 'dedupe_name') ?? false,
            });
            res.json({ ...signEntry(result, signingCfg), path: result.path });
            return;
        }

        throw new HttpError(400, `Unsupported writeFile operation: '${operation}'`);
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
            { uid: query.uid as string, expires: query.expires as string, signature: query.signature as string },
            'read',
            signingCfg,
        );

        const uid = typeof query.uid === 'string' ? query.uid : '';
        const entry = await resolveV1Selector(this.stores.fsEntry, { uid }, NaN);

        // Directory: return a signed listing of direct children.
        if ( entry.isDir ) {
            const children = await this.services.fsEntry.listDirectory(entry.uuid);
            const signedChildren = children.map((child) => ({
                ...signEntry(child, signingCfg),
                path: child.path,
            }));
            res.json(signedChildren);
            return;
        }

        // File: stream bytes. Range supported.
        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        const download = await this.services.fsEntry.readContent(entry, { range });
        const wantsAttachment = query.download === 'true' || query.download === '1' || query.download === true;

        if ( download.contentType ) res.setHeader('Content-Type', download.contentType);
        if ( download.contentLength !== null ) res.setHeader('Content-Length', String(download.contentLength));
        if ( download.contentRange ) res.setHeader('Content-Range', download.contentRange);
        if ( download.etag ) res.setHeader('ETag', download.etag);
        if ( download.lastModified ) res.setHeader('Last-Modified', download.lastModified.toUTCString());
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
        const allowance = await this.services.fsEntry.getUsersStorageAllowance(userId);
        res.json({
            used: allowance.curr,
            capacity: allowance.max,
        });
    };

    /**
     * POST /open_item — resolve an entry and return a signed URL + token for
     * an app to open the file. Since v2 does not yet have a suggested-apps
     * service, `suggested_apps` is returned as `[]`.
     */
    openItem = async (req: Request, res: Response): Promise<void> => {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const entry = await resolveV1Selector(this.stores.fsEntry, body, userId);

        await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'read');

        const signingCfg = signingConfigFromAppConfig(this.config);
        const signature = { ...signEntry(entry, signingCfg), path: entry.path };
        res.json({
            signature,
            token: null,
            suggested_apps: [], // suggested-apps service not yet ported; clients usually fall back gracefully
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
        if ( ! appUid ) throw new HttpError(400, '`app_uid` is required');

        const actorApp = (actor as { app?: { uid?: string } }).app;
        if ( !actorApp?.uid || actorApp.uid !== appUid ) {
            throw new HttpError(403, 'Only the app itself may request its root dir');
        }
        const userId = this.#getActorUserId(req);
        const username = (actor as { user?: { username?: string } }).user?.username;
        if ( ! username ) throw new HttpError(401, 'Unauthorized');

        const rootPath = `/${username}/AppData/${appUid}`;
        // Auto-create the AppData/<uid> tree on first call (matches v1 behaviour).
        const entry = await this.services.fsEntry.mkdir(userId, {
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
        const mode = (getString(body, 'mode') ?? 'read') as 'see' | 'list' | 'read' | 'write';
        if ( !subjectRef || !appRef ) throw new HttpError(400, '`subject` and `app` are required');

        const subject = await resolveV1Selector(this.stores.fsEntry, subjectRef, userId);
        let app: { uid: string } | null = null;
        if ( typeof appRef === 'string' ) {
            app = (await this.stores.app.getByUid(appRef)) ?? (await this.stores.app.getByName(appRef));
        }
        if ( ! app ) throw new HttpError(404, 'App not found');

        // Build an actor-under-user shape for the check.
        const actorForApp = {
            user: (req.actor as { user?: unknown }).user,
            app: { uid: (app as { uid: string }).uid },
        } as unknown as Actor;
        const descriptor = {
            path: subject.path,
            resolveAncestors: () => this.services.fsEntry.getAncestorChain(subject.path),
        };
        const allowed = await (this.services.acl as ACLService).check(actorForApp, descriptor, mode);
        res.json({ allowed });
    };

    /** POST /down → same semantics as GET /file with `download=true`. */
    redirectToFile = async (req: Request, res: Response): Promise<void> => {
        // We call the /file handler inline, coercing query to include
        // `download=true` so Content-Disposition becomes `attachment`.
        (req.query as Record<string, unknown>).download = 'true';
        await this.file(req, res);
    };

    // Helpers for writeFile
    async #resolveParentOfEntry (entry: { path: string; userId: number }) {
        const parentPath = pathPosix.dirname(entry.path);
        const parent = await resolveV1Selector(this.stores.fsEntry, { path: parentPath }, entry.userId);
        return parent;
    }

    async #multipartWrite (req: Request, userId: number, targetPath: string): Promise<{ fsEntry: import('../../stores/fs/FSEntry.js').FSEntry }> {
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
                if ( dispatched ) {
                    fileStream.resume();
                    return;
                }
                dispatched = true;
                const passthrough = new NodeReadable({
                    read () {
                        // no-op; data pushed from the busboy file stream.
                    },
                });
                fileStream.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    passthrough.push(chunk);
                });
                fileStream.on('end', () => passthrough.push(null));
                fileStream.on('error', (err: Error) => passthrough.destroy(err));

                const contentType = (info && typeof info.mimeType === 'string') ? info.mimeType : undefined;
                writePromise = this.services.fsEntry.write(userId, {
                    fileMetadata: {
                        path: targetPath,
                        size: 0, // real size accumulates as stream drains
                        ...(contentType ? { contentType } : {}),
                        overwrite: true,
                    },
                    fileContent: passthrough,
                }).then((response) => {
                    resolve({ fsEntry: response.fsEntry });
                }).catch(reject);
            });
            bb.on('close', () => {
                if ( ! dispatched ) {
                    reject(new HttpError(400, 'No file uploaded'));
                    return;
                }
                if ( ! writePromise ) {
                    reject(new HttpError(500, 'Write did not dispatch'));
                }
                // size is logged only; fsEntryService.write handles quota/size.
                void size;
            });
            bb.on('error', (err) => reject(err));
            req.pipe(bb);
        });
    }

    // ── Batch route ─────────────────────────────────────────────────────
    //
    // v1 `/batch` used busboy to interleave multipart JSON operations with
    // optional file uploads. In puter-js the only op-types that actually
    // flow through batch are `move`, `delete`, and `symlink` — none of which
    // need a file body — so this shim is pure JSON-field parsing.
    //
    // The wire shape (multipart/form-data) is preserved for client
    // compatibility. Unknown op-types are rejected per-op.

    batch = async (req: Request, res: Response): Promise<void> => {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const actor = req.actor!;
        const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '';

        // Parse the request. We support both multipart/form-data (the v1
        // client shape) and JSON bodies (handy for ad-hoc callers / tests).
        const operationSpecs = contentType.includes('multipart/form-data')
            ? await this.#parseMultipartBatch(req)
            : this.#parseJsonBatch(req);

        const results: unknown[] = [];
        let hasError = false;

        for ( const spec of operationSpecs ) {
            try {
                const record = asRecord(spec);
                const op = typeof record.op === 'string' ? record.op : '';
                let shaped: unknown;

                if ( op === 'move' ) {
                    const source = await resolveV1Selector(this.stores.fsEntry, record.source, userId);
                    const destinationParent = await resolveV1Selector(this.stores.fsEntry, record.destination, userId);
                    await assertAccess(this.services.acl, this.services.fsEntry, actor, source.path, 'write');
                    await assertAccess(this.services.acl, this.services.fsEntry, actor, destinationParent.path, 'write');
                    const moved = await this.services.fsEntry.move(userId, {
                        source,
                        destinationParent,
                        newName: getString(record, 'new_name'),
                        overwrite: getBoolean(record, 'overwrite') ?? false,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? false,
                    });
                    shaped = await toLegacyEntry(this.clients.event, moved);
                } else if ( op === 'delete' ) {
                    const entry = await resolveV1Selector(
                        this.stores.fsEntry,
                        getString(record, 'path') ?? record,
                        userId,
                    );
                    await assertAccess(this.services.acl, this.services.fsEntry, actor, entry.path, 'write');
                    await this.services.fsEntry.remove(userId, {
                        entry,
                        recursive: getBoolean(record, 'recursive') ?? true,
                        descendantsOnly: getBoolean(record, 'descendants_only') ?? false,
                    });
                    shaped = { ok: true, uid: entry.uuid };
                } else if ( op === 'symlink' ) {
                    const parent = await resolveV1Selector(
                        this.stores.fsEntry,
                        getString(record, 'path') ?? record.parent,
                        userId,
                    );
                    const name = getString(record, 'name');
                    const target = getString(record, 'target');
                    if ( ! name ) throw new HttpError(400, 'symlink: `name` is required');
                    if ( ! target ) throw new HttpError(400, 'symlink: `target` is required');
                    await assertAccess(this.services.acl, this.services.fsEntry, actor, parent.path, 'write');
                    const link = await this.services.fsEntry.mklink(userId, {
                        parent,
                        name,
                        targetPath: target,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? true,
                    });
                    shaped = await toLegacyEntry(this.clients.event, link);
                } else {
                    throw new HttpError(400, `Unsupported batch op: '${op}'`);
                }
                results.push(shaped);
            } catch ( err ) {
                hasError = true;
                results.push(this.#serializeBatchError(err));
            }
        }

        res.status(hasError ? 218 : 200).json({ results });
    };

    async #parseMultipartBatch (req: Request): Promise<unknown[]> {
        return new Promise<unknown[]>((resolve, reject) => {
            const ops: unknown[] = [];
            let parseError: Error | null = null;
            const bb = Busboy({ headers: req.headers });

            bb.on('field', (fieldName, value) => {
                if ( fieldName !== 'operation' ) return;
                try {
                    ops.push(JSON.parse(value));
                } catch ( err ) {
                    parseError = err instanceof Error ? err : new Error(String(err));
                }
            });

            // No file parts expected for move/delete/symlink — drain and
            // discard anything a misbehaving client happens to send.
            bb.on('file', (_fieldName, stream) => {
                stream.resume();
            });

            bb.on('close', () => {
                if ( parseError ) reject(parseError);
                else resolve(ops);
            });
            bb.on('error', (err) => reject(err));

            req.pipe(bb);
        });
    }

    #parseJsonBatch (req: Request): unknown[] {
        const body = asRecord(req.body);
        if ( Array.isArray(body.operations) ) return body.operations;
        if ( Array.isArray(body.ops) ) return body.ops;
        return [];
    }

    #serializeBatchError (err: unknown): Record<string, unknown> {
        if ( err instanceof HttpError ) {
            return {
                error: true,
                status: err.statusCode,
                message: err.message,
                code: err.legacyCode ?? err.code,
            };
        }
        if ( err instanceof Error ) {
            return { error: true, status: 500, message: err.message };
        }
        return { error: true, status: 500, message: 'Unknown batch error' };
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    #requireActor (req: Request) {
        const actor = req.actor;
        if ( ! actor ) {
            throw new HttpError(401, 'Unauthorized');
        }
        return actor;
    }

    #getActorUserId (req: Request): number {
        const requestUser = (req as Request & { user?: { id?: unknown } }).user;
        const actorUser = req.actor?.user;
        const candidate = requestUser?.id ?? actorUser?.id;
        if ( candidate === undefined || candidate === null ) {
            throw new HttpError(401, 'Unauthorized');
        }
        const numeric = Number(candidate);
        if ( Number.isNaN(numeric) ) throw new HttpError(401, 'Unauthorized');
        return numeric;
    }

    #parseSortBy (body: Record<string, unknown>): 'name' | 'modified' | 'type' | 'size' | null {
        const raw = getString(body, 'sort_by');
        if ( ! raw ) return null;
        const normalized = raw.toLowerCase();
        return (['name', 'modified', 'type', 'size'] as const).find((v) => v === normalized) ?? null;
    }

    #parseSortOrder (body: Record<string, unknown>): 'asc' | 'desc' | null {
        const raw = getString(body, 'sort_order');
        if ( ! raw ) return null;
        const normalized = raw.toLowerCase();
        return (['asc', 'desc'] as const).find((v) => v === normalized) ?? null;
    }

    async #listSubdomainsForEntry (entryUuid: string): Promise<unknown[]> {
        const subdomainStore = this.stores.subdomain as unknown as {
            listByRootDirUid?: (uid: string) => Promise<unknown[]>;
        } | undefined;
        if ( typeof subdomainStore?.listByRootDirUid === 'function' ) {
            try {
                return await subdomainStore.listByRootDirUid(entryUuid) ?? [];
            } catch {
                return [];
            }
        }
        return [];
    }

    // Reserved: once every legacy auxiliary route is ported, remove
    // `#createLazyHandler` entirely. Kept for now in case a future port
    // needs the escape hatch.
    #createLazyHandler (
        key: string,
        cache: RouterCache,
        loader: (key: string) => Promise<RequestHandler | null>,
    ): RequestHandler {
        return async (req, res, next) => {
            let handler = cache.get(key);
            if ( handler === undefined ) {
                handler = await loader(key);
                cache.set(key, handler);
            }
            if ( ! handler ) {
                next();
                return;
            }
            handler(req, res, next);
        };
    }
}
