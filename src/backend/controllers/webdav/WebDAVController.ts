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

import { compare as bcryptCompare } from 'bcrypt';
import type { Request, Response } from 'express';
import { posix as pathPosix } from 'node:path';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { verify as verifyOtp } from '../../services/auth/OTPUtil.js';
import { expandTildePath } from '../../services/fs/resolveNode.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { PuterController } from '../types.js';
import {
    createLock,
    deleteLock,
    extractLockToken,
    getFileLocks,
    getLockIfValid,
    hasWritePermission,
    refreshLock,
} from './locks.js';

const DAV_HEADERS = {
    DAV: '1, 2, ordered-collections',
    'MS-Author-Via': 'DAV',
};

const ALLOW_METHODS =
    'OPTIONS, GET, HEAD, POST, PUT, DELETE, COPY, MOVE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK, TRACE';

// macOS creates these files; reject them to keep the FS clean.
const MACOS_JUNK_REGEX = /(?:^\.DS_Store$|^\._)/;

/**
 * WebDAV controller — full RFC 4918 surface on the `dav.*` subdomain.
 *
 * All FS operations go through v2's FSService + S3ObjectStore.
 * Locking uses Redis (see `./locks.ts`). ACL is enforced via ACLService
 * before every mutation and read.
 *
 * Auth: HTTP Basic → parse credentials → verify via AuthService +
 * bcrypt (or `-token` username for token-based auth). Falls back to
 * the global authProbe's `req.actor` if a session cookie is present.
 */
