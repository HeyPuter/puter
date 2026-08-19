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

import { compare as bcryptCompare } from 'bcrypt';
import type { Request, Response } from 'express';
import { posix as pathPosix } from 'node:path';
import { EventMap } from '../../clients/event/types.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    assertNotSuspended,
    assertVerifiedAccount,
} from '../../core/http/middleware/gates.js';
import {
    All,
    Controller,
    Copy,
    Delete,
    Get,
    Head,
    Lock,
    Mkcol,
    Move,
    Options,
    Propfind,
    Proppatch,
    Put,
    Unlock,
} from '../../core/http/decorators.js';
import type { RouteOptions } from '../../core/http/types.js';
import { verify as verifyOtp } from '../../services/auth/OTPUtil.js';
import { expandTildePath } from '../../services/fs/resolveNode.js';
import {
    maskEntryPath,
    parseMaskedSharePath,
    resolveSharePath,
} from '../../services/fs/sharePathMask.js';
import { Context } from '../../core/context.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { toLegacyEntry } from '../fs/legacyFsHelpers.js';
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
import { DAV_CONCURRENT, DAV_LIMIT } from '../fs/limits.js';
import { assertActorHasCredits } from '../../services/metering/enforcement.js';
import type { ResolvedShare } from '../../services/share/ShareService.js';

const DAV_HEADERS = {
    DAV: '1, 2, ordered-collections',
    'MS-Author-Via': 'DAV',
};

const ALLOW_METHODS =
    'OPTIONS, GET, HEAD, POST, PUT, DELETE, COPY, MOVE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK, TRACE';

// macOS creates these files; reject them to keep the FS clean.
const MACOS_JUNK_REGEX = /(?:^\.DS_Store$|^\._)/;

/**
 * Every DAV verb mounts on the same catch-all: on a DAV host the path _is_ the
 * resource, so there is nothing else to route on. `{*splat}` rather than plain
 * `*splat` because only the braced form also matches `/`, which is the first
 * collection a client PROPFINDs.
 */
const DAV_ROUTE = '/{*splat}';

/**
 * Everything the route table declares. The subdomain keeps DAV off every other
 * host, and both limits key on the network fingerprint because nothing has
 * authenticated yet when they run — which is the point of putting them here
 * rather than inside the handler. A DAV client sends credentials on every
 * request anyway, so there is no unauthenticated browsing phase that a per-user
 * key would protect.
 */
const DAV_ROUTE_OPTIONS: RouteOptions = {
    subdomain: 'dav',
    rateLimit: DAV_LIMIT,
    concurrent: DAV_CONCURRENT,
};

/** How long a browser may cache a DAV preflight. */
const PREFLIGHT_MAX_AGE = '86400';

/** How many shared items the virtual share collections list. */
const SHARE_LISTING_CAP = 200;

/** What `#context` resolved for one request, handed to every verb handler. */
interface DavContext {
    actor: Actor;
    /** The real path being addressed, with `~` and any share mask resolved. */
    davPath: string;
    /** Lock token from `If:` / `Lock-Token:`, when the client sent one. */
    lockToken: string | null;
}

/**
 * WebDAV controller — full RFC 4918 surface on the `dav.*` subdomain.
 *
 * All FS operations go through v2's FSService + S3ObjectStore. Locking uses
 * Redis (see `./locks.ts`). ACL is enforced via ACLService before every
 * mutation and read.
 *
 * Auth: HTTP Basic → parse credentials → verify via AuthService + bcrypt (or
 * `-token` username for token-based auth). Falls back to the global authProbe's
 * `req.actor` if a session cookie is present.
 */
@Controller()
export class WebDAVController extends PuterController {
    // -- Routes ------------------------------------------------------
    //
    // One route per verb, every one of them the same catch-all. Declaration
    // order is registration order: HEAD before GET, because express falls a
    // HEAD request back onto a GET route when it meets one first, and `@All`
    // last, because it matches any method.
    //
    // `DAV_ROUTE_OPTIONS` is the whole declarative half of the chain. The
    // credential work happens in `#serve` instead, which is what keeps the
    // limits ahead of it: HTTP Basic means a bcrypt compare per request, and a
    // caller already over budget shouldn't get one.

