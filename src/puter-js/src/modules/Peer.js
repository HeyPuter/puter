import { fetchUrl } from '../lib/networkUtils.js';
import { PuterModule } from '../lib/PuterModule.js';

/** @typedef {import('../../types/modules/peer').PuterPeerMessage} PuterPeerMessage */
/** @typedef {import('../../types/modules/peer').PuterPeerOptions} PuterPeerOptions */

class PuterPeerServerConnectionEvent extends Event {
    conn;
    user;
    constructor (connection, user) {
        super('connection');
        this.conn = connection;
        this.user = user;
    }
}

class PuterPeerConnectionMessageEvent extends Event {
    data;
    constructor (message) {
        super('message');
        this.data = message;
    }
}

class PuterPeerConnectionOpenEvent extends Event {
    constructor () {
        super('open');
    }
}

class PuterPeerConnectionCloseEvent extends Event {
    reason;
    constructor (reason = undefined) {
        super('close');
        this.reason = reason;
    }
}

class PuterPeerConnectionErrorEvent extends Event {
    error;
    constructor (error) {
        super('error');
        this.error = error;
    }
}

class PuterPeerServer extends EventTarget {
    #wsconn;
    #oncreateresolve;

    connections = new Map();

    /**
     * The invite code to share with other clients so they can connect.
     *
     * @type {string | undefined}
     */
    inviteCode;
    #peerConfig;

    constructor (peerConfig) {
        super();
        this.#peerConfig = peerConfig;
        this.#wsconn = new WebSocket(peerConfig.signallerUrl);
    }

    /**
     * Opens the signalling connection and registers this server, resolving to
     * the invite code other clients connect with (also kept on `inviteCode`).
     * `puter.peer.serve()` calls this.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<string>}
     */
    async start(options = {}) {
        await new Promise((resolve, reject) => {
            this.#wsconn.onopen = resolve;
            this.#wsconn.onerror = reject;
            this.#wsconn.onclose = () => {
                reject(new Error('Connection closed unexpectedly'));
            };
        });

        this.#wsconn.onmessage = (event) => {
            let data = JSON.parse(event.data);
            this.#message(data);
        };

        this.#wsconn.onclose = () => {
            // what should we do here?
        };

        this.#wsconn.send(
            JSON.stringify({
                server: {
                    create: {
                        authToken: this.#peerConfig.authToken,
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
                15000,
            );
        });

        return inviteCode;
    }

    async #message (data) {
        if ( ! data.server ) return;
        if ( data.server.create ) {
            this.#oncreateresolve(data.server.create);
            return;
        }

        if ( data.server.connect ) {
            let uuid = data.server.connect.id;
            let connection = new PuterPeerConnection(this.#peerConfig);
            this.connections.set(uuid, connection);
            connection.peerconnection.onicecandidate = (e) => {
                if ( e.candidate ) {
                    this.#wsconn.send(
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
            if ( connection ) {
                await connection.setRemoteDescription(
                    new RTCSessionDescription(data.server.offer.offer),
                );
            }

            const answer = await connection.createAnswer();
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

    /**
     * Closes every client connection, then the signalling connection.
     *
     * @returns {void}
     */
    close () {
        for ( const [uuid, connection] of this.connections ) {
            connection.close();
        }
        this.#wsconn.onclose = null;
        this.#wsconn.close();
    }
}

class PuterPeerConnection extends EventTarget {
    #wsconn;
    peerconnection;

    /**
     * Information about the user who created the server.
     *
     * @type {import('../../types/modules/peer').PuterPeerUser | undefined}
     */
    owner;
    #peerConfig;
    #datachannel;
    connected = false;
    closed = false;
    #bufferedMessages = [];
    constructor (peerConfig) {
        super();
        this.#peerConfig = peerConfig;
        this.peerconnection = new RTCPeerConnection({
            iceTransportPolicy: peerConfig.forceRelay ? "relay" : "all",
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
     * Connects to the server that issued `invitecode`, resolving once the
     * offer has been exchanged. `puter.peer.connect()` calls this.
     *
     * @param {string} invitecode
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<void>}
     */
    async connect(invitecode, options = {}) {
        this.#wsconn = new WebSocket(this.#peerConfig.signallerUrl);
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
                        invitecode,
                        port: options.port,
                    },
                },
            }),
        );

        this.peerconnection.onicecandidate = (evt) => {
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
            let msg = JSON.parse(evt.data).client;
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
                    const offer = await this.createOffer();
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
                    this.#doclose(undefined, new Error(msg.connect.error));
                }
            }
            if ( msg.disconnect && !this.connected ) {
                this.#doclose(msg.disconnect.reason);
            }
        };
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

class Peer extends PuterModule {
    #signallerUrl;
    #turnServers;
    #fallbackIceServers;
    #turnTTL;
    #turnStartedAt;
    #turnFailed;

    /**
     * Fetches TURN relay credentials ahead of time so connections start
     * faster. Optional — `serve()` and `connect()` call it when needed — and
     * it resolves either way: if relays can't be loaded, connecting falls back
     * to the default ICE servers.
     *
     * @returns {Promise<void>}
     */
    async ensureTurnRelays () {
        if ( this.#turnFailed ) return;
        if ( this.#turnServers && Date.now() - this.#turnStartedAt < this.#turnTTL * 1000 ) return;

        const response = await fetchUrl(`${this.APIOrigin}/peer/generate-turn`, {
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

    async #resolvePeerConfig (options) {
        await this.#loadMetadata();
        let iceServers;
        if ( options?.iceServers ) {
            iceServers = options.iceServers;
        } else {
            await this.ensureTurnRelays();
            if ( this.#turnServers ) {
                iceServers = this.#turnServers;
            } else {
                iceServers = this.#fallbackIceServers;
                console.warn('Unable to use TURN relays. Some connections may fail.');
            }
        }

        return {
            authToken: this.authToken,
            iceServers,
            signallerUrl: this.#signallerUrl,
            forceRelay: options?.forceRelay
        };
    }
    /**
     * Creates a peer server and starts it, resolving to the server once it has
     * an invite code. Requires authentication.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<PuterPeerServer>}
     */
    async serve (options) {
        await this.#authenticateForPeerAction('create a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const server = new PuterPeerServer(peerConfig);
        await server.start(options);
        return server;
    }

    /**
     * Connects to a peer server using an invite code from `serve()`, resolving
     * once the offer has been exchanged. Requires authentication.
     *
     * @param {string} invitecode
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<PuterPeerConnection>}
     */
    async connect (invitecode, options) {
        await this.#authenticateForPeerAction('connect to a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const conn = new PuterPeerConnection(peerConfig);
        await conn.connect(invitecode, options);
        return conn;
    }
}

export default Peer;