export class WebDAVController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        // Single catch-all on the `dav` subdomain. We dispatch by req.method
        // inside the handler because WebDAV uses non-standard HTTP verbs that
        // Express doesn't have first-class router methods for in all versions.
        router.use(
            { subdomain: 'dav' },
            async (req: Request, res: Response, _next) => {
                try {
                    await this.#dispatch(req, res);
                } catch (err) {
                    if (err instanceof HttpError) {
                        res.status(err.statusCode).send(err.message);
                        return;
                    }
                    console.error('[webdav] unhandled error', err);
                    res.status(500).send('Internal Server Error');
                }
                // Don't call next — we always handle or error.
            },
        );
    }

    async #dispatch(req: Request, res: Response): Promise<void> {
        // Authenticate
        const actor = await this.#resolveActor(req, res);
        if (!actor) return; // 401 already sent

        // Expand `~`/`~/...` against the authenticated actor's username.
        // WebDAV doesn't standardize `~`, but some clients do — and the
        // pre-existing behaviour silently expanded it via the FS store.
        const davPath = expandTildePath(
            decodeURIComponent(req.path),
            actor.user.username,
        );
        const redis = this.clients.redis;
        const lockToken = extractLockToken(
            (req.headers['if'] as string | undefined) ??
                (req.headers['lock-token'] as string | undefined),
        );

        switch (req.method.toUpperCase()) {
            case 'OPTIONS':
                return this.#options(res);
            case 'HEAD':
            case 'GET':
                return this.#get(
                    req,
                    res,
                    actor,
                    davPath,
                    req.method === 'HEAD',
                );
            case 'PROPFIND':
                return this.#propfind(req, res, actor, davPath);
            case 'PROPPATCH':
                return this.#proppatch(res, davPath, redis, lockToken);
            case 'MKCOL':
                return this.#mkcol(req, res, actor, davPath, redis, lockToken);
            case 'PUT':
                return this.#put(req, res, actor, davPath, redis, lockToken);
            case 'DELETE':
                return this.#delete(res, actor, davPath, redis, lockToken);
            case 'COPY':
                return this.#copy(req, res, actor, davPath, redis, lockToken);
            case 'MOVE':
                return this.#move(req, res, actor, davPath, redis, lockToken);
            case 'LOCK':
                return this.#lock(req, res, davPath, redis, lockToken);
            case 'UNLOCK':
                return this.#unlock(req, res, davPath, redis);
            default:
                res.status(405)
                    .set('Allow', ALLOW_METHODS)
                    .send('Method Not Allowed');
        }
    }

    // ── Auth ─────────────────────────────────────────────────────────

    async #resolveActor(req: Request, res: Response): Promise<Actor | null> {
        // If the global authProbe already resolved an actor, use it.
        if (req.actor?.user) return req.actor;

        // Parse HTTP Basic
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.status(401)
                .set({
                    'WWW-Authenticate': 'Basic realm="WebDAV"',
                    ...DAV_HEADERS,
                })
                .send('Authentication required');
            return null;
        }

        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString(
            'utf-8',
        );
        const colonIdx = decoded.indexOf(':');
        if (colonIdx < 0) {
            res.status(401)
                .set('WWW-Authenticate', 'Basic realm="WebDAV"')
                .send('Invalid credentials');
            return null;
        }
        const username = decoded.slice(0, colonIdx);
        const password = decoded.slice(colonIdx + 1);

        // `-token` username: password IS the auth token
        if (username === '-token') {
            const actor =
                await this.services.auth.authenticateFromToken(password);
            if (!actor) {
                res.status(401)
                    .set('WWW-Authenticate', 'Basic realm="WebDAV"')
                    .send('Invalid token');
                return null;
            }
            return actor;
        }

        // Regular username + password (with optional 6-digit OTP suffix)
        const user = await this.stores.user.getByUsername(username);
        if (!user || !user.password) {
            res.status(401)
                .set('WWW-Authenticate', 'Basic realm="WebDAV"')
                .send('Invalid credentials');
            return null;
        }

        // If 2FA is enabled the password MUST be suffixed with the 6-digit
        // TOTP code — HTTP Basic has no channel for a second factor.
        const otpEnabled = Boolean(user.otp_enabled);
        let passwordOk = false;
        if (otpEnabled) {
            if (password.length <= 6) {
                res.status(401)
                    .set('WWW-Authenticate', 'Basic realm="WebDAV"')
                    .send('Invalid credentials');
                return null;
            }
            const basePassword = password.slice(0, -6);
            const otpCode = password.slice(-6);
            const baseOk = await bcryptCompare(basePassword, user.password);
            const otpOk =
                baseOk &&
                typeof user.otp_secret === 'string' &&
                verifyOtp(user.username, user.otp_secret, otpCode);
            passwordOk = Boolean(otpOk);
        } else {
            passwordOk = await bcryptCompare(password, user.password);
        }

        if (!passwordOk) {
            res.status(401)
                .set('WWW-Authenticate', 'Basic realm="WebDAV"')
                .send('Invalid credentials');
            return null;
        }

        // Build a session-less actor for the user
        return {
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
                email: user.email ?? null,
                suspended: user.suspended ?? false,
                email_confirmed: user.email_confirmed ?? false,
                requires_email_confirmation:
                    user.requires_email_confirmation ?? false,
            },
        };
    }

    // ── OPTIONS ──────────────────────────────────────────────────────

    #options(res: Response): void {
        res.status(200)
            .set({
                Allow: ALLOW_METHODS,
                ...DAV_HEADERS,
                'Accept-Ranges': 'bytes',
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
            })
            .send('');
    }

    // ── GET / HEAD ──────────────────────────────────────────────────

    async #get(
        req: Request,
        res: Response,
        actor: Actor,
        davPath: string,
        headOnly: boolean,
    ): Promise<void> {
        const entry = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!entry) throw new HttpError(404, 'Not Found');
        if (entry.isDir) throw new HttpError(400, 'Cannot GET a directory');

        await this.#assertRead(actor, davPath);

        const etag = `"${entry.uuid}-${Math.floor(entry.modified ?? entry.created ?? 0)}"`;
        const size = entry.size ?? 0;

        res.set({
            'Accept-Ranges': 'bytes',
            'Content-Length': String(size),
            'Last-Modified': new Date(
                entry.modified ?? entry.created ?? 0,
            ).toUTCString(),
            ETag: etag,
        });

        if (headOnly) {
            res.status(200).end();
            return;
        }

        const rangeHeader = req.headers.range;
        const result = await this.services.fs.readContent(entry, {
            range: rangeHeader,
        });
        if (result.contentType) res.set('Content-Type', result.contentType);
        if (result.contentRange) {
            res.status(206).set({
                'Content-Range': result.contentRange,
                'Content-Length': String(result.contentLength ?? 0),
            });
        }
        result.body.pipe(res);
    }

    // ── PROPFIND ────────────────────────────────────────────────────

    async #propfind(
        req: Request,
        res: Response,
        actor: Actor,
        davPath: string,
    ): Promise<void> {
        const depth = req.headers.depth ?? '1';

        const entry =
            davPath === '/'
                ? null // root always exists
                : await this.stores.fsEntry.getEntryByPath(davPath);
        if (davPath !== '/' && !entry) throw new HttpError(404, 'Not Found');

        await this.#assertRead(actor, davPath);

        const isDir = davPath === '/' || !!entry?.isDir;
        const responses = [propfindEntry(davPath, entry, isDir)];

        if (depth !== '0' && isDir && entry) {
            const children = await this.services.fs.listDirectory(
                entry.uuid,
                {},
            );
            for (const child of children) {
                responses.push(propfindEntry(child.path, child, child.isDir));
            }
        } else if (depth !== '0' && davPath === '/') {
            // Root: list top-level user directories
            const rootEntry = await this.stores.fsEntry.getEntryByPath(
                `/${actor.user!.username}`,
            );
            if (rootEntry) {
                responses.push(
                    propfindEntry(rootEntry.path, rootEntry, rootEntry.isDir),
                );
            }
        }

        res.status(207)
            .set({ 'Content-Type': 'application/xml; charset=utf-8' })
            .send(wrapMultistatus(responses.join('\n')));
    }

    // ── PROPPATCH (stub — acknowledges but doesn't persist props) ───

    async #proppatch(
        res: Response,
        davPath: string,
        redis: unknown,
        lockToken: string | null,
    ): Promise<void> {
        if (
            !(await hasWritePermission(
                redis as import('ioredis').Cluster,
                davPath,
                lockToken,
            ))
        ) {
            throw new HttpError(423, 'Locked');
        }
        res.status(207)
            .set({ 'Content-Type': 'application/xml; charset=utf-8' })
            .send(
                `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeXml(encodeURI(davPath))}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
            );
    }

    // ── MKCOL ───────────────────────────────────────────────────────

    async #mkcol(
        req: Request,
        res: Response,
        actor: Actor,
        davPath: string,
        redis: unknown,
        lockToken: string | null,
    ): Promise<void> {
        if (davPath === '/') throw new HttpError(403, 'Cannot create at root');
        if (
            req.headers['content-length'] &&
            Number(req.headers['content-length']) > 0
        ) {
            throw new HttpError(415, 'MKCOL must not have a body');
        }
        if (
            !(await hasWritePermission(
                redis as import('ioredis').Cluster,
                davPath,
                lockToken,
            ))
        ) {
            throw new HttpError(423, 'Locked');
        }
        const userId = actor.user!.id as number;
        const parentPath = pathPosix.dirname(davPath);
        await this.#assertWrite(actor, parentPath);

        const existing = await this.stores.fsEntry.getEntryByPath(davPath);
        if (existing) throw new HttpError(405, 'Already exists');

        const entry = await this.services.fs.mkdir(userId, {
            path: davPath,
        });
        this.#emitGuiEvent('outer.gui.item.added', entry);
        res.status(201)
            .set({ 'Content-Length': '0', Location: `${davPath}/` })
            .end();
    }

    // ── PUT ─────────────────────────────────────────────────────────

    async #put(
        req: Request,
        res: Response,
        actor: Actor,
        davPath: string,
        redis: unknown,
        lockToken: string | null,
    ): Promise<void> {
        const name = pathPosix.basename(davPath);
        if (MACOS_JUNK_REGEX.test(name)) {
            res.status(422).send('Ignored macOS metadata file');
            return;
        }
        if (
            !(await hasWritePermission(
                redis as import('ioredis').Cluster,
                davPath,
                lockToken,
            ))
        ) {
            throw new HttpError(423, 'Locked');
        }

        const userId = actor.user!.id as number;
        const parentPath = pathPosix.dirname(davPath);
        await this.#assertWrite(actor, parentPath);

        const contentLength = Number(
            req.headers['content-length'] ??
                req.headers['x-expected-entity-length'] ??
                0,
        );
        if (!contentLength && contentLength !== 0)
            throw new HttpError(400, 'Missing Content-Length');

        // Check if overwrite
        const existing = await this.stores.fsEntry.getEntryByPath(davPath);

        // Expect: 100-continue
        if (req.headers.expect === '100-continue') {
            (req.socket as { write?: (s: string) => void }).write?.(
                'HTTP/1.1 100 Continue\r\n\r\n',
            );
        }

        const writeResult = await this.services.fs.write(userId, {
            fileMetadata: {
                path: davPath,
                size: contentLength,
                overwrite: true,
                createMissingParents: true,
            },
            fileContent: req,
        });

        this.#emitGuiEvent(
            existing ? 'outer.gui.item.updated' : 'outer.gui.item.added',
            writeResult.fsEntry,
        );

        const fe = writeResult.fsEntry;
        const etag = `"${fe.uuid}-${Math.floor(fe.modified ?? fe.created ?? 0)}"`;
        res.status(existing ? 204 : 201)
            .set({
                ETag: etag,
                'Last-Modified': new Date(
                    fe.modified ?? fe.created ?? 0,
                ).toUTCString(),
            })
            .end();
    }

    // ── DELETE ───────────────────────────────────────────────────────

    async #delete(
        res: Response,
        actor: Actor,
        davPath: string,
        redis: unknown,
        lockToken: string | null,
    ): Promise<void> {
        if (
            !(await hasWritePermission(
                redis as import('ioredis').Cluster,
                davPath,
                lockToken,
            ))
        ) {
            throw new HttpError(423, 'Locked');
        }
        const userId = actor.user!.id as number;
        await this.#assertWrite(actor, davPath);

        const entry = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!entry) throw new HttpError(404, 'Not Found');

        await this.services.fs.remove(userId, { entry, recursive: true });
        this.#emitGuiEvent('outer.gui.item.removed', entry);
        res.status(204).end();
    }

    // ── COPY ────────────────────────────────────────────────────────

    async #copy(
        req: Request,
        res: Response,
        actor: Actor,
        davPath: string,
        redis: unknown,
        lockToken: string | null,
    ): Promise<void> {
        const destPath = this.#parseDestination(req);
        if (
            !(await hasWritePermission(
                redis as import('ioredis').Cluster,
                destPath,
                lockToken,
            ))
        ) {
            throw new HttpError(423, 'Locked');
        }

        const userId = actor.user!.id as number;
        await this.#assertRead(actor, davPath);
        await this.#assertWrite(actor, pathPosix.dirname(destPath));

        const source = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!source) throw new HttpError(404, 'Source not found');

        const overwrite = req.headers.overwrite !== 'F';
        const destExists = await this.stores.fsEntry.getEntryByPath(destPath);
        if (destExists && !overwrite)
            throw new HttpError(412, 'Destination exists and Overwrite=F');

        const destParent = await this.stores.fsEntry.getEntryByPath(
            pathPosix.dirname(destPath),
        );
        if (!destParent?.isDir)
            throw new HttpError(
                409,
                'Destination parent missing or not a directory',
            );

        const copy = await this.services.fs.copy(userId, {
            source,
            destinationParent: destParent,
            newName: pathPosix.basename(destPath),
            overwrite,
        });
        this.#emitGuiEvent('outer.gui.item.added', copy);
        res.status(destExists ? 204 : 201).end();
    }

    // ── MOVE ────────────────────────────────────────────────────────

    async #move(
        req: Request,
        res: Response,
        actor: Actor,
        davPath: string,
        redis: unknown,
        lockToken: string | null,
    ): Promise<void> {
        const destPath = this.#parseDestination(req);
        const r = redis as import('ioredis').Cluster;
        if (!(await hasWritePermission(r, davPath, lockToken)))
            throw new HttpError(423, 'Locked');
        if (!(await hasWritePermission(r, destPath, lockToken)))
            throw new HttpError(423, 'Locked');

        const userId = actor.user!.id as number;
        await this.#assertWrite(actor, davPath);
        await this.#assertWrite(actor, pathPosix.dirname(destPath));

        const source = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!source) throw new HttpError(404, 'Source not found');

        const overwrite = req.headers.overwrite !== 'F';
        const destExists = await this.stores.fsEntry.getEntryByPath(destPath);
        if (destExists && !overwrite)
            throw new HttpError(412, 'Destination exists and Overwrite=F');

        const destParent = await this.stores.fsEntry.getEntryByPath(
            pathPosix.dirname(destPath),
        );
        if (!destParent?.isDir)
            throw new HttpError(
                409,
                'Destination parent missing or not a directory',
            );

        const moved = await this.services.fs.move(userId, {
            source,
            destinationParent: destParent,
            newName: pathPosix.basename(destPath),
            overwrite,
        });
        this.#emitGuiEvent('outer.gui.item.moved', moved, {
            old_path: davPath,
        });
        res.status(destExists ? 204 : 201).end();
    }

    // ── LOCK ────────────────────────────────────────────────────────

    async #lock(
        req: Request,
        res: Response,
        davPath: string,
        redis: unknown,
        headerToken: string | null,
    ): Promise<void> {
        const r = redis as import('ioredis').Cluster;

        // Refresh existing lock
        if (headerToken) {
            const existing = await getLockIfValid(r, headerToken);
            if (!existing) throw new HttpError(412, 'Lock token not found');
            await refreshLock(r, headerToken);
            res.status(200)
                .set({
                    'Content-Type': 'application/xml; charset=utf-8',
                    ...DAV_HEADERS,
                })
                .send(
                    lockResponseXml(headerToken, davPath, existing.lockScope),
                );
            return;
        }

        // Parse requested scope from XML body
        let lockScope: 'exclusive' | 'shared' = 'exclusive';
        const body = req.body as Record<string, unknown> | undefined;
        if (body?.lockinfo) {
            const info = body.lockinfo as Record<string, unknown>;
            const scope = info.lockscope as Record<string, unknown> | undefined;
            if (scope?.shared !== undefined) lockScope = 'shared';
        }

        // Check for conflicts
        const existingLocks = await getFileLocks(r, davPath);
        for (const lock of existingLocks) {
            if (lockScope === 'exclusive' || lock.lockScope === 'exclusive') {
                throw new HttpError(423, 'Locked — conflicting lock exists');
            }
        }

        const token = await createLock(r, davPath, lockScope);
        const status = 200;

        res.status(status)
            .set({
                'Content-Type': 'application/xml; charset=utf-8',
                'Lock-Token': `<${token}>`,
                ...DAV_HEADERS,
            })
            .send(lockResponseXml(token, davPath, lockScope));
    }

    // ── UNLOCK ──────────────────────────────────────────────────────

    async #unlock(
        req: Request,
        res: Response,
        davPath: string,
        redis: unknown,
    ): Promise<void> {
        const r = redis as import('ioredis').Cluster;
        const tokenHeader = req.headers['lock-token'] as string | undefined;
        const token = extractLockToken(tokenHeader);
        if (!token) throw new HttpError(400, 'Missing Lock-Token header');

        const lock = await getLockIfValid(r, token);
        if (!lock) {
            // Idempotent — if already expired, just 204.
            res.status(204).end();
            return;
        }
        if (lock.path !== davPath)
            throw new HttpError(403, 'Lock token does not match this path');

        await deleteLock(r, token);
        res.status(204).end();
    }

    // ── ACL helpers ─────────────────────────────────────────────────

    async #assertRead(actor: Actor, path: string): Promise<void> {
        const descriptor = {
            path,
            resolveAncestors: () => this.services.fs.getAncestorChain(path),
        };
        const ok = await this.services.acl.check(actor, descriptor, 'read');
        if (!ok) throw new HttpError(403, 'Permission denied');
    }

    async #assertWrite(actor: Actor, path: string): Promise<void> {
        const descriptor = {
            path,
            resolveAncestors: () => this.services.fs.getAncestorChain(path),
        };
        const ok = await this.services.acl.check(actor, descriptor, 'write');
        if (!ok) throw new HttpError(403, 'Permission denied');
    }

    // ── Event emission ──────────────────────────────────────────────

    #emitGuiEvent(
        eventName: string,
        entry: FSEntry,
        extra?: Record<string, unknown>,
    ): void {
        const payload = {
            user_id_list: [entry.userId],
            response: { ...entry, ...extra, from_new_service: true },
        };
        const meta = {};
        void Promise.resolve()
            .then(() => this.clients.event.emit(eventName, payload, meta))
            .catch(() => {
                // non-critical
            });
    }

    // ── Misc helpers ────────────────────────────────────────────────

    #parseDestination(req: Request): string {
        const dest = req.headers.destination as string | undefined;
        if (!dest) throw new HttpError(400, 'Missing Destination header');
        try {
            const url = new URL(dest, `http://${req.headers.host}`);
            return decodeURIComponent(url.pathname);
        } catch {
            return decodeURIComponent(dest);
        }
    }
}

