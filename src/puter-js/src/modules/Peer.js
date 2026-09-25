import { fetchUrl } from '../lib/networkUtils.js';
import { PuterModule } from '../lib/PuterModule.js';

/**
 * Options for `puter.peer.serve()` and `puter.peer.connect()`.
 *
 * @typedef {Object} PuterPeerOptions
 * @property {RTCIceServer[]} [iceServers] Custom ICE servers (STUN/TURN) to use instead of the
 * Puter-managed relays.
 * @property {boolean} [forceRelay] Route every candidate through a TURN relay.
 * @property {string} [anonToken] Take part without a Puter session. Any uuid; it identifies this
 * guest for the duration of the session and skips the sign-in prompt.
 * @property {string} [turnGrant] A grant from `puter.peer.createGuestGrant()`, letting a guest with
 * no session use the Puter-managed relays on the granting account's allowance.
 * @property {string} [name] `serve()` only: serve under a room name of your choosing instead of a
 * generated invite code. Clients reach the server with `connect(name)`. Lowercase letters, digits
 * and hyphens, 3–64 characters. The name is yours while you serve it, and free again once you stop;
 * serving a name that is currently held fails with `name_in_use` — unless the holder is you, in
 * which case the newer server takes over and the older one is closed.
 * @property {string} [guestGrant] `serve()` only: a grant from `puter.peer.createGuestGrant()`
 * handed to every guest that connects without a `turnGrant` of its own, so they reach the relays
 * without you having to deliver the grant some other way. Renew it with `server.setGuestGrant()`.
 */

/**
 * Metadata about a peer user.
 *
 * @typedef {Object} PuterPeerUser
 * @property {string} username
 * @property {string} uuid
 */

/** @typedef {string | Blob | ArrayBuffer | ArrayBufferView} PuterPeerMessage */
/** @typedef {RTCSessionDescription | RTCSessionDescriptionInit} PuterPeerDescription */
/** @typedef {RTCIceCandidate | RTCIceCandidateInit} PuterPeerIceCandidate */

/**
 * Room names the signaller accepts: lowercase letters, digits and hyphens,
 * 3–64 characters, no leading or trailing hyphen.
 */
const ROOM_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * The shape of a generated invite code (`NJ-7F3A9C`): up to four characters
 * of the username, a dash, six hex digits. Uppercase throughout, so a room
 * name — lowercase by rule — can never be mistaken for one.
 */
const INVITE_CODE_RE = /^[A-Z0-9]{0,4}-[0-9A-F]{6}$/;

/**
 * Whether a string is a room name (as opposed to a generated invite code).
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isRoomName (value) {
    return typeof value === 'string' && ROOM_NAME_RE.test(value) && !INVITE_CODE_RE.test(value);
}

/** Signaller keepalive: the signaller answers `{"ping":1}` with `{"pong":1}`. */
const PING = '{"ping":1}';
const PING_INTERVAL_MS = 30_000;

/** The signaller closes a server with this code when a newer one took its name over. */
const CLOSE_REPLACED = 4001;

/** Reconnect backoff for a server whose signaller socket died. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** How many times to retry a name someone else appears to be holding before giving up. */
const NAME_IN_USE_ATTEMPTS = 6;

const CREATE_TIMEOUT_MS = 15_000;

/**
 * The signaller URL to open for a room, or the plain one for invite codes.
 *
 * @param {string} signallerUrl
 * @param {string | undefined} room
 * @returns {string}
 */
function signallerUrlFor (signallerUrl, room) {
    if ( ! room ) return signallerUrl;
    const url = new URL(signallerUrl);
    url.searchParams.set('room', room);
    return url.toString();
}

/**
 * An error carrying the signaller's machine-readable code (`no_host`,
 * `name_in_use`, `invalid_invite`, …) next to its message.
 *
 * @param {string} message
 * @param {string} [code]
 * @returns {Error & { code?: string }}
 */
function signallerError (message, code) {
    const error = /** @type {Error & { code?: string }} */ (new Error(message));
    if ( code ) error.code = code;
    return error;
}

/**
 * Dispatched by `PuterPeerServer` for the `'connection'` event when a client
 * connects.
 */
export class PuterPeerServerConnectionEvent extends Event {
    /**
     * The connection to the client.
     *
     * @type {PuterPeerConnection}
     */
    conn;

