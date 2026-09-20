import { PuterPeerConnection } from './PuterPeerConnection.js';
import {
    PuterPeerServerCloseEvent,
    PuterPeerServerConnectionEvent,
    PuterPeerServerReconnectEvent,
} from './events.js';
import { ServerSignallingChannel, signallerError, signallerUrlFor } from './signalling.js';

/** @typedef {import('./types.js').PuterPeerOptions} PuterPeerOptions */

const CREATE_TIMEOUT_MS = 15_000;
const PING = '{"ping":1}';
const PING_INTERVAL_MS = 30_000;
const CLOSE_REPLACED = 4001;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const NAME_IN_USE_ATTEMPTS = 6;

/**
 * A peer server. One websocket to the signaller carries every client, so
 * connections are addressed on it by id; each gets its own channel wrapper.
 */
export class PuterPeerServer extends EventTarget {
    connections = new Map();

    /** @type {string | undefined} */
    inviteCode;

    #peerConfig;
    #wsconn = null;
    #channels = new Map();
    /**
     * The registration handshake in flight, and the socket it belongs to. A
     * replaced socket must not settle its successor's handshake, so every
     * path that settles one names the socket it is settling for.
     *
     * @type {{ ws: WebSocket, resolve: Function, reject: Function, timer: any } | null}
     */
    #pendingCreate = null;
    /** @type {PuterPeerOptions} */
    #options = {};
    #alive = false;
    #registered = false;
    #closed = false;
    #reconnectTimer = null;
    #reconnectAttempts = 0;
    #nameInUseAttempts = 0;
    #pingTimer = null;

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
        const inviteCode = await this.#register();
        this.#registered = true;
        return inviteCode;
    }

    /**
     * @param {string | null} grant
     * @returns {void}
     */
    setGuestGrant ( grant ) {
        this.#options = { ...this.#options, guestGrant: grant || undefined };
        if ( this.#alive ) {
            this.#wsconn.send(JSON.stringify({ server: { grant: { grant: grant || null } } }));
        }
    }

    async #register () {
        const ws = new WebSocket(signallerUrlFor(this.#peerConfig.signallerUrl, this.#options.name));
        this.#wsconn = ws;

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not reach the signaller'));
            ws.onclose = () => reject(new Error('Connection closed unexpectedly'));
        });

        this.#alive = true;
        ws.onerror = null;
        ws.onmessage = (event) => this.#message(event, ws);
        ws.onclose = (event) => {
            if ( this.#wsconn !== ws ) return;
            this.#alive = false;
            for ( const channel of this.#channels.values() ) channel.onunusable();
            // A socket that dies before its reply fails its own registration
            // now, rather than leaving it to time out beside a replacement.
            this.#settleCreate(ws, (pending) => {
                pending.reject(new Error('Connection closed unexpectedly'));
            });
            this.#onSignallerLost(event);
        };

        ws.send(JSON.stringify({
            server: {
                create: {
                    authToken: this.#peerConfig.authToken,
                    anonToken: this.#options.anonToken,
                    port: this.#options.port,
                    name: this.#options.name,
                    grant: this.#options.guestGrant,
                },
            },
        }));

        const inviteCode = await new Promise((resolve, reject) => {
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
            // Only if this socket is still the live one: a registration that
            // has already been replaced must not mark its successor dead.
            if ( this.#wsconn === ws ) {
                this.#alive = false;
                this.#wsconn = null;
            }
            throw error;
        });

        this.inviteCode = inviteCode;
        this.#startPing(ws);
        return inviteCode;
    }

    /**
     * Settles the registration handshake `ws` is waiting on, if it is still
     * the one in flight. Passing no socket settles whichever is, which is what
     * closing the server does.
     *
     * @param {WebSocket | null} ws
     * @param {(pending: { resolve: Function, reject: Function }) => void} settle
     */
    #settleCreate ( ws, settle ) {
        const pending = this.#pendingCreate;
        if ( ! pending || ( ws && pending.ws !== ws ) ) return;
        clearTimeout(pending.timer);
        this.#pendingCreate = null;
        settle(pending);
    }

    #startPing ( ws ) {
        this.#stopPing();
        this.#pingTimer = setInterval(() => {
            if ( ws.readyState !== 1 ) return;
            try {
                ws.send(PING);
            } catch {
                // The close handler owns recovery.
            }
        }, PING_INTERVAL_MS);
    }

    #stopPing () {
        if ( ! this.#pingTimer ) return;
        clearInterval(this.#pingTimer);
        this.#pingTimer = null;
    }

    #onSignallerLost ( event ) {
        this.#stopPing();
        this.#wsconn = null;
        if ( this.#closed || ! this.#registered ) return;
        if ( event?.code === CLOSE_REPLACED ) {
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
            void this.#reconnect();
        }, delay);
    }

    async #reconnect () {
        if ( this.#closed ) return;
        let inviteCode;
        try {
            inviteCode = await this.#register();
        } catch (error) {
            if ( this.#closed ) return;
            if ( error?.code === 'name_in_use' && ++this.#nameInUseAttempts >= NAME_IN_USE_ATTEMPTS ) {
                this.#giveUp('name_in_use');
                return;
            }
            this.#scheduleReconnect();
            return;
        }
        this.#reconnectAttempts = 0;
        this.#nameInUseAttempts = 0;
        this.dispatchEvent(new PuterPeerServerReconnectEvent(inviteCode));
    }

    #giveUp ( reason ) {
        if ( this.#closed ) return;
        this.#closed = true;
        this.#stopPing();
        if ( this.#reconnectTimer ) clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
        this.dispatchEvent(new PuterPeerServerCloseEvent(reason));
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
                    pending.resolve(reply.invitecode ?? this.inviteCode);
                } else {
                    pending.reject(signallerError(reply.error, reply.code));
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
        this.#stopPing();
        this.#settleCreate(null, (pending) => {
            pending.reject(new Error('The server was closed'));
        });
        if ( this.#reconnectTimer ) clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
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
