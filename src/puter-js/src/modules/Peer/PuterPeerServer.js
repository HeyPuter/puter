import { PuterPeerConnection } from './PuterPeerConnection.js';
import {
    PuterPeerServerConnectionEvent,
    PuterPeerServerReconnectEvent,
} from './events.js';
import { ServerSignallingChannel } from './signalling.js';

/** @typedef {import('./types.js').PuterPeerOptions} PuterPeerOptions */

/** How long to wait for the signaller to answer a registration. */
const CREATE_TIMEOUT_MS = 15_000;

/** Reconnect backoff for a socket that dropped under a running server. */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/**
 * A peer server. One websocket to the signaller carries every client, so
 * connections are addressed on it by id; each gets its own channel wrapper.
 *
 * A socket that drops is dialled again, and the registration reclaims the
 * session it left behind: same invite code, same clients still routed to
 * it. That is what lets a host whose laptop slept pick the call back up
 * instead of every guest having to build a new link. Until it is back,
 * `signallingAlive` is false and every channel knows it.
 *
 * A reclaim that fails - gone too long, signaller restarted - registers
 * fresh instead, under a new code. The clients that were attached to the
 * old session can no longer be reached, so their channels are stranded
 * rather than left to time out one signal at a time.
 */
export class PuterPeerServer extends EventTarget {
    connections = new Map();

    /** @type {string | undefined} */
    inviteCode;

    #peerConfig;
    #wsconn = null;
    #channels = new Map();
    /** @type {{ resolve: Function, reject: Function } | null} */
    #pendingCreate = null;
    #alive = false;
    #closed = false;
    /** @type {PuterPeerOptions} */
    #options = {};
    /** @type {string | undefined} */
    #resumeToken;
    #reconnectTimer = null;
    #reconnectAttempts = 0;

    constructor ( peerConfig ) {
        super();
        this.#peerConfig = peerConfig;
    }

    get signallingAlive () {
        return this.#alive;
    }

    /**
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<string>}
     */
    async start ( options = {} ) {
        this.#options = options;
        const { inviteCode } = await this.#register();
        return inviteCode;
    }