    /**
     * Metadata about the connecting user, when available.
     *
     * @type {PuterPeerUser | undefined}
     */
    user;

    /**
     * @param {PuterPeerConnection} connection
     * @param {PuterPeerUser} [user]
     */
    constructor (connection, user) {
        super('connection');
        this.conn = connection;
        this.user = user;
    }
}

/**
 * Dispatched by `PuterPeerServer` for the `'reconnect'` event once it has
 * re-registered with the signaller after losing its socket. Existing
 * connections are unaffected; this only concerns clients yet to connect.
 */
export class PuterPeerServerReconnectEvent extends Event {
    /**
     * The invite code in force now. Unchanged for a server with a `name`; a
     * server on a generated code gets a new one, since the old one died with
     * the socket.
     *
     * @type {string}
     */
    inviteCode;

    /** @param {string} inviteCode */
    constructor (inviteCode) {
        super('reconnect');
        this.inviteCode = inviteCode;
    }
}

/**
 * Dispatched by `PuterPeerServer` for the `'close'` event when the server has
 * stopped accepting clients for good without `close()` having been called:
 * its name was taken over by a newer server of yours (`replaced`), or is
 * held by someone else and could not be reclaimed (`name_in_use`). Existing
 * connections stay open; the invite code no longer works.
 */
export class PuterPeerServerCloseEvent extends Event {
    /**
     * Why the server stopped: `'replaced'` or `'name_in_use'`.
     *
     * @type {string}
     */
    reason;

    /** @param {string} reason */
    constructor (reason) {
        super('close');
        this.reason = reason;
    }
}

/**
 * Dispatched by `PuterPeerConnection` for the `'message'` event when a message
 * is received.
 */
export class PuterPeerConnectionMessageEvent extends Event {
    /**
     * The received message payload.
     *
     * @type {ArrayBuffer | string}
     */
    data;

    /** @param {ArrayBuffer | string} message */
    constructor (message) {
        super('message');
        this.data = message;
    }
}

/**
 * Dispatched by `PuterPeerConnection` for the `'open'` event when the data
 * channel is ready.
 */
export class PuterPeerConnectionOpenEvent extends Event {
    constructor () {
        super('open');
    }
}

/**
 * Dispatched by `PuterPeerConnection` for the `'close'` event when the
 * connection closes.
 */
export class PuterPeerConnectionCloseEvent extends Event {
    /**
     * The reason the connection was closed, if one was provided.
     *
     * @type {string | undefined}
     */
    reason;

    /** @param {string} [reason] */
    constructor (reason = undefined) {
        super('close');
        this.reason = reason;
    }
}

/**
 * Dispatched by `PuterPeerConnection` for the `'error'` event when a connection
 * error occurs.
 */
export class PuterPeerConnectionErrorEvent extends Event {
    /**
     * The error. When the signaller refused the connection this is an `Error`
     * whose `code` names why: `no_host` (a room nobody is serving right now),
     * `invalid_invite` (an invite code that is not live), `invalid_auth`.
     *
     * @type {Error & { code?: string } | string}
     */
    error;

    /** @param {Error & { code?: string } | string} error */
    constructor (error) {
        super('error');
        this.error = error;
    }
}

export class PuterPeerServer extends EventTarget {
    #wsconn = null;
    #oncreateresolve = null;
    #peerConfig;
    /** @type {PuterPeerOptions} */
    #options = {};
    /** True once the first registration has succeeded. */
    #registered = false;
    /** True once the server is done for good — close() called, or given up. */
    #closed = false;
    #reconnectTimer = null;
    #reconnectAttempts = 0;
    #nameInUseAttempts = 0;
    #pingTimer = null;

    connections = new Map();

    /**
     * The invite code to share with other clients so they can connect. For a
     * server started with a `name`, this is the name.
     *
     * @type {string | undefined}
     */
    inviteCode;

    constructor (peerConfig) {
        super();
        this.#peerConfig = peerConfig;
    }

    /**
     * Opens the signalling connection and registers this server, resolving to
     * the invite code other clients connect with (also kept on `inviteCode`).
     * `puter.peer.serve()` calls this.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<string>}
     */
    async start (options = {}) {
        this.#options = options;
        const inviteCode = await this.#register();
        this.#registered = true;
        return inviteCode;
    }

