import type { Request, RequestHandler, Response } from 'express';
import Busboy from 'busboy';
import { posix as pathPosix } from 'node:path';
import { PuterController } from '../types.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import type { FSEntryService } from '../../services/fs/FSEntryService.js';
import type { ACLService } from '../../services/acl/ACLService.js';
import type { EventClient } from '../../clients/EventClient.js';
import { HttpError } from '../../core/http/HttpError.js';
import { createV1ContextShim } from '../../services/fs/v1compat.js';
import {
    asRecord,
    assertAccess,
    getBoolean,
    getString,
    resolveV1Selector,
    toLegacyEntry,
} from './legacyFsHelpers.js';

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

const additionalRoutePaths: Record<string, string> = {
    writeFile: '../../legacy/routers/writeFile.js',
    openItem: '../../legacy/routers/open_item.js',
    itemMetadata: '../../legacy/routers/itemMetadata.js',
    down: '../../legacy/routers/down.js',
    file: '../../legacy/routers/file.js',
    sign: '../../legacy/routers/sign.js',
    setLayout: '../../legacy/routers/set_layout.js',
    setSortBy: '../../legacy/routers/set_sort_by.js',
    suggestApps: '../../legacy/routers/suggest_apps.js',
    df: '../../legacy/routers/df.js',
};

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
    #v1Shim: RequestHandler | null = null;

    private get fsEntryService (): FSEntryService {
        return this.services.fsEntry as unknown as FSEntryService;
    }

    private get aclService (): ACLService {
        return this.services.acl as unknown as ACLService;
    }

    private get eventClient (): EventClient | undefined {
        return this.clients.event as unknown as EventClient | undefined;
    }

    registerRoutes (router: PuterRouter): void {
        // The auxiliary legacy routes (writeFile, down, file, sign, ...)
        // still run inside v1 so they need the v1 Context ALS scope. The
        // core filesystem_api routes we re-implemented above don't.
        this.#v1Shim = createV1ContextShim();

        const apiOptions = { subdomain: 'api' } as const;

        // Core v1 filesystem_api routes — direct handlers over v2 service.
        router.post('/stat', apiOptions, this.#asHandler(this.#stat));
        router.post('/readdir', apiOptions, this.#asHandler(this.#readdir));
        router.post('/mkdir', apiOptions, this.#asHandler(this.#mkdir));
        router.post('/copy', apiOptions, this.#asHandler(this.#copy));
        router.post('/move', apiOptions, this.#asHandler(this.#move));
        router.post('/delete', apiOptions, this.#asHandler(this.#delete));
        router.post('/rename', apiOptions, this.#asHandler(this.#rename));
        router.post('/touch', apiOptions, this.#asHandler(this.#touch));
        router.post('/search', apiOptions, this.#asHandler(this.#search));
        router.get('/read', apiOptions, this.#asHandler(this.#read));
        router.get('/token-read', apiOptions, this.#asHandler(this.#read));

        router.post('/batch', apiOptions, this.#asHandler(this.#batch));

        // No-op: v1 /update was unused. v1 /cache/last-change-timestamp is
        // served by a tiny tracker — return 0 for now, revisit if a client
        // complains.
        router.get('/cache/last-change-timestamp', apiOptions, (_req, res) => {
            res.json({ timestamp: 0 });
        });

        // Remaining v1 routes still delegated to legacy modules.
        for ( const key of Object.keys(additionalRoutePaths) ) {
            router.use(this.#createLazyHandler(key, this.#additionalCache, loadAdditionalRouter));
        }
    }

    // Bind a method and adapt it into a TypedHandler-compatible function.
    // Returns a void-returning fn so the TypedHandler<O> signature matches.
    #asHandler (method: (req: Request, res: Response) => Promise<void>) {
        const self = this;
        return (req: Request, res: Response, next: (err?: unknown) => void): void => {
            Promise.resolve(method.call(self, req, res)).catch(next);
        };
    }

    // ── Route implementations ───────────────────────────────────────────

    async #stat (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const entry = await resolveV1Selector(this.fsEntryService, body, userId);
        await assertAccess(this.aclService, this.fsEntryService, actor, entry.path, 'see');

        const shaped = await toLegacyEntry(this.eventClient, entry);

        // Optional hydrations matching v1 HLStat:
        if ( entry.isDir && getBoolean(body, 'return_size') ) {
            shaped.size = await this.fsEntryService.getSubtreeSize(userId, entry.path);
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
    }

    async #readdir (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const parent = await resolveV1Selector(this.fsEntryService, body, userId);
        if ( ! parent.isDir ) {
            throw new HttpError(400, 'Target is not a directory');
        }
        await assertAccess(this.aclService, this.fsEntryService, actor, parent.path, 'list');

        const children = await this.fsEntryService.listDirectory(parent.uuid, {
            sortBy: this.#parseSortBy(body),
            sortOrder: this.#parseSortOrder(body),
        });

        const shaped = await Promise.all(children.map((c) => toLegacyEntry(this.eventClient, c)));
        res.json(shaped);
    }

    async #mkdir (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const rawPath = getString(body, 'path');
        if ( ! rawPath ) throw new HttpError(400, '`path` is required');

        // v1 supports `{ parent, path }` where `path` is a relative suffix.
        let targetPath = rawPath;
        if ( body.parent !== undefined && !rawPath.startsWith('/') ) {
            const parent = await resolveV1Selector(this.fsEntryService, body.parent, userId);
            targetPath = parent.path === '/' ? `/${rawPath}` : `${parent.path}/${rawPath}`;
        }

        const parentPath = pathPosix.dirname(targetPath.startsWith('/') ? targetPath : `/${targetPath}`);
        await assertAccess(
            this.aclService,
            this.fsEntryService,
            actor,
            parentPath === '/' ? targetPath : parentPath,
            'write',
        );

        const entry = await this.fsEntryService.mkdir(userId, {
            path: targetPath,
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
            createMissingParents: getBoolean(body, 'create_missing_parents', 'create_missing_ancestors') ?? false,
        });

        res.json(await toLegacyEntry(this.eventClient, entry));
    }

    async #copy (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const source = await resolveV1Selector(this.fsEntryService, body.source, userId);
        const destinationParent = await resolveV1Selector(this.fsEntryService, body.destination, userId);

        await assertAccess(this.aclService, this.fsEntryService, actor, source.path, 'read');
        await assertAccess(this.aclService, this.fsEntryService, actor, destinationParent.path, 'write');

        const copy = await this.fsEntryService.copy(userId, {
            source,
            destinationParent,
            newName: getString(body, 'new_name'),
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
        });

        // v1 /copy returns an array (historically supported bulk copies).
        res.json([await toLegacyEntry(this.eventClient, copy)]);
    }

    async #move (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const source = await resolveV1Selector(this.fsEntryService, body.source, userId);
        const destinationParent = await resolveV1Selector(this.fsEntryService, body.destination, userId);

        await assertAccess(this.aclService, this.fsEntryService, actor, source.path, 'write');
        await assertAccess(this.aclService, this.fsEntryService, actor, destinationParent.path, 'write');

        const moved = await this.fsEntryService.move(userId, {
            source,
            destinationParent,
            newName: getString(body, 'new_name'),
            overwrite: getBoolean(body, 'overwrite') ?? false,
            dedupeName: getBoolean(body, 'dedupe_name', 'change_name') ?? false,
        });

        res.json(await toLegacyEntry(this.eventClient, moved));
    }

    async #delete (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        // v1 /delete can take `paths: []` for bulk delete, or a single selector.
        const pathsArray = Array.isArray(body.paths) ? body.paths : null;
        if ( pathsArray ) {
            const removedEntries: unknown[] = [];
            for ( const raw of pathsArray ) {
                const entry = await resolveV1Selector(this.fsEntryService, raw, userId);
                await assertAccess(this.aclService, this.fsEntryService, actor, entry.path, 'write');
                await this.fsEntryService.remove(userId, {
                    entry,
                    recursive: getBoolean(body, 'recursive') ?? true,
                    descendantsOnly: getBoolean(body, 'descendants_only') ?? false,
                });
                removedEntries.push(await toLegacyEntry(this.eventClient, entry));
            }
            res.json(removedEntries);
            return;
        }

        const entry = await resolveV1Selector(this.fsEntryService, body, userId);
        await assertAccess(this.aclService, this.fsEntryService, actor, entry.path, 'write');
        await this.fsEntryService.remove(userId, {
            entry,
            recursive: getBoolean(body, 'recursive') ?? true,
            descendantsOnly: getBoolean(body, 'descendants_only') ?? false,
        });
        res.json({ ok: true, uid: entry.uuid });
    }

    async #rename (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const newName = getString(body, 'new_name');
        if ( ! newName ) throw new HttpError(400, '`new_name` is required');

        const entry = await resolveV1Selector(this.fsEntryService, body, userId);
        await assertAccess(this.aclService, this.fsEntryService, actor, entry.path, 'write');

        const renamed = await this.fsEntryService.rename(entry, newName);
        res.json(await toLegacyEntry(this.eventClient, renamed));
    }

    async #touch (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);

        const rawPath = getString(body, 'path');
        if ( ! rawPath ) throw new HttpError(400, '`path` is required');

        const parentPath = pathPosix.dirname(rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
        if ( parentPath === '/' ) {
            throw new HttpError(400, 'Cannot touch in root');
        }
        await assertAccess(this.aclService, this.fsEntryService, actor, parentPath, 'write');

        await this.fsEntryService.touch(userId, {
            path: rawPath,
            setAccessed: getBoolean(body, 'set_accessed_to_now') ?? false,
            setModified: getBoolean(body, 'set_modified_to_now') ?? false,
            setCreated: getBoolean(body, 'set_created_to_now') ?? false,
            createMissingParents: getBoolean(body, 'create_missing_parents') ?? false,
        });
        // v1 /touch historically returns an empty body.
        res.send('');
    }

    async #search (req: Request, res: Response): Promise<void> {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = asRecord(req.body);
        const query = getString(body, 'query', 'text') ?? '';
        if ( query.trim().length === 0 ) throw new HttpError(400, '`query` is required');

        const results = await this.fsEntryService.searchByName(userId, query, 200);
        const shaped = await Promise.all(results.map((r) => toLegacyEntry(this.eventClient, r)));
        res.json(shaped);
    }

    async #read (req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const query = asRecord(req.query);

        const entry = await resolveV1Selector(this.fsEntryService, query, userId);
        await assertAccess(this.aclService, this.fsEntryService, actor, entry.path, 'read');

        if ( entry.isDir ) {
            throw new HttpError(400, 'Cannot read a directory');
        }

        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        const download = await this.fsEntryService.readContent(entry, { range });

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

    async #batch (req: Request, res: Response): Promise<void> {
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
                    const source = await resolveV1Selector(this.fsEntryService, record.source, userId);
                    const destinationParent = await resolveV1Selector(this.fsEntryService, record.destination, userId);
                    await assertAccess(this.aclService, this.fsEntryService, actor, source.path, 'write');
                    await assertAccess(this.aclService, this.fsEntryService, actor, destinationParent.path, 'write');
                    const moved = await this.fsEntryService.move(userId, {
                        source,
                        destinationParent,
                        newName: getString(record, 'new_name'),
                        overwrite: getBoolean(record, 'overwrite') ?? false,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? false,
                    });
                    shaped = await toLegacyEntry(this.eventClient, moved);
                } else if ( op === 'delete' ) {
                    const entry = await resolveV1Selector(
                        this.fsEntryService,
                        getString(record, 'path') ?? record,
                        userId,
                    );
                    await assertAccess(this.aclService, this.fsEntryService, actor, entry.path, 'write');
                    await this.fsEntryService.remove(userId, {
                        entry,
                        recursive: getBoolean(record, 'recursive') ?? true,
                        descendantsOnly: getBoolean(record, 'descendants_only') ?? false,
                    });
                    shaped = { ok: true, uid: entry.uuid };
                } else if ( op === 'symlink' ) {
                    const parent = await resolveV1Selector(
                        this.fsEntryService,
                        getString(record, 'path') ?? record.parent,
                        userId,
                    );
                    const name = getString(record, 'name');
                    const target = getString(record, 'target');
                    if ( ! name ) throw new HttpError(400, 'symlink: `name` is required');
                    if ( ! target ) throw new HttpError(400, 'symlink: `target` is required');
                    await assertAccess(this.aclService, this.fsEntryService, actor, parent.path, 'write');
                    const link = await this.fsEntryService.mklink(userId, {
                        parent,
                        name,
                        targetPath: target,
                        dedupeName: getBoolean(record, 'dedupe_name') ?? true,
                    });
                    shaped = await toLegacyEntry(this.eventClient, link);
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
    }

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
            if ( this.#v1Shim ) {
                this.#v1Shim(req, res, (err?: unknown) => {
                    if ( err ) {
                        next(err);
                        return;
                    }
                    handler!(req, res, next);
                });
            } else {
                handler(req, res, next);
            }
        };
    }
}
