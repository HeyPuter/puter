import { PuterPeerConnection } from './PuterPeerConnection.js';
import { PuterPeerServerConnectionEvent } from './events.js';
import { ServerSignallingChannel, decodeSignal, signalTarget } from './signalling.js';

/** @typedef {import('../../../types/modules/peer').PuterPeerOptions} PuterPeerOptions */

const CREATE_TIMEOUT = 15000;

/**
 * A peer server. One websocket to the signaller carries every client, so
 * connections are addressed on it by id; each gets a channel that tags what
 * it sends and receives with its own.
 */
export class PuterPeerServer extends EventTarget {
    connections = new Map();

    /**
     * The invite code to share with other clients so they can connect.
     *
     * @type {string | undefined}
     */
    inviteCode;

    #peerConfig;
    #wsconn;
    #channels = new Map();
    #oncreateresolve;
    #alive = false;

    constructor ( peerConfig ) {
        super();
        this.#peerConfig = peerConfig;
        this.#wsconn = new WebSocket(peerConfig.signallerUrl);
    }

    /** Whether signalling can still carry renegotiation for this server. */
    get signallingAlive () {
        return this.#alive;
    }

    /**
     * Opens the signalling connection and registers this server, resolving to
     * the invite code other clients connect with (also kept on `inviteCode`).
     * `puter.peer.serve()` calls this.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<string>}
     */
    async start ( options = {} ) {
        await new Promise((resolve, reject) => {
            this.#wsconn.onopen = resolve;
            this.#wsconn.onerror = reject;
            this.#wsconn.onclose = () => {
                reject(new Error('Connection closed unexpectedly'));
            };
        });

        this.#alive = true;

        this.#wsconn.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            return this.#message(data);
        };

        // Losing signalling costs renegotiation, not the connections that are
        // already up, so each one is told and left to decide for itself.
        this.#wsconn.onclose = () => {
            this.#alive = false;
            for ( const channel of [...this.#channels.values()] ) {
                channel.unusable();
            }
        };

        this.#wsconn.send(
            JSON.stringify({
                server: {
                    create: {
                        authToken: this.#peerConfig.authToken,
                        anonToken: options.anonToken,
                        port: options.port,
                    },
                },
            }),
        );

        const { inviteCode } = await new Promise((resolve, reject) => {
            this.#oncreateresolve = (data) => {
                if ( data.success ) {
                    resolve({
                        inviteCode: data.invitecode,
                    });
                    this.#oncreateresolve = null;
                    this.inviteCode = data.invitecode;
                } else {
                    reject(new Error(data.error));
                }
            };
            setTimeout(
                () => reject(new Error('Server creation timed out')),
                CREATE_TIMEOUT,
            );
        });

        return inviteCode;
    }

    /**
     * Sends one already-addressed payload on the shared socket. Connection
     * channels use this instead of holding the socket themselves.
     *
     * @param {Record<string, unknown>} envelope
     * @returns {void}
     */
    relay ( envelope ) {
        if ( ! this.#alive ) return;
        try {
            this.#wsconn.send(JSON.stringify({ server: envelope }));
        } catch {
            // socket closed underneath us; `signallingAlive` catches up on close
        }
    }

    async #message ( data ) {
        if ( ! data.server ) return;

        if ( data.server.create ) {
            this.#oncreateresolve?.(data.server.create);
            return;
        }

        if ( data.server.connect ) {
            this.#accept(data.server.connect);
            return;
        }

        if ( data.server.disconnect ) {
            this.#channels.get(data.server.disconnect.id)?.peerGone('the peer went away');
            return;
        }

        const signal = decodeSignal(data.server);
        if ( signal ) {
            this.#channels.get(signalTarget(data.server))?.deliver(signal);
        }
    }

    #accept ( { id, user } ) {
        const channel = new ServerSignallingChannel(this, id);
        const connection = new PuterPeerConnection(this.#peerConfig, {
            // Serving is the polite side: on a collision it yields, so a
            // client's offer always wins and neither end deadlocks.
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

    /**
     * Closes every client connection, then the signalling connection.
     *
     * @returns {void}
     */
    close () {
        for ( const connection of [...this.connections.values()] ) {
            connection.close();
        }
        this.connections.clear();
        this.#channels.clear();
        this.#alive = false;
        this.#wsconn.onclose = null;
        this.#wsconn.close();
    }
}