    /**
     * Replaces the guest grant handed to clients that connect from now on.
     * Pass a fresh grant before the previous one expires so guests joining
     * hours into a session still get relays.
     *
     * @param {string | null} grant
     * @returns {void}
     */
    setGuestGrant (grant) {
        this.#options = { ...this.#options, guestGrant: grant || undefined };
        if ( this.#registered && this.#wsconn?.readyState === 1 ) {
            this.#wsconn.send(JSON.stringify({ server: { grant: { grant: grant || null } } }));
        }
    }

    /**
     * Open a socket to the signaller and register; resolves to the invite
     * code. Used for the first registration and for every reconnect.
     *
     * @returns {Promise<string>}
     */
    async #register () {
        const ws = new WebSocket(signallerUrlFor(this.#peerConfig.signallerUrl, this.#options.name));
        this.#wsconn = ws;
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not reach the signaller'));
            ws.onclose = () => {
                reject(new Error('Connection closed unexpectedly'));
            };
        });

        ws.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return; // keepalive replies and anything else that isn't ours
            }
            return this.#message(data);
        };

        ws.onclose = (event) => {
            if ( this.#wsconn !== ws ) return; // a socket we already replaced
            this.#onSignallerLost(event);
        };
        ws.onerror = null;

        ws.send(
            JSON.stringify({
                server: {
                    create: {
                        authToken: this.#peerConfig.authToken,
                        anonToken: this.#options.anonToken,
                        port: this.#options.port,
                        name: this.#options.name,
                        grant: this.#options.guestGrant,
                    },
                },
            }),
        );

        const inviteCode = await new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => {
                    this.#oncreateresolve = null;
                    reject(new Error('Server creation timed out'));
                },
                CREATE_TIMEOUT_MS,
            );
            this.#oncreateresolve = (data) => {
                clearTimeout(timer);
                this.#oncreateresolve = null;
                if ( data.success ) {
                    // A server on a port has no code; keep whatever it had.
                    resolve(data.invitecode ?? this.inviteCode);
                } else {
                    reject(signallerError(data.error, data.code));
                }
            };
        }).catch((error) => {
            // A failed registration leaves nothing to reconnect.
            ws.onclose = null;
            try {
                ws.close();
            } catch {
                /* noop */
            }
            if ( this.#wsconn === ws ) this.#wsconn = null;
            throw error;
        });

        this.inviteCode = inviteCode;
        this.#startPing(ws);
        return inviteCode;
    }

    #startPing (ws) {
        this.#stopPing();
        this.#pingTimer = setInterval(() => {
            if ( ws.readyState === 1 ) {
                try {
                    ws.send(PING);
                } catch {
                    /* the close handler takes it from here */
                }
            }
        }, PING_INTERVAL_MS);
    }

    #stopPing () {
        if ( this.#pingTimer ) {
            clearInterval(this.#pingTimer);
            this.#pingTimer = null;
        }
    }

    /**
     * The signaller socket closed under a registered server. Existing
     * connections are WebRTC and unaffected; what is lost is the ability to
     * accept new ones — so get it back, unless we were told not to.
     *
     * @param {CloseEvent} event
     */
    #onSignallerLost (event) {
        this.#stopPing();
        this.#wsconn = null;
        if ( this.#closed || ! this.#registered ) return;
        if ( event?.code === CLOSE_REPLACED ) {
            // A newer server of ours holds the name now. Retrying would only
            // take it back from that one, and so on forever.
            this.#giveUp('replaced');
            return;
        }
        this.#scheduleReconnect();
    }

    #scheduleReconnect () {
        if ( this.#closed || this.#reconnectTimer ) return;
        const attempt = this.#reconnectAttempts++;
        const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
        const delay = backoff / 2 + Math.random() * (backoff / 2);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            this.#reconnect();
        }, delay);
    }

    async #reconnect () {
        if ( this.#closed ) return;
        let inviteCode;
        try {
            inviteCode = await this.#register();
        } catch (error) {
            if ( this.#closed ) return;
            if ( error?.code === 'name_in_use' ) {
                // Someone else is serving our name. Briefly, that may be our
                // own dead socket the signaller hasn't noticed yet — which
                // the same identity would take over — so a few tries are
                // worth it; past that, the name is genuinely theirs.
                if ( ++this.#nameInUseAttempts >= NAME_IN_USE_ATTEMPTS ) {
                    this.#giveUp('name_in_use');
                    return;
                }
            }
            this.#scheduleReconnect();
            return;
        }
        this.#reconnectAttempts = 0;
        this.#nameInUseAttempts = 0;
        this.dispatchEvent(new PuterPeerServerReconnectEvent(inviteCode));
    }

    /** Stop for good without touching live connections; tell the app why. */
    #giveUp (reason) {
        if ( this.#closed ) return;
        this.#closed = true;
        this.#stopPing();
        if ( this.#reconnectTimer ) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        this.dispatchEvent(new PuterPeerServerCloseEvent(reason));
    }

    async #message (data) {
        if ( ! data || ! data.server ) return;
        if ( data.server.create ) {
            this.#oncreateresolve?.(data.server.create);
            return;
        }

        if ( data.server.connect ) {
            let uuid = data.server.connect.id;
            let connection = new PuterPeerConnection(this.#peerConfig);
            this.connections.set(uuid, connection);
            const ws = this.#wsconn;
            connection.peerconnection.onicecandidate = (e) => {
                if ( e.candidate && ws?.readyState === 1 ) {
                    ws.send(
                        JSON.stringify({
                            server: {
                                candidate: {
                                    id: uuid,
                                    candidate: e.candidate,
                                },
                            },
                        }),
                    );
                }
            };
            this.dispatchEvent(
                new PuterPeerServerConnectionEvent(
                    connection,
                    data.server.connect.user,
                ),
            );
        }

        if ( data.server.candidate ) {
            let uuid = data.server.candidate.id;
            let connection = this.connections.get(uuid);
            if ( connection ) {
                await connection.addIceCandidate(
                    data.server.candidate.candidate,
                );
            }
        }

        if ( data.server.offer ) {
            let uuid = data.server.offer.id;
            let connection = this.connections.get(uuid);
            if ( ! connection ) {
                return;
            }
            await connection.setRemoteDescription(
                new RTCSessionDescription(data.server.offer.offer),
            );
            const answer = await connection.createAnswer();
            if ( this.#wsconn?.readyState === 1 ) {
                this.#wsconn.send(
                    JSON.stringify({
                        server: {
                            answer: {
                                id: uuid,
                                answer,
                            },
                        },
                    }),
                );
            }
        }
    }

    /**
     * Closes every client connection, then the signalling connection.
     *
     * @returns {void}
     */
    close () {
        this.#closed = true;
        this.#stopPing();
        if ( this.#reconnectTimer ) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        for ( const [uuid, connection] of this.connections ) {
            connection.close();
        }
        if ( this.#wsconn ) {
            this.#wsconn.onclose = null;
            try {
                this.#wsconn.close();
            } catch {
                /* noop */
            }
            this.#wsconn = null;
        }
    }
}

