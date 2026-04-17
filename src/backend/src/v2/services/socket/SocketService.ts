import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Actor } from '../../core/actor.js';
import { isAppActor, isAccessTokenActor } from '../../core/actor.js';
import { PuterService } from '../types.js';
import type { AuthService } from '../auth/AuthService.js';

/**
 * Socket push target. A `room` fans to every socket in that room; a
 * `socket` targets one specific socket by id. Multiple specifiers may
 * be passed as an array.
 */
export interface SocketSpecifier {
    room?: string | number;
    socket?: string;
}

// ── Redis key format for cross-node FS-cache invalidation ──────────
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
 * Extend the socket.io `Socket` with the actor attached by our auth
 * middleware. Using the module-augmentation pattern keeps callers
 * typed without casts.
 */
interface AuthenticatedSocket extends Socket {
    actor?: Actor;
}

/**
 * socket.io wrapper with:
 *
 * 1. Auth middleware — reads `handshake.auth.auth_token`, validates it
 *    via `AuthService`, rejects anything other than plain user actors
 *    (no app-under-user, no access-token), and joins the socket to a
 *    per-user room keyed by `user.id`.
 *
 * 2. Event bus → socket fan-out — subscribes to the known set of
 *    `outer.gui.*` mutation events and pushes each to the affected
 *    users' rooms. Strips the `outer.gui.` prefix before emitting.
 *
 * 3. FS cache-invalidation timestamp — bumps a per-user Redis key on
 *    every mutation so puter-js running on a different node (or a
 *    different tab) can detect staleness on its next poll of
 *    `/cache/last-change-timestamp`.
 *
 * Cross-node fan-out comes free via `@socket.io/redis-streams-adapter`:
 * `send()` on any node reaches every socket for that room cluster-wide.
 *
 * Shape mirrors v1's `SocketioService` + `WSPushService`, collapsed into
 * one file because v2's FS controllers already emit shaped payloads —
 * v1's heavy `node.getSafeEntry()` transformations aren't needed.
 */
export class SocketService extends PuterService {
    #io: SocketIOServer | null = null;

    // ── Lifecycle ───────────────────────────────────────────────────

    /**
     * Called by `PuterServer` after the http server is created but
     * before it starts listening. Attaches socket.io, wires auth,
     * subscribes to the event bus. Sync — no await on the caller side
     * is required, but we accept a Promise return for symmetry.
     */
    attachHttpServer (server: HttpServer): void {
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
                // Reflect whatever origin the client sent back — same as
                // v1. credentials:true means clients can send cookies.
                origin: (origin, callback) => callback(null, origin ?? '*'),
                credentials: true,
            },
            allowRequest: (req, callback) => {
                const rawHost = req.headers.host ?? '';
                const host = rawHost.split(':')[0].toLowerCase();
                if ( allowedHosts.has(host) ) {
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
    }

    /**
     * Hostnames permitted to upgrade to a socket connection. Built from
     * `config.domain` (e.g. `puter.com` → allows `puter.com` +
     * `api.puter.com`). Subdomain user-sites and other wildcard-served
     * hostnames are not in this set.
     */
    #allowedSocketHosts (): Set<string> {
        const domain = (this.config.domain ?? '').toLowerCase().trim();
        if ( ! domain ) return new Set();
        return new Set([domain, `api.${domain}`]);
    }

