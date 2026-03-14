let iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.blackberry.com:3478' },
];

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
    #conn;
    #oncreateresolve;

    #connections = new Map();
    #authToken;
    invitecode;
    #signallerUrl;

    constructor (signallerUrl, authToken) {
        super();
        this.#authToken = authToken;
        this.#signallerUrl = signallerUrl;
        this.#conn = new WebSocket(signallerUrl);
    }

    async start () {
        await new Promise((resolve, reject) => {
            this.#conn.onopen = resolve;
            this.#conn.onerror = reject;
            this.#conn.onclose = () => {
                reject(new Error('Connection closed unexpectedly'));
            };
        });

        this.#conn.onmessage = (event) => {
            let data = JSON.parse(event.data);
            this.message(data);
        };

        this.#conn.onclose = () => {
        };

        this.#conn.send(
            JSON.stringify({
                server: {
                    create: {
                        authToken: this.#authToken,
                    },
                },
            }),
        );

        const { invitecode } = await new Promise((resolve, reject) => {
            this.#oncreateresolve = (data) => {
                if ( data.success ) {
                    resolve({
                        invitecode: data.invitecode,
                    });
                    this.#oncreateresolve = null;
                    this.invitecode = data.invitecode;
                } else {
                    reject(new Error(data.error));
                }
            };
            setTimeout(
                () => reject(new Error('Server creation timed out')),
                15000,
            );
        });

        return invitecode;
    }

    async message (data) {
        if ( ! data.server ) return;
        if ( data.server.create ) {
            this.#oncreateresolve(data.server.create);
            return;
        }

        if ( data.server.connect ) {
            let uuid = data.server.connect.id;
            let connection = new PuterPeerConnection(this.#signallerUrl, this.#authToken);
            this.#connections.set(uuid, connection);
            connection.rtconn.onicecandidate = (e) => {
                if ( e.candidate ) {
                    this.#conn.send(
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
            this.#conn.send(
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

class PuterPeerConnection extends EventTarget {
    #wsconn;
    rtconn;
    #authToken;
    #signallerUrl;
    #datachannel;
    connected = false;
    closed = false;
    #bufferedMessages = [];
    constructor (signallerUrl, authToken) {
        super();
        this.#signallerUrl = signallerUrl;
        this.#authToken = authToken;
        this.rtconn = new RTCPeerConnection({ iceServers });
        this.#datachannel = this.rtconn.createDataChannel('channel-1', { negotiated: true, id: 2 });
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
            this.dispatchEvent(new PuterPeerConnectionCloseEvent());
            this.#closews();
        };
        this.#datachannel.onerror = (evt) => {
            this.dispatchEvent(new PuterPeerConnectionErrorEvent(evt.error));
            this.#closews();
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
        this.#wsconn = new WebSocket(this.#signallerUrl);
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
                        authToken: this.#authToken,
                        invitecode,
                    },
                },
            }),
        );

        this.rtconn.onicecandidate = (evt) => {
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
        if ( this.#wsconn ) this.#wsconn.close();
        if ( error ) this.dispatchEvent(new PuterPeerConnectionErrorEvent(error));
        this.dispatchEvent(new PuterPeerConnectionCloseEvent(reason));
    }

    close () {

    }

    async createOffer () {
        const offer = await this.rtconn.createOffer();
        this.rtconn.setLocalDescription(offer);
        return offer;
    }

    async createAnswer () {
        const answer = await this.rtconn.createAnswer();
        this.rtconn.setLocalDescription(answer);
        return answer;
    }

    setRemoteDescription (description) {
        this.rtconn.setRemoteDescription(description);
    }

    addIceCandidate (candidate) {
        this.rtconn.addIceCandidate(candidate);
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

    async #loadMetadata () {
        if ( this.#signallerUrl ) return;
        const response = await fetch(`${this.APIOrigin}peer/signaller-info`);
        if ( ! response.ok ) {
            throw new Error('Failed to get signaller info from Puter.');
        }
        const { url } = await response.json();
        this.#signallerUrl = url;
    }

    async serve () {
        if ( !this.authToken && this.puter.env === 'web' ) {
            try {
                await this.puter.ui.authenticateWithPuter();
            } catch (e) {
                throw new Error('Need authentication to create a server but failed to authenticate with Puter.');
            }
        }
        await this.#loadMetadata();
        const server = new PuterPeerServer(this.#signallerUrl, this.authToken);
        await server.start();
        return server;
    }

    async connect (invitecode) {
        if ( !this.authToken && this.puter.env === 'web' ) {
            try {
                await this.puter.ui.authenticateWithPuter();
            } catch (e) {
                throw new Error('Need authentication to connect to a server but failed to authenticate with Puter.');
            }
        }
        await this.#loadMetadata();
        const conn = new PuterPeerConnection(this.#signallerUrl, this.authToken);
        await conn.connect(invitecode);
        return conn;
    }
}

export default Peer;