/**
 * A WebRTC data-channel connection to a peer. Emits `'open'`, `'message'`,
 * `'close'`, and `'error'` events.
 */
export class PuterPeerConnection extends EventTarget {
    #wsconn;
    peerconnection;

    /**
     * Information about the user who created the server.
     *
     * @type {PuterPeerUser | undefined}
     */
    owner;

    /**
     * The room name this connection was made in, when the server was reached
     * by name.
     *
     * @type {string | undefined}
     */
    room;
    #peerConfig;
    #datachannel;
    connected = false;
    closed = false;
    #bufferedMessages = [];
    constructor (peerConfig) {
        super();
        this.#peerConfig = peerConfig;
        this.peerconnection = new RTCPeerConnection({
            iceTransportPolicy: peerConfig.forceRelay ? 'relay' : 'all',
            iceServers: peerConfig.iceServers,
        });
        this.#datachannel = this.peerconnection.createDataChannel('channel-1', { negotiated: true, id: 2 });
        this.#datachannel.onmessage = (evt) => {
            this.dispatchEvent(new PuterPeerConnectionMessageEvent(evt.data));
        };
        this.#datachannel.onopen = () => {
            this.connected = true;
            for ( const message of this.#bufferedMessages ) {
                this.send(message);
            }
            this.#bufferedMessages = [];
            this.dispatchEvent(new PuterPeerConnectionOpenEvent());
            this.#closews();
        };
        this.#datachannel.onclose = () => {
            this.#doclose(undefined, undefined);
        };
        this.#datachannel.onerror = (evt) => {
            this.#doclose(undefined, evt.error);
        };
    }

    #closews () {
        if ( this.#wsconn ) {
            this.#wsconn.onclose = null;
            this.#wsconn.close();
            this.#wsconn = null;
        }
    }

    /**
     * Connects to the server that issued `invitecode` — or serves the room of
     * that name — resolving once the offer has been exchanged.
     * `puter.peer.connect()` calls this.
     *
     * @param {string} invitecode
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<void>}
     */
    async connect (invitecode, options = {}) {
        // A room name is dialled on the room's own signaller connection; an
        // invite code (or a loopback port) on the shared one.
        const room = ! options.port && isRoomName(invitecode) ? invitecode : undefined;
        this.#wsconn = new WebSocket(signallerUrlFor(this.#peerConfig.signallerUrl, room));
        await new Promise((resolve, reject) => {
            this.#wsconn.onopen = resolve;
            this.#wsconn.onerror = reject;
            this.#wsconn.onclose = () => {
                reject(new Error('Connection closed unexpectedly'));
            };
        });
        this.#wsconn.onopen = null;
        this.#wsconn.onerror = null;
        // post initial connect close
        this.#wsconn.onclose = () => {
            this.#doclose(undefined, new Error('Connection closed unexpectedly before peer offer was sent'));
        };

        this.#wsconn.send(
            JSON.stringify({
                client: {
                    connect: {
                        authToken: this.#peerConfig.authToken,
                        anonToken: options.anonToken,
                        invitecode,
                        port: options.port,
                    },
                },
            }),
        );

        this.peerconnection.onicecandidate = (evt) => {
            if ( this.#wsconn?.readyState !== 1 ) return;
            this.#wsconn.send(
                JSON.stringify({
                    client: {
                        candidate: {
                            candidate: evt.candidate,
                        },
                    },
                }),
            );
        };

        this.#wsconn.onmessage = async (evt) => {
            let msg;
            try {
                msg = JSON.parse(evt.data).client;
            } catch {
                return; // keepalive replies and anything else that isn't ours
            }
            if ( ! msg ) return;
            if ( msg.answer ) {
                this.setRemoteDescription(msg.answer.answer);
            }
            if ( msg.candidate ) {
                this.addIceCandidate(msg.candidate.candidate);
            }
            if ( msg.connect ) {
                if ( msg.connect.success ) {
                    this.owner = msg.connect.owner;
                    this.room = msg.connect.room;
                    await this.#adoptRelayedGrant(msg.connect.grant, options);
                    if ( this.closed ) return;
                    const offer = await this.createOffer();
                    if ( this.#wsconn?.readyState !== 1 ) return;
                    this.#wsconn.send(
                        JSON.stringify({
                            client: {
                                offer: {
                                    offer,
                                },
                            },
                        }),
                    );
                } else {
                    this.#doclose(undefined, signallerError(msg.connect.error, msg.connect.code));
                }
            }
            if ( msg.disconnect && !this.connected ) {
                this.#doclose(msg.disconnect.reason);
            }
        };
    }

    /**
     * The server left a guest grant with the signaller. A guest with no
     * relays of its own — no session, no grant, no ICE servers of its own —
     * redeems it now, before the offer, so its candidates include relays.
     *
     * @param {string | undefined} grant
     * @param {PuterPeerOptions} options
     */
    async #adoptRelayedGrant (grant, options) {
        if ( ! grant || ! options.anonToken || options.turnGrant || options.iceServers ) return;
        if ( typeof this.#peerConfig.iceServersFor !== 'function' ) return;
        try {
            const iceServers = await this.#peerConfig.iceServersFor({ turnGrant: grant });
            if ( this.closed || ! iceServers ) return;
            this.peerconnection.setConfiguration({
                iceTransportPolicy: this.#peerConfig.forceRelay ? 'relay' : 'all',
                iceServers,
            });
        } catch (error) {
            console.warn('Unable to use the host’s relays. Some connections may fail.', error);
        }
    }

    #doclose (reason, error) {
        if ( this.closed ) return;
        this.closed = true;
        this.connected = false;
        if ( this.#wsconn ) this.#closews();
        if ( this.#datachannel ) {
            this.#datachannel.onclose = null;
            this.#datachannel.close();
        }
        if ( this.peerconnection ) {
            this.peerconnection.close();
        }
        if ( error ) this.dispatchEvent(new PuterPeerConnectionErrorEvent(error));
        this.dispatchEvent(new PuterPeerConnectionCloseEvent(reason));
    }

    /**
     * Closes the connection, optionally telling the peer why.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    close (reason) {
        this.#doclose(reason, undefined);
    }

    /**
     * Creates an SDP offer and applies it as the local description.
     *
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createOffer () {
        const offer = await this.peerconnection.createOffer();
        await this.peerconnection.setLocalDescription(offer);
        return offer;
    }

    /**
     * Creates an SDP answer and applies it as the local description.
     *
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createAnswer () {
        const answer = await this.peerconnection.createAnswer();
        await this.peerconnection.setLocalDescription(answer);
        return answer;
    }

    /**
     * Applies the peer's SDP description.
     *
     * @param {RTCSessionDescriptionInit} description
     * @returns {Promise<void>}
     */
    async setRemoteDescription (description) {
        await this.peerconnection.setRemoteDescription(description);
    }

    /**
     * Adds an ICE candidate received from the peer.
     *
     * @param {RTCIceCandidateInit} candidate
     * @returns {Promise<void>}
     */
    async addIceCandidate (candidate) {
        await this.peerconnection.addIceCandidate(candidate);
    }

    /**
     * Sends a message over the data channel. Messages sent before the channel
     * opens are buffered and flushed on open.
     *
     * @param {PuterPeerMessage} message
     * @returns {void}
     */
    send ( message ) {
        if ( ! this.connected ) {
            this.#bufferedMessages.push(message);
            return;
        }
        this.#datachannel.send(message);
    }
}