// ── XML helpers ──────────────────────────────────────────────────────

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function wrapMultistatus(inner: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${inner}\n</D:multistatus>`;
}

function propfindEntry(
    href: string,
    entry: FSEntry | null,
    isDir: boolean,
): string {
    const encodedHref =
        encodeURI(href) + (isDir && !href.endsWith('/') ? '/' : '');
    const modified =
        entry?.modified ?? entry?.created ?? '2025-01-01T00:00:00Z';
    const created = entry?.created ?? '2025-01-01T00:00:00Z';
    const name = entry?.name ?? (pathPosix.basename(href) || '/');
    const uid = entry?.uuid ?? 'root';
    const modTs = Math.floor(new Date(modified as string).getTime());

    let props = `
        <D:displayname>${escapeXml(String(name))}</D:displayname>
        <D:getlastmodified>${new Date(modified as string).toUTCString()}</D:getlastmodified>
        <D:creationdate>${new Date(created as string).toISOString()}</D:creationdate>
        <D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getetag>"${uid}-${modTs}"</D:getetag>
        <D:supportedlock>
          <D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>
          <D:lockentry><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>
        </D:supportedlock>
        <D:lockdiscovery/>
        <D:ishidden>0</D:ishidden>`;

    if (!isDir && entry) {
        props += `\n        <D:getcontentlength>${entry.size ?? 0}</D:getcontentlength>`;
        const mime = mimeFromExt(pathPosix.extname(entry.name));
        props += `\n        <D:getcontenttype>${escapeXml(mime)}</D:getcontenttype>`;
    }

    return `  <D:response>
    <D:href>${escapeXml(encodedHref)}</D:href>
    <D:propstat>
      <D:prop>${props}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

const MIME_MAP: Record<string, string> = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.zip': 'application/zip',
    '.wasm': 'application/wasm',
};

function mimeFromExt(ext: string): string {
    return MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

function lockResponseXml(
    token: string,
    path: string,
    scope: 'exclusive' | 'shared',
): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:${scope}/></D:lockscope>
      <D:depth>0</D:depth>
      <D:owner><D:href>webdav-user</D:href></D:owner>
      <D:timeout>Second-7200</D:timeout>
      <D:locktoken><D:href>${escapeXml(token)}</D:href></D:locktoken>
      <D:lockroot><D:href>${escapeXml(encodeURI(path))}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
}
