/**
 * Carries SDP, ICE and hangups to the other end of one peer connection.
 * `PuterPeerConnection` owns the WebRTC state machine and reaches its peer
 * only through this, so serving and connecting differ in nothing but which
 * envelope their signals travel in.
 *
 * Subclasses supply `alive`, `close()`, and one send method per message:
 * `sendOffer(description, names)`, `sendAnswer(description, names)`,
 * `sendCandidate(candidate)` and `sendBye(reason)`. Each send reports whether
 * the message left, since a description that was applied locally and never
 * reached the peer leaves the connection waiting for an answer that cannot
 * come.
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
    /**
     * Peer's signalling session ended. Evidence it hung up, never proof -
     * and when the signaller says the session is reclaimable, not even
     * that: the peer is expected back on it.
     */
    /** @type {(reason?: string, resumable?: boolean) => void} */
    onpeergone = () => {};
    /** Our own signalling path died; renegotiation is unavailable. */
    /** @type {() => void} */
    onunusable = () => {};
    /** It came back, and anything waiting on it may go ahead. */
    /** @type {() => void} */
    onusable = () => {};

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
    /** @type {(owner: import('./types.js').PuterPeerUser) => void | Promise<void>} */
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
        const ws = new WebSocket(this.#peerConfig.signallerUrl);
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
        return this.#post({ offer: { offer: description, names } });
    }

    sendAnswer ( description, names ) {
        return this.#post({ answer: { answer: description, names } });
    }

    sendCandidate ( candidate ) {
        return this.#post({ candidate: { candidate } });
    }

    sendBye ( reason ) {
        return this.#post({ bye: { reason } });
    }

    #post ( payload ) {
        if ( ! this.alive ) return false;
        try {
            this.#ws.send(JSON.stringify({ client: payload }));
            return true;
        } catch {
            // The socket closed underneath us; the caller undoes whatever it
            // had already applied locally.
            return false;
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
                return this.onattached(msg.connect.owner);
            }
            return this.onrejected(new Error(msg.connect.error));
        }
        if ( msg.disconnect ) {
            this.onpeergone(msg.disconnect.reason, !! msg.disconnect.resumable);
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
     * Set when the server re-registered without reclaiming its session. The
     * signaller has no route to this client any more and never will, so the
     * connection is better off hearing that at once than waiting out every
     * timeout it has.
     */
    #stranded = false;

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
        return ! this.#stranded && this.#server.signallingAlive;
    }

    get stranded () {
        return this.#stranded;
    }

    /** @returns {void} */
    strand () {
        if ( this.#stranded ) return;
        this.#stranded = true;
        this.onunusable();
    }

    // Every payload a peer server sends carries the connection id, since one
    // socket carries all of its clients.
    sendOffer ( description, names ) {
        return this.#post({ offer: { offer: description, names, id: this.#id } });
    }

    sendAnswer ( description, names ) {
        return this.#post({ answer: { answer: description, names, id: this.#id } });
    }

    sendCandidate ( candidate ) {
        return this.#post({ candidate: { candidate, id: this.#id } });
    }

    sendBye ( reason ) {
        return this.#post({ bye: { reason, id: this.#id } });
    }

    #post ( payload ) {
        if ( ! this.alive ) return false;
        return this.#server.relay(payload);
    }

    /** Nothing to close: the socket belongs to the server, not this channel. */
    close () {}

}