/**
 * The `puter.peer` API. Provides WebRTC data channels with built-in signaling
 * and TURN relays for connecting clients directly without your own signaling
 * server.
 *
 * Hosting a session requires authentication. Guests can join one without an
 * account by passing `anonToken`, and reach the Puter-managed relays with a
 * `turnGrant` the host issued via `createGuestGrant()` — relay usage is
 * charged to the host that issued it.
 *
 * A server is reached either by the invite code it was handed, good for as
 * long as it serves, or by a room name it chose (`serve({ name })`), which
 * anyone can dial as `connect(name)` for as long as someone serves it.
 */
export class PeerModule extends PuterModule {
    #signallerUrl;
    #turnServers;
    #fallbackIceServers;
    #turnTTL;
    #turnStartedAt;
    #turnFailed;
    #turnSource;

    /**
     * Creates a grant that lets guests without a Puter session use the
     * Puter-managed relays. Requires authentication.
     *
     * Hand the grant to the people you invite — alongside the invite code —
     * and they pass it to `connect()` as `turnGrant`. Their relay usage counts
     * against this account, so treat the grant as something that spends your
     * allowance: share it with the session you meant to host, and let it
     * expire rather than reusing one indefinitely.
     *
     * @returns {Promise<{ grant: string, expiresAt: number }>} The grant, and
     * when it stops being accepted (seconds since the epoch).
     */
    async createGuestGrant () {
        const response = await fetchUrl(`${this.APIOrigin}/peer/turn-grant`, {
            method: 'POST',
            includePuterAuth: true,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if ( ! response.ok ) {
            throw new Error('Failed to create a guest grant.');
        }

        return await response.json();
    }

    /**
     * Fetches TURN relay credentials ahead of time so connections start
     * faster. Optional — `serve()` and `connect()` call it when needed — and
     * it resolves either way: if relays can't be loaded, connecting falls back
     * to the default ICE servers.
     *
     * With `turnGrant`, credentials are minted against the granting account
     * instead of the caller's own session, which is how a guest gets relays
     * without signing in.
     *
     * @param {Object} [options]
     * @param {string} [options.turnGrant] A grant from `createGuestGrant()`.
     * @returns {Promise<void>}
     */
    async ensureTurnRelays (options = {}) {
        // Credentials are tied to whoever is paying for them, so a change of
        // source invalidates both the cached servers and a previous failure —
        // otherwise a guest who tried before holding a grant would be stuck
        // with the fallback for the rest of the page's life.
        const source = options.turnGrant ? `grant:${options.turnGrant}` : 'session';
        if ( source !== this.#turnSource ) {
            this.#turnSource = source;
            this.#turnServers = undefined;
            this.#turnFailed = false;
        }

        if ( this.#turnFailed ) return;
        if ( this.#turnServers && Date.now() - this.#turnStartedAt < this.#turnTTL * 1000 ) return;

        const response = options.turnGrant
            ? await fetchUrl(`${this.APIOrigin}/peer/guest-turn`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ grant: options.turnGrant }),
            })
            : await fetchUrl(`${this.APIOrigin}/peer/generate-turn`, {
                method: 'POST',
                includePuterAuth: true,
                headers: {
                    'Content-Type': 'application/json',
                },
            });

        if ( ! response.ok ) {
            this.#turnFailed = true;
            return;
        }

        const { iceServers, ttl } = await response.json();
        this.#turnServers = iceServers;
        this.#turnTTL = ttl;
        this.#turnStartedAt = Date.now();
    }

    async #loadMetadata () {
        if ( this.#signallerUrl ) return;
        const response = await fetchUrl(`${this.APIOrigin}/peer/signaller-info`);
        if ( ! response.ok ) {
            throw new Error('Failed to get signaller info from Puter.');
        }
        const { url, fallbackIce } = await response.json();
        this.#fallbackIceServers = fallbackIce;
        this.#signallerUrl = url;
    }

    async #authenticateForPeerAction (action) {
        if ( this.authToken || this.puter.env !== 'web' ) return;
        try {
            await this.puter.ui.authenticateWithPuter();
        } catch (e) {
            throw new Error(`Need authentication to ${action} but failed to authenticate with Puter.`);
        }
    }

