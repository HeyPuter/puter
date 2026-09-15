const ROOM_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const INVITE_CODE_RE = /^[A-Z0-9]{0,4}-[0-9A-F]{6}$/;

/**
 * Whether a string is a room name rather than a generated invite code.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isRoomName (value) {
    return typeof value === 'string' && ROOM_NAME_RE.test(value) && !INVITE_CODE_RE.test(value);
}

/**
 * @param {string} signallerUrl
 * @param {string | undefined} room
 * @returns {string}
 */
export function signallerUrlFor (signallerUrl, room) {
    if ( ! room ) return signallerUrl;
    const url = new URL(signallerUrl);
    url.searchParams.set('room', room);
    return url.toString();
}

/**
 * @param {string} message
 * @param {string} [code]
 * @returns {Error & { code?: string }}
 */
export function signallerError (message, code) {
    const error = /** @type {Error & { code?: string }} */ (new Error(message));
    if ( code ) error.code = code;
    return error;
}

/**
 * Carries SDP, ICE and hangups to the other end of one peer connection.
 * `PuterPeerConnection` owns the WebRTC state machine and reaches its peer
 * only through this, so serving and connecting differ in nothing but which
 * envelope their signals travel in.
 *
 * Subclasses supply `alive`, `close()`, and one send method per message:
 * `sendOffer(description, names)`, `sendAnswer(description, names)`,
 * `sendCandidate(candidate)` and `sendBye(reason)`.
 */
export class SignallingChannel {
    /** @type {(description: RTCSessionDescriptionInit, names?: Record<string, string>) => void} */
    onoffer = () => {};
    /** @type {(description: RTCSessionDescriptionInit, names?: Record<string, string>) => void} */
    onanswer = () => {};
    /** @type {(candidate: RTCIceCandidateInit) => void} */
    oncandidate = () => {};
    /** @type {(reason?: string) => void} */
    onbye = () => {};
    /** Peer's signalling session ended. Evidence it hung up, never proof. */
    /** @type {(reason?: string) => void} */
    onpeergone = () => {};
    /** Our own signalling path died; renegotiation is unavailable. */
    /** @type {() => void} */
    onunusable = () => {};

    /**
     * Reads one relayed envelope and calls the handler for what it holds.
     * A peer server's envelopes also carry the connection id, which is
     * routing rather than signal, and is ignored here.
     *
     * @param {Record<string, Record<string, unknown>>} envelope
     * @returns {void}
     */
    receive ( envelope ) {
        // `names` is absent from a peer that publishes no named media; an
        // empty object from one publishing none. The two are not the same.
        if ( envelope.offer ) return this.onoffer(envelope.offer.offer, envelope.offer.names);
        if ( envelope.answer ) return this.onanswer(envelope.answer.answer, envelope.answer.names);
        if ( envelope.candidate ) {
            // End-of-candidates arrives as an explicit null from older peers.
            if ( envelope.candidate.candidate ) this.oncandidate(envelope.candidate.candidate);
            return;
        }
        if ( envelope.bye ) return this.onbye(envelope.bye.reason);
    }
}

/**
 * The connecting side's channel. Owns its own websocket to the signaller.
 */
export class ClientSignallingChannel extends SignallingChannel {
    /** Handshake accepted; carries the peer server's owner. */
    /** @type {(owner: import('./types.js').PuterPeerUser, grant?: string, room?: string) => void | Promise<void>} */
    onattached = () => {};
    /** @type {(error: Error) => void} */
    onrejected = () => {};

    #peerConfig;
    #ws = null;
    #attached = false;

    constructor ( peerConfig ) {
        super();
        this.#peerConfig = peerConfig;
    }

    get alive () {
        return this.#attached;
    }

    /**
     * Opens the socket and sends the connect request, resolving once it is
     * away. The handshake result arrives later, through `onattached` or
     * `onrejected`.
     *
     * @param {string} invitecode
     * @param {import('./types.js').PuterPeerOptions} [options]
     * @returns {Promise<void>}
     */
    async open ( invitecode, options = {} ) {
        const room = ! options.port && isRoomName(invitecode) ? invitecode : undefined;
        const ws = new WebSocket(signallerUrlFor(this.#peerConfig.signallerUrl, room));
        this.#ws = ws;

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not reach the signalling server'));
            ws.onclose = () => reject(new Error('Connection closed unexpectedly'));
        });

        ws.onopen = null;
        ws.onerror = null;
        ws.onmessage = (evt) => this.#onMessage(evt);
        ws.onclose = () => this.#onClosed();

        ws.send(
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
    }

    sendOffer ( description, names ) {
        this.#post({ offer: { offer: description, names } });
    }

    sendAnswer ( description, names ) {
        this.#post({ answer: { answer: description, names } });
    }

    sendCandidate ( candidate ) {
        this.#post({ candidate: { candidate } });
    }

    sendBye ( reason ) {
        this.#post({ bye: { reason } });
    }

    #post ( payload ) {
        if ( ! this.alive ) return;
        try {
            this.#ws.send(JSON.stringify({ client: payload }));
        } catch {
            // socket closed underneath us; recovery keys off `alive` instead
        }
    }

    close () {
        this.#attached = false;
        if ( ! this.#ws ) return;
        this.#ws.onclose = null;
        this.#ws.onmessage = null;
        this.#ws.close();
        this.#ws = null;
    }

    async #onMessage ( evt ) {
        let msg;
        try {
            msg = JSON.parse(evt.data).client;
        } catch {
            return;
        }
        if ( ! msg ) return;

        if ( msg.connect ) {
            if ( msg.connect.success ) {
                this.#attached = true;
                return this.onattached(msg.connect.owner, msg.connect.grant, msg.connect.room);
            } else {
                return this.onrejected(signallerError(msg.connect.error, msg.connect.code));
            }
            return;
        }
        if ( msg.disconnect ) {
            this.onpeergone(msg.disconnect.reason);
            return;
        }
        this.receive(msg);
    }

    #onClosed () {
        this.#attached = false;
        this.onunusable();
    }
}

/**
 * A serving side channel. Peer servers multiplex every client over one
 * websocket, so this borrows the server's socket and tags what it sends with
 * the connection id that socket's far end uses to tell clients apart.
 */
export class ServerSignallingChannel extends SignallingChannel {
    #server;
    #id;

    /**
     * @param {import('./PuterPeerServer.js').PuterPeerServer} server
     * @param {string} id
     */
    constructor ( server, id ) {
        super();
        this.#server = server;
        this.#id = id;
    }

    get alive () {
        return this.#server.signallingAlive;
    }

    // Every payload a peer server sends carries the connection id, since one
    // socket carries all of its clients.
    sendOffer ( description, names ) {
        this.#post({ offer: { offer: description, names, id: this.#id } });
    }

    sendAnswer ( description, names ) {
        this.#post({ answer: { answer: description, names, id: this.#id } });
    }

    sendCandidate ( candidate ) {
        this.#post({ candidate: { candidate, id: this.#id } });
    }

    sendBye ( reason ) {
        this.#post({ bye: { reason, id: this.#id } });
    }

    #post ( payload ) {
        if ( ! this.alive ) return;
        this.#server.relay(payload);
    }

    /** Nothing to close: the socket belongs to the server, not this channel. */
    close () {}

}