    /**
     * Opens a socket and registers on it. On every call after the first this
     * presents the resume token, so the signaller hands the same session
     * back while it still holds it.
     *
     * @returns {Promise<{ inviteCode: string, resumed: boolean }>}
     */
    async #register () {
        const ws = new WebSocket(this.#peerConfig.signallerUrl);
        this.#wsconn = ws;

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not reach the signaller'));
            ws.onclose = () => reject(new Error('Connection closed unexpectedly'));
        });

        this.#alive = true;
        ws.onerror = null;
        ws.onmessage = (event) => this.#message(event, ws);
        ws.onclose = () => {
            if ( this.#wsconn !== ws ) return;
            this.#alive = false;
            this.#wsconn = null;
            for ( const channel of this.#channels.values() ) channel.onunusable();
            this.#settleCreate(ws, (pending) => {
                pending.reject(new Error('Connection closed unexpectedly'));
            });
            if ( ! this.#closed ) this.#scheduleReconnect();
        };

        ws.send(JSON.stringify({
            server: {
                create: {
                    authToken: this.#peerConfig.authToken,
                    anonToken: this.#options.anonToken,
                    port: this.#options.port,
                    resume: this.#resumeToken,
                },
            },
        }));

        const reply = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#settleCreate(ws, (pending) => {
                    pending.reject(new Error('Server creation timed out'));
                });
            }, CREATE_TIMEOUT_MS);
            this.#pendingCreate = { ws, resolve, reject, timer };
        }).catch((error) => {
            ws.onclose = null;
            try {
                ws.close();
            } catch {
                // The failed registration is already unusable.
            }
            // Only if this socket is still the live one: a registration
            // already replaced must not mark its successor dead.
            if ( this.#wsconn === ws ) {
                this.#alive = false;
                this.#wsconn = null;
            }
            throw error;
        });

        const resumed = !! reply.resumed;
        // A registration that did not reclaim the old session leaves every
        // client of it unreachable, whatever the socket says.
        for ( const channel of this.#channels.values() ) {
            if ( resumed ) channel.onusable();
            else channel.strand();
        }
        this.#resumeToken = reply.resumeToken ?? this.#resumeToken;
        this.inviteCode = reply.invitecode ?? this.inviteCode;
        return { inviteCode: this.inviteCode, resumed };
    }

    #scheduleReconnect () {
        if ( this.#closed || this.#reconnectTimer ) return;
        const attempt = this.#reconnectAttempts++;
        const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
        const delay = backoff / 2 + Math.random() * (backoff / 2);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            void this.#reconnect();
        }, delay);
    }

    async #reconnect () {
        if ( this.#closed ) return;
        let registration;
        try {
            registration = await this.#register();
        } catch {
            if ( ! this.#closed ) this.#scheduleReconnect();
            return;
        }
        this.#reconnectAttempts = 0;
        this.dispatchEvent(
            new PuterPeerServerReconnectEvent(registration.inviteCode, registration.resumed),
        );
    }

    /**
     * Settles the registration `ws` is waiting on, if it is still the one in
     * flight - a replaced socket must not settle its successor's handshake.
     * Passing no socket settles whichever is, which is what closing does.
     */
    #settleCreate ( ws, settle ) {
        const pending = this.#pendingCreate;
        if ( ! pending || ( ws && pending.ws !== ws ) ) return;
        clearTimeout(pending.timer);
        this.#pendingCreate = null;
        settle(pending);
    }

    /**
     * @param {Record<string, unknown>} envelope
     * @returns {boolean} whether the envelope left
     */
    relay ( envelope ) {
        if ( ! this.#alive ) return false;
        try {
            this.#wsconn.send(JSON.stringify({ server: envelope }));
            return true;
        } catch {
            // The close handler updates signalling state.
            return false;
        }
    }

    async #message ( event, ws ) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        if ( ! data?.server ) return;

        if ( data.server.create ) {
            const reply = data.server.create;
            this.#settleCreate(ws, (pending) => {
                if ( reply.success ) {
                    pending.resolve(reply);
                } else {
                    pending.reject(new Error(reply.error));
                }
            });
            return;
        }
        if ( data.server.connect ) {
            this.#accept(data.server.connect);
            return;
        }
        if ( data.server.disconnect ) {
            this.#channels.get(data.server.disconnect.id)?.onpeergone('the peer went away');
            return;
        }

        const relayed = data.server.offer ?? data.server.answer
            ?? data.server.candidate ?? data.server.bye;
        if ( relayed ) this.#channels.get(relayed.id)?.receive(data.server);
    }

    #accept ( { id, user } ) {
        const channel = new ServerSignallingChannel(this, id);
        const connection = new PuterPeerConnection(this.#peerConfig, {
            polite: true,
            channel,
        });
        this.#channels.set(id, channel);
        this.connections.set(id, connection);
        connection.addEventListener('close', () => {
            this.#channels.delete(id);
            this.connections.delete(id);
        });
        connection.acceptNegotiation();
        this.dispatchEvent(new PuterPeerServerConnectionEvent(connection, user));
    }

    close () {
        this.#closed = true;
        if ( this.#reconnectTimer ) clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
        this.#settleCreate(null, (pending) => {
            pending.reject(new Error('The server was closed'));
        });
        // Give the invite code up rather than leave it held for a server
        // that is never coming back.
        if ( this.#alive ) this.relay({ release: {} });
        for ( const connection of this.connections.values() ) connection.close();
        this.connections.clear();
        this.#channels.clear();
        this.#alive = false;
        if ( ! this.#wsconn ) return;
        this.#wsconn.onclose = null;
        try {
            this.#wsconn.close();
        } catch {
            // Already closed.
        }
        this.#wsconn = null;
    }
}