    override onServerPrepareShutdown (): Promise<void> {
        // Close the io server so existing sockets disconnect cleanly
        // before http's close() starts waiting for connections.
        return new Promise<void>((resolve) => {
            if ( ! this.#io ) return resolve();
            this.#io.close(() => resolve());
        });
    }

    // ── Public API (used by other services / controllers) ──────────

    /**
     * Push an event to one or more specifiers. `room` targets every
     * socket joined to that room (we use `user.id` as the room name),
     * `socket` targets one specific socket by id.
     */
    async send (
        specifiers: SocketSpecifier | SocketSpecifier[],
        key: string,
        data: unknown,
    ): Promise<void> {
        if ( ! this.#io ) return;
        const list = Array.isArray(specifiers) ? specifiers : [specifiers];
        for ( const spec of list ) {
            if ( spec.room !== undefined ) {
                this.#io.to(String(spec.room)).emit(key, data);
            } else if ( spec.socket ) {
                this.#io.to(spec.socket).emit(key, data);
            }
        }
    }

    /**
     * Check whether the specifier currently resolves to at least one
     * live socket on *this* node. Note: doesn't check other cluster
     * nodes — intended for best-effort local checks only.
     */
    has (specifier: SocketSpecifier): boolean {
        if ( ! this.#io ) return false;
        if ( specifier.room !== undefined ) {
            const room = this.#io.sockets.adapter.rooms.get(String(specifier.room));
            return !!room && room.size > 0;
        }
        if ( specifier.socket ) {
            return this.#io.sockets.sockets.has(specifier.socket);
        }
        return false;
    }

    /** True once `attachHttpServer` has wired up the io instance. */
    hasIO (): boolean {
        return this.#io !== null;
    }

    /**
     * Read the last-change timestamp for a user from Redis. Returns 0
     * when unset. Called by `LegacyFSController`'s
     * `/cache/last-change-timestamp` route.
     */
    async getLastChangeTimestamp (userId: number | string): Promise<number> {
        try {
            const raw = await this.clients.redis.get(`${LAST_CHANGE_KEY_PREFIX}${userId}`);
            if ( ! raw ) return 0;
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        } catch {
            return 0;
        }
    }

    // ── Auth + connection wiring ───────────────────────────────────

    #installAuthMiddleware (): void {
        if ( ! this.#io ) return;
        const authService = this.services.auth as AuthService | undefined;
        if ( ! authService ) {
            console.warn('[socket] AuthService unavailable — sockets will reject all connections');
        }

        this.#io.use(async (socket: AuthenticatedSocket, next) => {
            // socket.io's conventional location for handshake auth is
            // `{ auth: { ... } }`, not the query string. puter-js uses
            // `io(url, { auth: { auth_token } })`.
            const handshakeAuth = socket.handshake.auth as Record<string, unknown> | undefined;
            const tokenRaw = typeof handshakeAuth?.auth_token === 'string'
                ? handshakeAuth.auth_token
                : undefined;

            if ( ! tokenRaw ) {
                next(new Error('socket auth token missing'));
                return;
            }
            const token = tokenRaw.replace(/^Bearer\s+/i, '').trim();
            if ( ! token ) {
                next(new Error('socket auth token empty'));
                return;
            }
            if ( ! authService ) {
                next(new Error('socket auth unavailable'));
                return;
            }

            try {
                const actor = await authService.authenticateFromToken(token);
                if ( !actor || !actor.user ) {
                    next(new Error('socket auth failed'));
                    return;
                }
                // v1 rejected anything other than UserActorType. We
                // mirror that: no app-under-user, no access-token.
                if ( isAppActor(actor) || isAccessTokenActor(actor) ) {
                    next(new Error('socket auth: only user tokens accepted'));
                    return;
                }

                socket.actor = actor;
                // user.id is numeric in the DB; stringify for room name
                // so adapter lookups key on a stable type.
                socket.join(String(actor.user.id));
                next();
            } catch ( err ) {
                console.warn('[socket] auth error', err);
                next(err instanceof Error ? err : new Error('socket auth failed'));
            }
        });
    }

    #installConnectionHandler (): void {
        if ( ! this.#io ) return;

        this.#io.on('connection', (socket: AuthenticatedSocket) => {
            const actor = socket.actor;
            if ( !actor || !actor.user ) return;
            const userId = actor.user.id;
            const userRoom = String(userId);

            // Peer-echo: one tab notifies others that trash is empty.
            socket.on('trash.is_empty', (msg: unknown) => {
                socket.broadcast.to(userRoom).emit('trash.is_empty', msg);
            });

            // Legacy probe some frontends use to signal "the UI is
            // really up, not just a health-check connection". Extensions
            // sometimes listen for the follow-up event.
            socket.on('puter_is_actually_open', () => {
                this.clients.event.emit('web.socket.user-connected', {
                    socket,
                    user: actor.user,
                }, {});
            });

            // Fire-and-forget connect event.
            this.clients.event.emit('web.socket.connected', {
                socket,
                user: actor.user,
            }, {});
        });
    }

    // ── Event bus → socket fan-out ──────────────────────────────────

    #subscribeEventBus (): void {
        // One wildcard subscriber covers every `outer.gui.*` mutation +
        // notification (item.added/updated/removed/moved/pending,
        // cache.updated, submission.done, …). EventClient walks the
        // dot-prefix tree at emit time so we get them all.
        this.clients.event.on('outer.gui.*', (key: string, data: unknown) => {
            this.#handleOuterGui(key, data as OuterGuiPayload).catch((err: unknown) => {
                console.error('[socket] outer.gui handler error', err);
            });
        });

        // Upload progress — each tracker fires `.sub()` callbacks as
        // bytes flow. Matches v1 WSPushService._on_upload_progress.
        this.clients.event.on('fs.storage.upload-progress', (_key: string, data: unknown) => {
            this.#handleUploadProgress(data as UploadProgressPayload);
        });
    }

    async #handleOuterGui (key: string, data: OuterGuiPayload): Promise<void> {
        const userIds = data.user_id_list ?? [];
        if ( userIds.length === 0 ) return;

        // Event bus names are `outer.gui.item.removed` etc.; the wire
        // name the client listens for is `item.removed` etc.
        const wireName = key.startsWith('outer.gui.') ? key.slice('outer.gui.'.length) : key;
        // Only item-mutation events should bump the cache-invalidation
        // timestamp — `cache.updated` is itself a notification ABOUT the
        // timestamp, re-bumping on it is wasted work.
        const isMutation = key.startsWith(ITEM_MUTATION_PREFIX);

        const fanout = userIds.map(async (userId) => {
            await this.send({ room: userId }, wireName, data.response);
            // Post-send hook: v1 WSPushService fired `sent-to-user.<wireName>`
            // so listeners (e.g. NotificationService marking notif delivery)
            // can react after each per-user fan-out.
            this.clients.event.emit(`sent-to-user.${wireName}`, {
                user_id: userId,
                response: data.response,
            }, {});
            if ( isMutation ) {
                const timestamp = Date.now();
                await this.#bumpLastChange(userId, timestamp);
                // v1 WSPushService._update_user_ts also pushed `cache.updated`
                // as a wire event so connected tabs invalidate their FS
                // cache immediately (originator filters by
                // `original_client_socket_id` to avoid self-refetch).
                // Without this, other tabs only learn about the change on
                // their next poll of /cache/last-change-timestamp.
                const originalSocketId = (data.response as { original_client_socket_id?: string } | undefined)
                    ?.original_client_socket_id;
                await this.send({ room: userId }, 'cache.updated', {
                    timestamp,
                    original_client_socket_id: originalSocketId,
                });
            }
        });
        await Promise.all(fanout);
    }

    #handleUploadProgress (data: UploadProgressPayload): void {
        const meta = data.meta ?? {};
        const userId = (meta.user_id ?? meta.userId) as number | string | undefined;
        if ( ! userId ) {
            console.warn('[socket] upload-progress missing user_id', { meta });
            return;
        }
        const wireName = meta.call_it_download ? 'download.progress' : 'upload.progress';
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

    async #bumpLastChange (userId: number | string, timestamp: number): Promise<void> {
        try {
            await this.clients.redis.set(
                `${LAST_CHANGE_KEY_PREFIX}${userId}`,
                String(timestamp),
                'EX',
                LAST_CHANGE_TTL_SECONDS,
            );
        } catch ( err ) {
            // Redis write failures shouldn't break the socket send —
            // worst case is a stale puter-js cache on another tab.
            console.warn('[socket] failed to bump last-change timestamp', err);
        }
    }
}
