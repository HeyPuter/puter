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

    /** @type {Map<string, PuterPeerConnection>} */
    #connections = new Map();
    inviteCode;
    #peerConfig;

    constructor (peerConfig) {
        super();
        this.#peerConfig = peerConfig;
        this.#wsconn = new WebSocket(peerConfig.signallerUrl);
    }

    async start () {
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
            this.#connections.set(uuid, connection);
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
            let connection = this.#connections.get(uuid);
            if ( connection ) {
                await connection.addIceCandidate(
                    data.server.candidate.candidate,
                );
            }
        }

        if ( data.server.offer ) {
            let uuid = data.server.offer.id;
            let connection = this.#connections.get(uuid);
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

    close () {
        for ( const [uuid, connection] of this.#connections ) {
            connection.close();
        }
        this.#wsconn.onclose = null;
        this.#wsconn.close();
    }
}

class PuterPeerConnection extends EventTarget {
    #wsconn;
    peerconnection;
    #peerConfig;
    #datachannel;
    connected = false;
    closed = false;
    #bufferedMessages = [];
    constructor (peerConfig) {
        super();
        this.#peerConfig = peerConfig;
        this.peerconnection = new RTCPeerConnection({
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

    async connect (invitecode) {
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

    close (reason) {
        this.#doclose(reason, undefined);
    }

    async createOffer () {
        const offer = await this.peerconnection.createOffer();
        await this.peerconnection.setLocalDescription(offer);
        return offer;
    }

    async createAnswer () {
        const answer = await this.peerconnection.createAnswer();
        await this.peerconnection.setLocalDescription(answer);
        return answer;
    }

    async setRemoteDescription (description) {
        await this.peerconnection.setRemoteDescription(description);
    }

    async addIceCandidate (candidate) {
        await this.peerconnection.addIceCandidate(candidate);
    }

    send ( message ) {
        if ( ! this.connected ) {
            this.#bufferedMessages.push(message);
            return;
        }
        this.#datachannel.send(message);
    }
}

class Peer {
    #signallerUrl;
    #turnServers;
    #fallbackIceServers;
    #turnTTL;
    #turnStartedAt;
    #turnFailed;
    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (puter) {
        this.puter = puter;
        this.authToken = puter.authToken;
        this.APIOrigin = puter.APIOrigin;
        this.appID = puter.appID;
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [OS]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     *
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Apps]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    async ensureTurnRelays () {
        if ( this.#turnFailed ) return;
        if ( this.#turnServers && Date.now() - this.#turnStartedAt < this.#turnTTL * 1000 ) return;

        const response = await fetch(`${this.APIOrigin}/peer/generate-turn`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.authToken}`,
            },
        });

        if ( ! response.ok ) {
            this.#turnFailed = true;
            return;
        }

        const { iceServers, ttl, fallbackIce } = await response.json();
        this.#fallbackIceServers = fallbackIce;
        this.#turnServers = iceServers;
        this.#turnTTL = ttl;
        this.#turnStartedAt = Date.now();
    }

    async #loadMetadata () {
        if ( this.#signallerUrl ) return;
        const response = await fetch(`${this.APIOrigin}/peer/signaller-info`);
        if ( ! response.ok ) {
            throw new Error('Failed to get signaller info from Puter.');
        }
        const { url } = await response.json();
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
        };
    }
    async serve (options) {
        await this.#authenticateForPeerAction('create a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const server = new PuterPeerServer(peerConfig);
        await server.start();
        return server;
    }

    async connect (invitecode, options) {
        await this.#authenticateForPeerAction('connect to a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const conn = new PuterPeerConnection(peerConfig);
        await conn.connect(invitecode);
        return conn;
    }
}

export default Peer;