    @Options(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    options(req: Request, res: Response): Promise<void> {
        // Before the auth gate, and only for a real preflight — see
        // `answerPreflight`.
        if (answerPreflight(req, res)) return Promise.resolve();
        return this.#serve(req, res, () => this.#options(res));
    }

    // GET/HEAD/PUT/COPY move file content or duplicate it in the object store,
    // so they carry the same budget gate the FS routes declare with
    // `requireCredits`: DAV serves the same files over a metered host, and
    // leaving it out would make mounting the drive the way around enforcement.
    // The verbs that only describe or remove things stay open, as they do over
    // HTTP. HEAD is metered with GET because a client asking for headers is a
    // client about to fetch the body.
    //
    // `requireCredits` itself can't be used for this: it reads `req.actor`, and
    // on the DAV host nothing has authenticated by the time route options run.

    @Head(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    head(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#get(req, res, ctx, true), {
            credits: true,
        });
    }

    @Get(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    get(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#get(req, res, ctx, false), {
            credits: true,
        });
    }

    @Propfind(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    propfind(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#propfind(req, res, ctx));
    }

    @Proppatch(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    proppatch(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#proppatch(res, ctx));
    }

    @Mkcol(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    mkcol(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#mkcol(req, res, ctx));
    }

    @Put(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    put(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#put(req, res, ctx), {
            credits: true,
        });
    }

    @Delete(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    delete(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#delete(res, ctx));
    }

    @Copy(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    copy(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#copy(req, res, ctx), {
            credits: true,
        });
    }

    @Move(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    move(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#move(req, res, ctx));
    }

    @Lock(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    lock(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#lock(req, res, ctx));
    }

    @Unlock(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    unlock(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, (ctx) => this.#unlock(req, res, ctx));
    }

    /** POST, TRACE, an extension verb we don't implement. */
    @All(DAV_ROUTE, DAV_ROUTE_OPTIONS)
    unsupported(req: Request, res: Response): Promise<void> {
        return this.#serve(req, res, () => {
            res.status(405)
                .set('Allow', ALLOW_METHODS)
                .send('Method Not Allowed');
        });
    }

    // -- Request plumbing ---------------------------------------------

    /**
     * Authenticate, gate, resolve the target path, and run `handler` — or
     * answer the request instead when any of that fails. A thrown `HttpError`
     * becomes the plain-text reply a DAV client reads; nothing calls `next`,
     * because a request that gets here is ours to answer.
     */
    async #serve(
        req: Request,
        res: Response,
        handler: (ctx: DavContext) => void | Promise<void>,
        opts: { credits?: boolean } = {},
    ): Promise<void> {
        try {
            const ctx = await this.#context(req, res, opts);
            if (!ctx) return; // 401 already sent
            await handler(ctx);
        } catch (err) {
            sendDavError(res, err);
        }
    }

    /** The actor, path and lock token for one request; null once 401'd. */
    async #context(
        req: Request,
        res: Response,
        opts: { credits?: boolean },
    ): Promise<DavContext | null> {
        const actor = await this.#resolveActor(req, res);
        if (!actor) return null;

        // The same suspension + pending-verification gates every other
        // authenticated route gets from `requireAuthGate` /
        // `requireVerifiedAccount`. DAV authenticates itself rather than
        // through the auth probe, so that middleware is never in its chain —
        // without these calls a suspended account (or one still pending email /
        // phone / card verification) could read, write, and delete its entire
        // filesystem over the `dav` subdomain, bypassing the gates.
        assertNotSuspended(actor.user);
        assertVerifiedAccount(actor.user);

        // The actor was absent when the auth probe ran, so anything that reads
        // it off the request or the context — shared-path masking, egress
        // metering, which bills the `dav` host — is blind until it's published
        // here.
        req.actor = actor;
        if (Context.current()) Context.set('actor', actor);

        if (opts.credits) {
            await assertActorHasCredits(
                this.services.metering,
                actor,
                this.config,
            );
        }

        // Expand `~`/`~/...` against the authenticated actor's username.
        // WebDAV doesn't standardize `~`, but some clients do — and the
        // pre-existing behaviour silently expanded it via the FS store.
        const davPath = await resolveSharePath(
            this.stores.fsEntry,
            actor,
            expandTildePath(decodeURIComponent(req.path), actor.user.username),
        );

        return {
            actor,
            davPath,
            lockToken: extractLockToken(
                (req.headers['if'] as string | undefined) ??
                    (req.headers['lock-token'] as string | undefined),
            ),
        };
    }

    // -- Auth ---------------------------------------------------------

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
        return makeActor({
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
                email: user.email ?? null,
                suspended: user.suspended ?? false,
                email_confirmed: user.email_confirmed ?? false,
                requires_email_confirmation:
                    user.requires_email_confirmation ?? false,
                // Carry the signup-time verification flags so the
                // assertVerifiedAccount() gate in #dispatch can see them on
                // the Basic-auth path too (the cookie / `-token` paths get
                // them from AuthService#actorUserFromRow). Omitting these is
                // what let phone/card-gated accounts through WebDAV.
                requires_phone_verification:
                    user.requires_phone_verification ?? false,
                requires_card_verification:
                    user.requires_card_verification ?? false,
            },
        });
    }

    // -- OPTIONS ------------------------------------------------------

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

    // -- GET / HEAD --------------------------------------------------

    async #get(
        req: Request,
        res: Response,
        { actor, davPath }: DavContext,
        headOnly: boolean,
    ): Promise<void> {
        const entry = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!entry)
            throw new HttpError(404, 'Not Found', { legacyCode: 'not_found' });
        if (entry.isDir)
            throw new HttpError(400, 'Cannot GET a directory', {
                legacyCode: 'bad_request',
            });

        await this.#assertRead(actor, davPath);

        const modified = entry.modified ?? entry.created ?? 0;
        const etag = entryEtag(entry.uuid, modified);
        const size = entry.size ?? 0;

        res.set({
            'Accept-Ranges': 'bytes',
            'Content-Length': String(size),
            'Last-Modified': entryDate(modified).toUTCString(),
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

    // -- PROPFIND ----------------------------------------------------

    async #propfind(
        req: Request,
        res: Response,
        { actor, davPath }: DavContext,
    ): Promise<void> {
        const depth = req.headers.depth ?? '1';

        if (davPath === '/') {
            await this.#assertRead(actor, davPath);
            this.#sendMultistatus(res, await this.#rootPropfind(actor, depth));
            return;
        }

        const entry = await this.stores.fsEntry.getEntryByPath(davPath);

        // The two levels a share mask invents — `/<owner>` and
        // `/<owner>/<uuid>` — have no entry behind them, so they answer as
        // virtual collections. Tried before the ACL check because `/<owner>`
        // _is_ a real path (the owner's home directory) that the recipient
        // can't read: a 403 there would hide every share they do have.
        const virtual =
            (await this.#shareOwnerPropfind(actor, davPath, entry, depth)) ??
            (entry
                ? null
                : await this.#shareRootParentPropfind(actor, davPath, depth));
        if (virtual) {
            this.#sendMultistatus(res, virtual);
            return;
        }

        if (!entry) {
            throw new HttpError(404, 'Not Found', { legacyCode: 'not_found' });
        }

        await this.#assertRead(actor, davPath);

        // `davPath` is the resolved real path; the href has to be the masked
        // one, like every child below it, or the self-entry names the owner's
        // real folder.
        const responses = [
            propfindEntry(maskEntryPath(entry), entry, entry.isDir),
        ];

        if (depth !== '0' && entry.isDir) {
            const children = await this.services.fs.listDirectory(
                entry.uuid,
                {},
            );
            for (const child of children) {
                responses.push(
                    propfindEntry(maskEntryPath(child), child, child.isDir),
                );
            }
        }

        this.#sendMultistatus(res, responses);
    }

    /**
     * The root collection: the caller's own home directory, plus one collection
     * per person who has shared something with them.
     *
     * A share is addressed `/<owner>/<uuid>/<name>`, where the uuid stands in
     * for the folder the owner keeps it in. Only the `<owner>` segment is a
     * child of the root, so without this level nothing shared is reachable from
     * a mount at all — which is why a Finder mount showed only the caller's own
     * files.
     */
    async #rootPropfind(actor: Actor, depth: string | string[]) {
        const responses = [propfindEntry('/', null, true)];
        if (depth === '0') return responses;

        const home = await this.stores.fsEntry.getEntryByPath(
            `/${actor.user!.username}`,
        );
        if (home) {
            responses.push(
                propfindEntry(maskEntryPath(home), home, home.isDir),
            );
        }

        const owners = new Set<string>();
        for (const share of await this.#sharedWithMe(actor)) {
            const owner = share.owner?.username;
            // Self-owned entries never appear in the share index, but the home
            // directory above already covers them if one ever did.
            if (owner && owner !== actor.user!.username) owners.add(owner);
        }
        for (const owner of owners) {
            responses.push(propfindEntry(`/${owner}`, { name: owner }, true));
        }

        return responses;
    }

    /**
     * PROPFIND responses for the virtual collection at `/<owner>`, listing one
     * child per item that owner shared with the actor, or null when `davPath`
     * isn't a bare username, is the actor's own, is readable for real, or the
     * actor holds nothing of theirs — the caller then continues down the normal
     * path and gets the 403 or 404 it would otherwise have given.
     *
     * Children are the `<uuid>` level rather than the shared item itself: the
     * item's own href sits one segment deeper, and a collection may only report
     * its direct members. Nothing here reaches past that level, so `Depth:
     * infinity` on a sharer's collection still enumerates only what they
     * shared, and everything below it goes through the ordinary resolve + ACL
     * path.
     */
    async #shareOwnerPropfind(
        actor: Actor,
        davPath: string,
        entry: FSEntry | null,
        depth: string | string[],
    ): Promise<string[] | null> {
        const segments = davPath.split('/').filter(Boolean);
        if (segments.length !== 1) return null;
        const owner = segments[0]!;
        if (owner === actor.user?.username) return null;
        // Every provisioned user's home directory is a real entry and a
        // sharer is necessarily provisioned, so no directory here means no
        // share to stand in for. Checked before the share lookup so an
        // unknown name costs a 404 rather than a listing.
        if (!entry?.isDir) return null;
        // An owner who shared their whole home directory has a real listing
        // here, and it beats the virtual one.
        if (await this.#canRead(actor, davPath)) return null;

        const shares = (await this.#sharedWithMe(actor)).filter(
            (share) => share.owner?.username === owner,
        );
        if (shares.length === 0) return null;

        const responses = [propfindEntry(davPath, { name: owner }, true)];
        if (depth !== '0') {
            for (const share of shares) {
                responses.push(
                    propfindEntry(
                        `/${owner}/${share.entryUid}`,
                        {
                            name: share.name,
                            uuid: share.entryUid,
                            modified: share.modified,
                        },
                        true,
                    ),
                );
            }
        }
        return responses;
    }

    /**
     * What has been shared with the actor, for the virtual collections above.
     * One page: WebDAV has no way to ask for the next one, so a caller holding
     * more shares than {@link SHARE_LISTING_CAP} sees the oldest that many.
     *
     * Listing also teaches the request's path masker every root it returns, so
     * an entry reached through one keeps that masked prefix on the way back out
     * instead of being masked against itself.
     */
    async #sharedWithMe(actor: Actor): Promise<ResolvedShare[]> {
        const page = await this.services.share.listSharedWithMe(actor, {
            limit: SHARE_LISTING_CAP,
        });
        return page.items;
    }

    #sendMultistatus(res: Response, responses: string[]): void {
        res.status(207)
            .set({ 'Content-Type': 'application/xml; charset=utf-8' })
            .send(wrapMultistatus(responses.join('\n')));
    }

    // -- PROPPATCH (stub — acknowledges but doesn't persist props) ---

    async #proppatch(
        res: Response,
        { davPath, lockToken }: DavContext,
    ): Promise<void> {
        if (
            !(await hasWritePermission(this.clients.redis, davPath, lockToken))
        ) {
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });
        }
        res.status(207)
            .set({ 'Content-Type': 'application/xml; charset=utf-8' })
            .send(
                `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeXml(encodeURI(davPath))}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
            );
    }

    // -- MKCOL -------------------------------------------------------

    async #mkcol(
        req: Request,
        res: Response,
        { actor, davPath, lockToken }: DavContext,
    ): Promise<void> {
        if (davPath === '/')
            throw new HttpError(403, 'Cannot create at root', {
                legacyCode: 'forbidden',
            });
        if (
            req.headers['content-length'] &&
            Number(req.headers['content-length']) > 0
        ) {
            throw new HttpError(415, 'MKCOL must not have a body', {
                legacyCode: 'bad_request',
            });
        }
        if (
            !(await hasWritePermission(this.clients.redis, davPath, lockToken))
        ) {
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });
        }
        const userId = actor.user!.id as number;
        const parentPath = pathPosix.dirname(davPath);
        await this.#assertWrite(actor, parentPath);

        const existing = await this.stores.fsEntry.getEntryByPath(davPath);
        if (existing)
            throw new HttpError(405, 'Already exists', {
                legacyCode: 'bad_request',
            });

        const entry = await this.services.fs.mkdir(userId, {
            path: davPath,
        });
        this.#emitGuiEvent('outer.gui.item.added', entry);
        res.status(201)
            .set({ 'Content-Length': '0', Location: `${davPath}/` })
            .end();
    }

    // -- PUT ---------------------------------------------------------

    async #put(
        req: Request,
        res: Response,
        { actor, davPath, lockToken }: DavContext,
    ): Promise<void> {
        const name = pathPosix.basename(davPath);
        if (MACOS_JUNK_REGEX.test(name)) {
            res.status(422).send('Ignored macOS metadata file');
            return;
        }
        if (
            !(await hasWritePermission(this.clients.redis, davPath, lockToken))
        ) {
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });
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
            throw new HttpError(400, 'Missing Content-Length', {
                legacyCode: 'bad_request',
            });

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
        const modified = fe.modified ?? fe.created ?? 0;
        res.status(existing ? 204 : 201)
            .set({
                ETag: entryEtag(fe.uuid, modified),
                'Last-Modified': entryDate(modified).toUTCString(),
            })
            .end();
    }

    // -- DELETE -------------------------------------------------------

    async #delete(
        res: Response,
        { actor, davPath, lockToken }: DavContext,
    ): Promise<void> {
        if (
            !(await hasWritePermission(this.clients.redis, davPath, lockToken))
        ) {
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });
        }
        const userId = actor.user!.id as number;
        await this.#assertWrite(actor, davPath);

        const entry = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!entry)
            throw new HttpError(404, 'Not Found', { legacyCode: 'not_found' });

        await this.services.fs.remove(userId, { entry, recursive: true });
        this.#emitGuiEvent('outer.gui.item.removed', entry);
        res.status(204).end();
    }

    // -- COPY --------------------------------------------------------

    async #copy(
        req: Request,
        res: Response,
        { actor, davPath, lockToken }: DavContext,
    ): Promise<void> {
        const destPath = await this.#parseDestination(req);
        if (
            !(await hasWritePermission(this.clients.redis, destPath, lockToken))
        ) {
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });
        }

        const userId = actor.user!.id as number;
        await this.#assertRead(actor, davPath);
        await this.#assertWrite(actor, pathPosix.dirname(destPath));

        const source = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!source)
            throw new HttpError(404, 'Source not found', {
                legacyCode: 'not_found',
            });

        const overwrite = req.headers.overwrite !== 'F';
        const destExists = await this.stores.fsEntry.getEntryByPath(destPath);
        if (destExists && !overwrite)
            throw new HttpError(412, 'Destination exists and Overwrite=F', {
                legacyCode: 'conflict',
            });

        const destParent = await this.stores.fsEntry.getEntryByPath(
            pathPosix.dirname(destPath),
        );
        if (!destParent?.isDir)
            throw new HttpError(
                409,
                'Destination parent missing or not a directory',
                { legacyCode: 'dest_is_not_a_directory' },
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

    // -- MOVE --------------------------------------------------------

    async #move(
        req: Request,
        res: Response,
        { actor, davPath, lockToken }: DavContext,
    ): Promise<void> {
        const destPath = await this.#parseDestination(req);
        const r = this.clients.redis;
        if (!(await hasWritePermission(r, davPath, lockToken)))
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });
        if (!(await hasWritePermission(r, destPath, lockToken)))
            throw new HttpError(423, 'Locked', { legacyCode: 'conflict' });

        const userId = actor.user!.id as number;
        await this.#assertWrite(actor, davPath);
        await this.#assertWrite(actor, pathPosix.dirname(destPath));

        const source = await this.stores.fsEntry.getEntryByPath(davPath);
        if (!source)
            throw new HttpError(404, 'Source not found', {
                legacyCode: 'not_found',
            });

        const overwrite = req.headers.overwrite !== 'F';
        const destExists = await this.stores.fsEntry.getEntryByPath(destPath);
        if (destExists && !overwrite)
            throw new HttpError(412, 'Destination exists and Overwrite=F', {
                legacyCode: 'conflict',
            });

        const destParent = await this.stores.fsEntry.getEntryByPath(
            pathPosix.dirname(destPath),
        );
        if (!destParent?.isDir)
            throw new HttpError(
                409,
                'Destination parent missing or not a directory',
                { legacyCode: 'dest_is_not_a_directory' },
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

    // -- LOCK --------------------------------------------------------

    async #lock(
        req: Request,
        res: Response,
        { actor, davPath, lockToken: headerToken }: DavContext,
    ): Promise<void> {
        const r = this.clients.redis;

        // ACL must succeed before any lock state is touched — otherwise
        // an authenticated user could lock paths they don't own (e.g. `/`)
        // and block writes for everyone else.
        await this.#assertWrite(actor, davPath);

        // Refresh existing lock
        if (headerToken) {
            const existing = await getLockIfValid(r, headerToken);
            if (!existing)
                throw new HttpError(412, 'Lock token not found', {
                    legacyCode: 'conflict',
                });
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
                throw new HttpError(423, 'Locked — conflicting lock exists', {
                    legacyCode: 'conflict',
                });
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

    // -- UNLOCK ------------------------------------------------------

    async #unlock(
        req: Request,
        res: Response,
        { davPath }: DavContext,
    ): Promise<void> {
        const r = this.clients.redis;
        const tokenHeader = req.headers['lock-token'] as string | undefined;
        const token = extractLockToken(tokenHeader);
        if (!token)
            throw new HttpError(400, 'Missing Lock-Token header', {
                legacyCode: 'token_missing',
            });

        const lock = await getLockIfValid(r, token);
        if (!lock) {
            // Idempotent — if already expired, just 204.
            res.status(204).end();
            return;
        }
        if (lock.path !== davPath)
            throw new HttpError(403, 'Lock token does not match this path', {
                legacyCode: 'forbidden',
            });

        await deleteLock(r, token);
        res.status(204).end();
    }

    /**
     * PROPFIND responses for the virtual collection at `/<owner>/<uuid>`, or
     * null when `davPath` isn't that shape, the uuid doesn't resolve to an
     * entry of `owner`'s, or the actor cannot read the share — the caller falls
     * through to 404 in every null case, so an unauthorized probe learns
     * nothing about whether the uuid exists.
     */
    async #shareRootParentPropfind(
        actor: Actor,
        davPath: string,
        depth: string | string[],
    ): Promise<string[] | null> {
        const parsed = parseMaskedSharePath(davPath);
        if (!parsed || parsed.tail !== '') return null;
        if (parsed.ownerUsername === actor.user?.username) return null;

        const root = await this.stores.fsEntry.getEntryByUuid(parsed.rootUuid);
        if (!root) return null;
        // Same guard as resolveSharePath: the mask names the owner, so the
        // uuid must be theirs.
        if (root.path.split('/')[1] !== parsed.ownerUsername) return null;

        const allowed = await this.services.acl.check(
            actor,
            {
                path: root.path,
                resolveAncestors: () =>
                    this.services.fs.getAncestorChain(root.path),
            },
            'read',
        );
        if (!allowed) return null;

        const maskedRoot = `/${parsed.ownerUsername}/${root.uuid}/${root.name}`;
        // The uuid segment has no name of its own, so it borrows the shared
        // item's — a client that reads `displayname` shows something
        // recognizable rather than a bare uuid.
        const responses = [propfindEntry(davPath, { name: root.name }, true)];
        if (depth !== '0') {
            responses.push(propfindEntry(maskedRoot, root, root.isDir));
        }
        return responses;
    }

    // -- ACL helpers -------------------------------------------------

    async #canRead(actor: Actor, path: string): Promise<boolean> {
        return await this.services.acl.check(
            actor,
            {
                path,
                resolveAncestors: () => this.services.fs.getAncestorChain(path),
            },
            'read',
        );
    }

    async #assertRead(actor: Actor, path: string): Promise<void> {
        if (!(await this.#canRead(actor, path)))
            throw new HttpError(403, 'Permission denied', {
                legacyCode: 'permission_denied',
            });
    }

    async #assertWrite(actor: Actor, path: string): Promise<void> {
        const descriptor = {
            path,
            resolveAncestors: () => this.services.fs.getAncestorChain(path),
        };
        const ok = await this.services.acl.check(actor, descriptor, 'write');
        if (!ok)
            throw new HttpError(403, 'Permission denied', {
                legacyCode: 'permission_denied',
            });
    }

    // -- Event emission ----------------------------------------------

    #emitGuiEvent<T extends keyof EventMap>(
        eventName: T,
        entry: FSEntry,
        extra?: Record<string, unknown>,
    ): void {
        const meta = {};
        void Promise.resolve()
            .then(async () => {
                const response = {
                    ...(await toLegacyEntry(this.clients.event, entry)),
                    ...extra,
                    from_new_service: true,
                };
                this.clients.event.emit(
                    eventName,
                    {
                        user_id_list: [entry.userId],
                        response,
                    } as unknown as EventMap[T],
                    meta,
                );
            })
            .catch(() => {
                // non-critical
            });
    }

    // -- Misc helpers ------------------------------------------------

    async #parseDestination(req: Request): Promise<string> {
        const dest = req.headers.destination as string | undefined;
        if (!dest)
            throw new HttpError(400, 'Missing Destination header', {
                legacyCode: 'bad_request',
            });
        let raw: string;
        try {
            const url = new URL(dest, `http://${req.headers.host}`);
            raw = decodeURIComponent(url.pathname);
        } catch {
            raw = decodeURIComponent(dest);
        }
        // The destination is addressed the same way as the request path, so a
        // client that browsed into a share names its target the same way too.
        return resolveSharePath(this.stores.fsEntry, Context.get('actor'), raw);
    }
}

