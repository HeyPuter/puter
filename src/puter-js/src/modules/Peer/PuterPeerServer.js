import { PuterPeerConnection } from './PuterPeerConnection.js';
import { PuterPeerServerConnectionEvent } from './events.js';
import { ServerSignallingChannel } from './signalling.js';

/** @typedef {import('./types.js').PuterPeerOptions} PuterPeerOptions */

/**
 * A peer server. One websocket to the signaller carries every client, so
 * connections are addressed on it by id; each gets its own channel wrapper.
 *
 * The socket is registered once and never replaced. While it is down no new
 * client can be accepted and nothing reaches the ones already connected, so
 * `signallingAlive` says so and every channel is told.
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
        const ws = new WebSocket(this.#peerConfig.signallerUrl);
        this.#wsconn = ws;

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not reach the signaller'));
            ws.onclose = () => reject(new Error('Connection closed unexpectedly'));
        });

        this.#alive = true;
        ws.onerror = null;
        ws.onmessage = (event) => this.#message(event);
        ws.onclose = () => {
            this.#alive = false;
            this.#wsconn = null;
            for ( const channel of this.#channels.values() ) channel.onunusable();
            this.#settleCreate((pending) => {
                pending.reject(new Error('Connection closed unexpectedly'));
            });
        };

        ws.send(JSON.stringify({
            server: {
                create: {
                    authToken: this.#peerConfig.authToken,
                    anonToken: options.anonToken,
                    port: options.port,
                },
            },
        }));

        this.inviteCode = await new Promise((resolve, reject) => {
            this.#pendingCreate = { resolve, reject };
        }).catch((error) => {
            ws.onclose = null;
            try {
                ws.close();
            } catch {
                // The failed registration is already unusable.
            }
            this.#alive = false;
            this.#wsconn = null;
            throw error;
        });

        return this.inviteCode;
    }

    /** Settles the registration handshake, if one is still waiting on a reply. */
    #settleCreate ( settle ) {
        const pending = this.#pendingCreate;
        if ( ! pending ) return;
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

    async #message ( event ) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        if ( ! data?.server ) return;

        if ( data.server.create ) {
            const reply = data.server.create;
            this.#settleCreate((pending) => {
                if ( reply.success ) {
                    pending.resolve(reply.invitecode);
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
        this.#settleCreate((pending) => {
            pending.reject(new Error('The server was closed'));
        });
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
