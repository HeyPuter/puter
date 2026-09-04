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

import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Actor } from '../../core/actor.js';
import { isAccessTokenActor, isAppActor } from '../../core/actor.js';
import {
    assertNotSuspended,
    assertVerifiedAccount,
} from '../../core/http/middleware/gates.js';
import {
    CONCURRENT_SLOT_TTL_MS,
    acquireConcurrent,
    checkRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import { PRESENCE_NO_APP } from '../../stores/events/PresenceStore.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../metering/consts.js';
import type { AuthResult, AuthService } from '../auth/AuthService.js';
import { PuterService } from '../types.js';

export type SocketReauthError = Error & { data: Record<string, unknown> };

/**
 * Build a `reauth_required` error for the socket auth middleware to pass to
 * `next()`. Exported for unit testing.
 */
export const buildSocketReauthError = (reauth: {
    reason: string;
    auth_id?: string;
}): SocketReauthError => {
    const err = new Error('reauth_required') as SocketReauthError;
    err.data = {
        code: 'reauth_required',
        reason: reauth.reason,
        ...(reauth.auth_id ? { auth_id: reauth.auth_id } : {}),
    };
    return err;
};

/** Pure decision from an `AuthResult` to a socket-side accept/reject. */
export type SocketAuthDecision = { accept: Actor } | { reject: Error };

export interface SocketAuthOptions {
    /**
     * Whether an app-under-user actor may hold a connection. Off, the handshake
     * is exactly what it has always been. On, an app socket is admitted — into
     * its own room and nothing else (see `socketRoomsFor`).
     */
    allowAppActors?: boolean;
}

/**
 * Map an `AuthService.authenticate()` result onto the socket-handshake verdict.
 * Order matters:
 *
 * 1. `reauth` → structured `reauth_required` error so the client can drive the
 *    same migration / re-login flow it does for HTTP.
 * 2. Missing actor → generic `socket auth failed`.
 * 3. Access-token actor → rejected, always. App-under-user actor → rejected unless
 *    `allowAppActors`, since a subscription feed is the only thing an app
 *    connection is for.
 * 4. Suspended, or pending a verification → rejected. A socket carries the same
 *    filesystem entries, upload paths and notification bodies as the HTTP
 *    routes, which get these two from `requireAuthGate` /
 *    `requireVerifiedAccount`; the handshake is not in that chain, so it has to
 *    apply them itself.
 * 5. Otherwise → accept the actor.
 *
 * Pure / no side effects — the middleware logs the reauth event.
 */
export const decideSocketAuth = (
    result: AuthResult,
    options: SocketAuthOptions = {},
): SocketAuthDecision => {
    if (result.reauth) {
        return { reject: buildSocketReauthError(result.reauth) };
    }
    const actor = result.actor;
    if (!actor || !actor.user) {
        return { reject: new Error('socket auth failed') };
    }
    if (
        isAccessTokenActor(actor) ||
        (isAppActor(actor) && !options.allowAppActors)
    ) {
        return { reject: new Error('socket auth: only user tokens accepted') };
    }
    try {
        assertNotSuspended(actor.user);
        assertVerifiedAccount(actor.user);
    } catch (err) {
        return {
            reject:
                err instanceof Error ? err : new Error('socket auth failed'),
        };
    }
    return { accept: actor };
};

/**
 * Socket push target. A `room` fans to every socket in that room; a `socket`
 * targets one specific socket by id. Multiple specifiers may be passed as an
 * array.
 */
export interface SocketSpecifier {
    room?: string | number;
    socket?: string;
}

/** The room an app-under-user socket receives its own deliveries in. */
export const appSocketRoom = (
    userId: number | string,
    appUid: string,
): string => `u${userId}:a${appUid}`;

/**
 * A room every one of an account's sockets joins and nothing is ever emitted
 * to. The user room is what a session revoke drops, and an app socket is
 * deliberately not in it — this is the handle that reaches those.
 */
export const accountSocketRoom = (userId: number | string): string =>
    `u${userId}:all`;

/**
 * Which rooms a socket joins. An app socket gets its own per-(user, app) room
 * and never the user room, which carries the whole `outer.gui.*` fan and is the
 * reason app actors were refused outright.
 */
export const socketRoomsFor = (actor: Actor): string[] => {
    const userId = String(actor.user!.id);
    const appUid = isAppActor(actor) ? actor.app?.uid : undefined;
    return [
        appUid ? appSocketRoom(userId, appUid) : userId,
        accountSocketRoom(userId),
    ];
};

// -- Redis key format for cross-node FS-cache invalidation ----------
//
// puter-js (browser) polls `GET /cache/last-change-timestamp` and purges
// its in-memory FS cache when the server's timestamp is ≥ ~2s ahead of
// the tab's local clock. We bump this key on every `outer.gui.item.*`
// mutation, so a write on node A invalidates puter-js caches in tabs
// connected to node B.
//
// 30-day TTL so dormant users' keys GC themselves. Active users keep
// rewriting the key, so the TTL never fires for them.
const LAST_CHANGE_KEY_PREFIX = 'fs:last-change:';
const LAST_CHANGE_TTL_SECONDS = 60 * 60 * 24 * 30;

// Bump the per-user `fs:last-change` Redis key only on item-mutation
// events — `cache.updated` and similar are themselves notifications
// ABOUT the timestamp, so re-bumping on them is wasted work.
const ITEM_MUTATION_PREFIX = 'outer.gui.item.';

interface OuterGuiPayload {
    user_id_list?: Array<number | string>;
    response: unknown;
}

interface UploadProgressPayload {
    upload_tracker: {
        total_: number;
        progress_: number;
        sub: (callback: (delta: number) => void) => void;
    };
    meta?: Record<string, unknown>;
}

/**
 * Extend the socket.io `Socket` with the actor attached by our auth middleware.
 * Using the module-augmentation pattern keeps callers typed without casts.
 */
interface AuthenticatedSocket extends Socket {
    actor?: Actor;
    /**
     * The handshake token, kept for the periodic re-check. On the socket
     * instance rather than in `socket.data`, which the adapter serializes to
     * other nodes — a session token has no business travelling over it.
     */
    authToken?: string;
}

/**
 * Socket.io wrapper with:
 *
 * 1. Auth middleware — reads `handshake.auth.auth_token`, validates it via
 *    `AuthService`, rejects access-token actors (and app-under-user actors
 *    unless events are enabled), and joins the socket to its room: the per-user
 *    room keyed by `user.id` for a session, a per-(user, app) room for an app.
 * 2. Event bus → socket fan-out — subscribes to the known set of `outer.gui.*`
 *    mutation events and pushes each to the affected users' rooms. Strips the
 *    `outer.gui.` prefix before emitting.
 * 3. FS cache-invalidation timestamp — bumps a per-user Redis key on every
 *    mutation so puter-js running on a different node (or a different tab) can
 *    detect staleness on its next poll of `/cache/last-change-timestamp`.
 *
 * Cross-node fan-out comes free via `@socket.io/redis-streams-adapter`:
 * `send()` on any node reaches every socket for that room cluster-wide.
 */
export class SocketService extends PuterService {
    #io: SocketIOServer | null = null;
    #reauthTimer: ReturnType<typeof setInterval> | null = null;

    // -- Lifecycle ---------------------------------------------------

    /**
     * Called by `PuterServer` after the http server is created but before it
     * starts listening. Attaches socket.io, wires auth, subscribes to the event
     * bus. Sync — no await on the caller side is required, but we accept a
     * Promise return for symmetry.
     */
    attachHttpServer(server: HttpServer): void {
        // ioredis Cluster is compatible with the redis-streams adapter.
        const adapter = createAdapter(this.clients.redis as unknown as never);

        // Restrict the upgrade-host to puter.com + api.puter.com (or
        // whatever `config.domain` resolves to). Wildcard-DNS-served
        // user sites at `*.puter.site` go to the same backend, but
        // socket.io has no business answering there. CORS reflector
        // stays wide — any *origin* may connect from those gated hosts.
        const allowedHosts = this.#allowedSocketHosts();

        this.#io = new SocketIOServer(server, {
            cors: {
                // Reflect whatever origin the client sent back.
                // credentials:true means clients can send cookies.
                origin: (origin, callback) => callback(null, origin ?? '*'),
                credentials: true,
            },
            allowRequest: (req, callback) => {
                const rawHost = req.headers.host ?? '';
                const host = rawHost.split(':')[0].toLowerCase();
                if (allowedHosts.has(host)) {
                    callback(null, true);
                    return;
                }
                callback('socket.io: host not allowed', false);
            },
            adapter,
        });

        this.#installAuthMiddleware();
        this.#installConnectionHandler();
        this.#subscribeEventBus();
        this.#installReauthLoop();
    }

    /**
     * Hostnames permitted to upgrade to a socket connection. Built from
     * `config.domain` (e.g. `puter.com` → allows `puter.com` +
     * `api.puter.com`). Subdomain user-sites and other wildcard-served
     * hostnames are not in this set.
     */
    #allowedSocketHosts(): Set<string> {
        const domain = (this.config.domain ?? '').toLowerCase().trim();
        if (!domain) return new Set();
        return new Set([domain, `api.${domain}`]);
    }

    override onServerPrepareShutdown(): Promise<void> {
        if (this.#reauthTimer) {
            clearInterval(this.#reauthTimer);
            this.#reauthTimer = null;
        }
        // Close the io server so existing sockets disconnect cleanly
        // before http's close() starts waiting for connections.
        return new Promise<void>((resolve) => {
            if (!this.#io) return resolve();
            this.#io.close(() => resolve());
        });
    }

    // -- Public API (used by other services / controllers) ----------

    /**
     * Push an event to one or more specifiers. `room` targets every socket
     * joined to that room (we use `user.id` as the room name), `socket` targets
     * one specific socket by id.
     */
    async send(
        specifiers: SocketSpecifier | SocketSpecifier[],
        key: string,
        data: unknown,
    ): Promise<void> {
        if (!this.#io) return;
        const list = Array.isArray(specifiers) ? specifiers : [specifiers];
        for (const spec of list) {
            if (spec.room !== undefined) {
                this.#io.to(String(spec.room)).emit(key, data);
            } else if (spec.socket) {
                this.#io.to(spec.socket).emit(key, data);
            }
        }
    }

    /**
     * Check whether the specifier currently resolves to at least one live
     * socket on _this_ node. Note: doesn't check other cluster nodes — intended
     * for best-effort local checks only.
     */
    has(specifier: SocketSpecifier): boolean {
        if (!this.#io) return false;
        if (specifier.room !== undefined) {
            const room = this.#io.sockets.adapter.rooms.get(
                String(specifier.room),
            );
            return !!room && room.size > 0;
        }
        if (specifier.socket) {
            return this.#io.sockets.sockets.has(specifier.socket);
        }
        return false;
    }

    /** True once `attachHttpServer` has wired up the io instance. */
    hasIO(): boolean {
        return this.#io !== null;
    }

    /**
     * Read the last-change timestamp for a user from Redis. Returns 0 when
     * unset. Called by `LegacyFSController`'s `/cache/last-change-timestamp`
     * route.
     */
    async getLastChangeTimestamp(userId: number | string): Promise<number> {
        try {
            const raw = await this.clients.redis.get(
                `${LAST_CHANGE_KEY_PREFIX}${userId}`,
            );
            if (!raw) return 0;
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        } catch {
            return 0;
        }
    }

    // -- Auth + connection wiring -----------------------------------

    /**
     * An app connection exists to carry event subscriptions, so it is admitted
     * only where those are switched on.
     */
    #authOptions(): SocketAuthOptions {
        return { allowAppActors: this.config.events?.enabled === true };
    }

    #installAuthMiddleware(): void {
        if (!this.#io) return;
        const authService = this.services.auth as AuthService | undefined;
        if (!authService) {
            console.warn(
                '[socket] AuthService unavailable — sockets will reject all connections',
            );
        }

        this.#io.use(async (socket: AuthenticatedSocket, next) => {
            // socket.io's conventional location for handshake auth is
            // `{ auth: { ... } }`, not the query string. puter-js uses
            // `io(url, { auth: { auth_token } })`.
            const handshakeAuth = socket.handshake.auth as
                | Record<string, unknown>
                | undefined;
            const tokenRaw =
                typeof handshakeAuth?.auth_token === 'string'
                    ? handshakeAuth.auth_token
                    : undefined;

            if (!tokenRaw) {
                next(new Error('socket auth token missing'));
                return;
            }
            const token = tokenRaw.replace(/^Bearer\s+/i, '').trim();
            if (!token) {
                next(new Error('socket auth token empty'));
                return;
            }
            if (!authService) {
                next(new Error('socket auth unavailable'));
                return;
            }

            try {
                const handshakeHeaders =
                    (socket.handshake.headers as
                        | Record<string, string | string[] | undefined>
                        | undefined) ?? {};
                const uaHeader = handshakeHeaders['user-agent'];
                const userAgent = Array.isArray(uaHeader)
                    ? uaHeader[0]
                    : uaHeader;
                const result = await authService.authenticate(token, {
                    ip: socket.handshake.address,
                    userAgent: userAgent ?? undefined,
                });

                if (result.reauth) {
                    console.info(
                        `[auth-v2] reauth reason=${result.reauth.reason} auth_id=${result.reauth.auth_id ?? '-'} (ws)`,
                    );
                }

                const decision = decideSocketAuth(result, this.#authOptions());
                if ('reject' in decision) {
                    next(decision.reject);
                    return;
                }

                socket.actor = decision.accept;
                socket.authToken = token;
                // user.id is numeric in the DB; stringify for room name
                // so adapter lookups key on a stable type.
                socket.join(socketRoomsFor(decision.accept));
                next();
            } catch (err) {
                console.warn('[socket] auth error', err);
                next(
                    err instanceof Error
                        ? err
                        : new Error('socket auth failed'),
                );
            }
        });
    }

    /**
     * Client events don't pass through the HTTP middleware chain, so the route
     * gates never see them. Both handlers below fan out to other sockets or
     * onto the event bus, and a client can emit as fast as the connection
     * allows — so each one gets its own window via the imperative helper. Per
     * (user, event), matching how the route gates bucket by actor.
     */
    static SOCKET_EVENT_LIMIT = 60;
    static SOCKET_EVENT_WINDOW_MS = 60_000;

    /**
     * Simultaneous connections per user, across every node. A connection costs
     * an adapter room membership and a slot on whichever node terminates it,
     * and nothing bounded how many a single account could hold open.
     *
     * Sized for an account, not a browser. One person is routinely several
     * windows across several machines, a phone that reconnects on every
     * foreground, and anything embedding the SDK against their session — and
     * the cost of one connection is small enough that being generous here is
     * cheaper than being wrong. This is the backstop against an account opening
     * connections without bound; `MAX_SOCKETS_PER_ORIGIN` is what keeps any one
     * page from spending the whole account allowance.
     */
    static MAX_SOCKETS_PER_USER = 400;
    static MAX_SOCKETS_BY_SUBSCRIPTION: Record<string, number> = {
        [DEFAULT_FREE_SUBSCRIPTION]: 200,
        [DEFAULT_TEMP_SUBSCRIPTION]: 100,
    };

    /**
     * Simultaneous connections per (user, origin).
     *
     * The natural split would be per app, but most sockets have no app to key
     * on — a session carries none, and an app connection is the minority case.
     * The requesting origin covers both: it separates our own pages from a
     * third-party site embedding the SDK against the same session, and an app
     * connects from its own origin. Without it a single looping page consumes
     * the account's whole allowance and takes every other window offline.
     *
     * A browser sets `Origin` itself, so a page can't lie about its own; a
     * non-browser client can put anything there, which is exactly why the
     * per-user total above still applies and is the real bound.
     */
    static MAX_SOCKETS_PER_ORIGIN = 150;

    async #socketLimitFor(actor: Actor): Promise<number> {
        const base = SocketService.MAX_SOCKETS_PER_USER;
        try {
            const sub =
                await this.services.metering.getActorSubscription(actor);
            return SocketService.MAX_SOCKETS_BY_SUBSCRIPTION[sub.id] ?? base;
        } catch {
            // Same policy as the route gates: a failure to resolve the tier
            // falls through to the base rather than tightening.
            return base;
        }
    }

    /**
     * Bucket a handshake by requesting origin. Everything without one — a
     * non-browser client, a same-origin request that omits the header — shares
     * a single bucket rather than each getting a private allowance.
     */
    static socketOriginKey(socket: AuthenticatedSocket): string {
        const raw = socket.handshake?.headers?.origin;
        const origin = Array.isArray(raw) ? raw[0] : raw;
        return typeof origin === 'string' && origin.length > 0
            ? origin.slice(0, 128)
            : 'none';
    }

    /**
     * Take a per-origin and a per-account slot for one connection, and hold
     * both until it closes.
     *
     * Connections routinely outlive `CONCURRENT_SLOT_TTL_MS` — a desktop left
     * open all day is the normal case, not the exception — and a slot that old
     * is indistinguishable from one a dead process abandoned. Renewing on a
     * timer is what tells the two apart; without it the sweep reclaims live
     * connections and the cap quietly stops counting exactly the long-lived
     * ones it exists for.
     */
    async #admitConnection(
        socket: AuthenticatedSocket,
        actor: Actor,
        userId: number,
    ): Promise<void> {
        const originKey = SocketService.socketOriginKey(socket);
        const slots: {
            release: () => Promise<void>;
            renew: () => Promise<void>;
        }[] = [];

        const reject = async () => {
            await Promise.all(slots.map((s) => s.release()));
            socket.disconnect(true);
        };

        const perOrigin = await acquireConcurrent(
            `socket:conn:${userId}:${originKey}`,
            SocketService.MAX_SOCKETS_PER_ORIGIN,
        );
        if (!perOrigin.ok) return void (await reject());
        slots.push(perOrigin);

        const perUser = await acquireConcurrent(
            `socket:conn:${userId}`,
            await this.#socketLimitFor(actor),
        );
        if (!perUser.ok) return void (await reject());
        slots.push(perUser);

        // A third of the window: two renewals may be missed (a paused timer, a
        // slow backend) before a live slot looks abandoned.
        const appUid = actor.effectiveApp?.uid ?? PRESENCE_NO_APP;
        const renewTimer = setInterval(
            () => {
                void Promise.all(slots.map((s) => s.renew()));
                // Presence bookkeeping lapses the same way a slot does if
                // nothing refreshes it, and this is the only timer that runs
                // for as long as a socket does. A no-op with no peers
                // configured, which is where presence costs nothing at all.
                void this.services.eventForward
                    ?.touchPresence(userId, appUid)
                    .catch((err: unknown) => {
                        console.warn('[socket] presence touch failed', err);
                    });
            },
            Math.floor(CONCURRENT_SLOT_TTL_MS / 3),
        );
        renewTimer.unref?.();

        const finish = () => {
            clearInterval(renewTimer);
            void Promise.all(slots.map((s) => s.release()));
        };
        socket.once('disconnect', finish);
        // The socket may already be gone by the time the tier lookup resolved;
        // don't strand the slots until they age out.
        if (socket.disconnected) finish();
    }

    // -- Keeping a live connection honest ----------------------------
    //
    // The handshake is the only place a socket's credential was ever checked,
    // and a connection outlives it indefinitely — a desktop tab stays up for
    // days. Two mechanisms close that gap: an eviction on revoke for the paths
    // that know a session ended, and a periodic re-check for everything that
    // changes without touching `sessions` (a bulk suspension, a verification
    // requirement added by the abuse harness).

    /** How often a live socket's credential is re-verified. */
    static REAUTH_INTERVAL_MS = 5 * 60_000;

    /**
     * Drop every socket on this node whose token no longer authenticates to the
     * same accepted actor. De-duplicated by token: one browser's tabs share a
     * session, so a sweep costs one check per credential, not per connection.
     *
     * Driven by the interval below; public because that timer isn't drivable
     * from a test.
     */
    async reauthenticateSockets(): Promise<void> {
        const io = this.#io;
        const authService = this.services.auth as AuthService | undefined;
        if (!io || !authService) return;

        const decisions = new Map<string, SocketAuthDecision>();
        for (const raw of io.sockets.sockets.values()) {
            const socket = raw as AuthenticatedSocket;
            const token = socket.authToken;
            // Nothing to re-check against — it can't be shown to still be
            // valid, so it goes.
            if (!token) {
                socket.disconnect(true);
                continue;
            }
            let decision = decisions.get(token);
            if (!decision) {
                try {
                    decision = decideSocketAuth(
                        await authService.authenticate(token, {}),
                        this.#authOptions(),
                    );
                } catch {
                    decision = { reject: new Error('socket reauth failed') };
                }
                decisions.set(token, decision);
            }
            if ('reject' in decision) {
                socket.disconnect(true);
                continue;
            }
            // Refresh the actor so anything reading it off the socket sees the
            // current row rather than the one from connect time.
            socket.actor = decision.accept;
        }
    }

    #installReauthLoop(): void {
        const timer = setInterval(() => {
            void this.reauthenticateSockets().catch((err: unknown) => {
                console.error('[socket] reauth sweep failed', err);
            });
        }, SocketService.REAUTH_INTERVAL_MS);
        timer.unref?.();
        this.#reauthTimer = timer;
    }

    /**
     * Close a user's connections after any of their sessions was revoked.
     * Cluster-wide: `disconnectSockets` publishes through the adapter, so a
     * revoke handled on one node reaches sockets terminated on another.
     *
     * Every connection for the account goes, not just the revoked session's —
     * which is what the account room is for, since an app socket is not in the
     * user room. Narrowing would mean matching each socket to its session via
     * `fetchSockets`, which the adapter implements on top of `serverCount()` —
     * and that path is unavailable with our Redis client. Dropping the room is
     * the safe direction: a connection whose session survived reconnects on its
     * own, and its handshake re-authenticates.
     */
    async #evictUserSockets(userId: number): Promise<void> {
        const io = this.#io;
        if (!io || !userId) return;
        await io.in(accountSocketRoom(userId)).disconnectSockets(true);
    }

    async #allowSocketEvent(userId: number, event: string): Promise<boolean> {
        return checkRateLimit(
            `socket:${event}:${userId}`,
            SocketService.SOCKET_EVENT_LIMIT,
            SocketService.SOCKET_EVENT_WINDOW_MS,
        );
    }

    #installConnectionHandler(): void {
        if (!this.#io) return;

        this.#io.on('connection', (socket: AuthenticatedSocket) => {
            const actor = socket.actor;
            // The id is what both limits below bucket on, so a user without
            // one has nothing to key against.
            if (!actor || actor.user?.id === undefined) return;
            const userId = actor.user.id;
            const userRoom = String(userId);

            // Hold slots for the life of the connection. Released on
            // `disconnect`, which socket.io fires for clean closes, transport
            // errors, and server-side disconnects alike — so an abandoned
            // connection gives its slots back the same way a closed one does.
            void this.#admitConnection(socket, actor, userId);

            // Subscription verbs and the disconnect reaping that goes with
            // them. Off unless events are enabled, in which case the verbs
            // answer with `events_disabled` rather than going unanswered.
            this.services.events.attachSocket(socket, actor);

            // Everything below is the desktop session's own traffic: two verbs
            // that reach the user's other tabs, and a connect announcement
            // whose listeners read it as "the UI is up". An app connection is
            // none of those things.
            if (isAppActor(actor)) return;

            // Peer-echo: one tab notifies others that trash is empty.
            socket.on('trash.is_empty', (msg: unknown) => {
                void this.#allowSocketEvent(userId, 'trash.is_empty').then(
                    (ok) => {
                        if (!ok) return;
                        socket.broadcast
                            .to(userRoom)
                            .emit('trash.is_empty', msg);
                    },
                );
            });

            // Legacy probe some frontends use to signal "the UI is
            // really up, not just a health-check connection". Extensions
            // sometimes listen for the follow-up event.
            socket.on('puter_is_actually_open', () => {
                void this.#allowSocketEvent(
                    userId,
                    'puter_is_actually_open',
                ).then((ok) => {
                    if (!ok) return;
                    this.clients.event.emit(
                        'web.socket.user-connected',
                        {
                            socket,
                            user: actor.user,
                        },
                        {},
                    );
                });
            });

            // Fire-and-forget connect event.
            this.clients.event.emit(
                'web.socket.connected',
                {
                    socket,
                    user: actor.user,
                },
                {},
            );
        });
    }

    // -- Event bus → socket fan-out ----------------------------------

    #subscribeEventBus(): void {
        // One wildcard subscriber covers every `outer.gui.*` mutation +
        // notification (item.added/updated/removed/moved/pending,
        // cache.updated, submission.done, …). EventClient walks the
        // dot-prefix tree at emit time so we get them all.
        this.clients.event.on('outer.gui.*', (key: string, data: unknown) => {
            this.#handleOuterGui(key, data as OuterGuiPayload).catch(
                (err: unknown) => {
                    console.error('[socket] outer.gui handler error', err);
                },
            );
        });

        // Upload progress — each tracker fires `.sub()` callbacks as
        // bytes flow.
        this.clients.event.on(
            'fs.storage.upload-progress',
            (_key: string, data: unknown) => {
                this.#handleUploadProgress(data as UploadProgressPayload);
            },
        );

        this.clients.event.on(
            'auth.sessions.revoked',
            (_key: string, data: unknown) => {
                const { user_id } = data as { user_id: number };
                this.#evictUserSockets(user_id).catch((err: unknown) => {
                    console.error('[socket] session eviction failed', err);
                });
            },
        );
    }

    async #handleOuterGui(key: string, data: OuterGuiPayload): Promise<void> {
        const userIds = data.user_id_list ?? [];
        if (userIds.length === 0) return;

        // Event bus names are `outer.gui.item.removed` etc.; the wire
        // name the client listens for is `item.removed` etc.
        const wireName = key.startsWith('outer.gui.')
            ? key.slice('outer.gui.'.length)
            : key;
        // Only item-mutation events should bump the cache-invalidation
        // timestamp — `cache.updated` is itself a notification ABOUT the
        // timestamp, re-bumping on it is wasted work.
        const isMutation = key.startsWith(ITEM_MUTATION_PREFIX);

        const fanout = userIds.map(async (userId) => {
            await this.send({ room: userId }, wireName, data.response);
            // Post-send hook: listeners (e.g. NotificationService marking notif
            // delivery) can react after each per-user fan-out.
            this.clients.event.emit(
                `sent-to-user.${wireName}`,
                {
                    user_id: userId as number,
                    response: data.response,
                },
                {},
            );
            if (isMutation) {
                const timestamp = Date.now();
                await this.#bumpLastChange(userId, timestamp);
                // Push `cache.updated` as a wire event so connected tabs
                // invalidate their FS cache immediately (originator filters
                // by `original_client_socket_id` to avoid self-refetch).
                // Without this, other tabs only learn about the change on
                // their next poll of /cache/last-change-timestamp.
                const originalSocketId = (
                    data.response as
                        | { original_client_socket_id?: string }
                        | undefined
                )?.original_client_socket_id;
                await this.send({ room: userId }, 'cache.updated', {
                    timestamp,
                    original_client_socket_id: originalSocketId,
                });
            }
        });
        await Promise.all(fanout);
    }

    #handleUploadProgress(data: UploadProgressPayload): void {
        const meta = data.meta ?? {};
        const userId = (meta.user_id ?? meta.userId) as
            | number
            | string
            | undefined;
        if (!userId) {
            console.warn('[socket] upload-progress missing user_id', { meta });
            return;
        }
        const wireName = meta.call_it_download
            ? 'download.progress'
            : 'upload.progress';
        const tracker = data.upload_tracker;

        tracker.sub((delta) => {
            void this.send({ room: userId }, wireName, {
                ...meta,
                total: tracker.total_,
                loaded: tracker.progress_,
                loaded_diff: delta,
            });
        });
    }

    async #bumpLastChange(
        userId: number | string,
        timestamp: number,
    ): Promise<void> {
        try {
            await this.clients.redis.set(
                `${LAST_CHANGE_KEY_PREFIX}${userId}`,
                String(timestamp),
                'EX',
                LAST_CHANGE_TTL_SECONDS,
            );
        } catch (err) {
            // Redis write failures shouldn't break the socket send —
            // worst case is a stale puter-js cache on another tab.
            console.warn('[socket] failed to bump last-change timestamp', err);
        }
    }
}