// -- Middleware helpers -----------------------------------------------

/**
 * Answer a CORS preflight before anything can reject it. True when this request
 * was one and has been answered.
 *
 * A browser sends a credential-less `OPTIONS` ahead of any cross-origin
 * PROPFIND/GET/PUT and treats a non-2xx reply as a failed preflight, never
 * sending the real request. The authenticated OPTIONS path answers 401, which
 * blocked every browser DAV client — the VS Code app's mount included — before
 * it could present a token.
 *
 * Only an actual preflight is answered here: it's the one OPTIONS that carries
 * `Access-Control-Request-Method`. A native client's plain OPTIONS still goes
 * through auth, so macOS keeps getting the 401-with-`DAV:` reply it opens a
 * mount with.
 */
function answerPreflight(req: Request, res: Response): boolean {
    if (!req.headers.origin || !req.headers['access-control-request-method']) {
        return false;
    }
    // `Allow-Origin`/`-Methods`/`-Headers` were set on the way in by the
    // server's CORS middleware. `Max-Age` is what belongs here specifically:
    // without it a browser re-preflights every URL every few seconds, doubling
    // the request count of a mount and its share of the DAV rate limit.
    res.status(200)
        .set({
            ...DAV_HEADERS,
            Allow: ALLOW_METHODS,
            'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
            'Content-Length': '0',
        })
        .end();
    return true;
}