    /**
     * The ICE servers a connection should use: the caller's own, else the
     * Puter-managed relays (on a grant where one is given), else the fallback.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<RTCIceServer[]>}
     */
    async #iceServersFor (options) {
        if ( options?.iceServers ) return options.iceServers;
        await this.ensureTurnRelays(options ?? {});
        if ( this.#turnServers ) return this.#turnServers;
        console.warn('Unable to use TURN relays. Some connections may fail.');
        return this.#fallbackIceServers;
    }

    async #resolvePeerConfig (options) {
        await this.#loadMetadata();
        const iceServers = await this.#iceServersFor(options);

        return {
            authToken: this.authToken,
            iceServers,
            signallerUrl: this.#signallerUrl,
            forceRelay: options?.forceRelay,
            // Lets a guest connection redeem a grant the server left with the
            // signaller, once it learns of it.
            iceServersFor: (opts) => this.#iceServersFor(opts),
        };
    }
    /**
     * Creates a peer server and starts it, resolving to the server once it has
     * an invite code. Requires authentication, unless `anonToken` is supplied.
     *
     * With `name`, the server is reached by that room name instead of a
     * generated code — the same name every time it serves, so the address can
     * be shared ahead of time and reused.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<PuterPeerServer>}
     */
    async serve (options) {
        if ( options?.name !== undefined && ! isRoomName(options.name) ) {
            throw new TypeError('Room names are 3–64 lowercase letters, digits and hyphens, not starting or ending with a hyphen.');
        }
        if ( !options?.anonToken ) await this.#authenticateForPeerAction('create a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const server = new PuterPeerServer(peerConfig);
        await server.start(options);
        return server;
    }

    /**
     * Connects to a peer server — by the invite code from `serve()`, or by
     * the room name it serves under — resolving once the offer has been
     * exchanged. Requires authentication, unless `anonToken` is supplied to
     * join without a session; pair it with a `turnGrant` from the host so the
     * connection can still use relays, or leave that to the host, whose
     * `guestGrant` reaches the guest through the signaller.
     *
     * @param {string} invitecode
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<PuterPeerConnection>}
     */
    async connect (invitecode, options) {
        if ( !options?.anonToken ) await this.#authenticateForPeerAction('connect to a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const conn = new PuterPeerConnection(peerConfig);
        await conn.connect(invitecode, options);
        return conn;
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../lib/types.js').OmitMembers<
 *     typeof PeerModule,
 *     'puter' | 'authToken'
 * >} PeerConstructor
 */

export const Peer = /** @type {PeerConstructor} */ (PeerModule);

export default Peer;