/** DAV clients read a status and a plain-text reason, not our JSON error shape. */
function sendDavError(res: Response, err: unknown): void {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
        res.status(err.statusCode).send(err.message);
        return;
    }
    console.error('[webdav] unhandled error', err);
    res.status(500).send('Internal Server Error');
}

// -- XML helpers ------------------------------------------------------

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

/**
 * FSEntry timestamps are Unix seconds. Entries with nothing stored fall back to
 * an ISO string literal, so both forms have to be accepted here.
 */
function toEpochSeconds(ts: number | string): number {
    return typeof ts === 'number'
        ? Math.floor(ts)
        : Math.floor(new Date(ts).getTime() / 1000);
}

/** `Date` takes milliseconds, so entry seconds must be scaled to format them. */
function entryDate(ts: number | string): Date {
    return new Date(toEpochSeconds(ts) * 1000);
}

/**
 * Opaque validator. Built from seconds so every verb emits the same ETag for an
 * entry — a client that gets one value from PROPFIND and another from GET
 * treats the resource as changed and re-fetches it on every pass.
 */
function entryEtag(uid: string, ts: number | string): string {
    return `"${uid}-${toEpochSeconds(ts)}"`;
}

/**
 * What a `<D:response>` needs to describe one resource. An {@link FSEntry}
 * satisfies it; the virtual collections a share mask invents pass whatever they
 * know, which is sometimes only a name.
 */
type PropfindTarget = Partial<
    Pick<FSEntry, 'name' | 'uuid' | 'modified' | 'created' | 'size'>
>;

function propfindEntry(
    href: string,
    entry: PropfindTarget | null,
    isDir: boolean,
): string {
    const encodedHref =
        encodeURI(href) + (isDir && !href.endsWith('/') ? '/' : '');
    const modified =
        entry?.modified ?? entry?.created ?? '2025-01-01T00:00:00Z';
    const created = entry?.created ?? '2025-01-01T00:00:00Z';
    const name = entry?.name ?? (pathPosix.basename(href) || '/');
    const uid = entry?.uuid ?? 'root';

    let props = `
        <D:displayname>${escapeXml(String(name))}</D:displayname>
        <D:getlastmodified>${entryDate(modified).toUTCString()}</D:getlastmodified>
        <D:creationdate>${entryDate(created).toISOString()}</D:creationdate>
        <D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getetag>${entryEtag(uid, modified)}</D:getetag>
        <D:supportedlock>
          <D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>
          <D:lockentry><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>
        </D:supportedlock>
        <D:lockdiscovery/>
        <D:ishidden>0</D:ishidden>`;

    if (!isDir && entry) {
        props += `\n        <D:getcontentlength>${entry.size ?? 0}</D:getcontentlength>`;
        const mime = mimeFromExt(pathPosix.extname(name));
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
