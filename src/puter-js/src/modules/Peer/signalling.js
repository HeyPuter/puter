/**
 * Carries SDP, ICE and hangups to the other end of one peer connection.
 * `PuterPeerConnection` owns the WebRTC state machine and reaches its peer
 * only through this, so serving and connecting differ in nothing but which
 * envelope their signals travel in.
 *
 * Subclasses supply `alive`, `close()`, and one send method per message:
 * `sendOffer(description, names, gen)`, `sendAnswer(description, names, re)`,
 * `sendCandidate(candidate)` and `sendBye(reason)`. Each send reports whether
 * the message left, since a description that was applied locally and never
 * reached the peer leaves the connection waiting for an answer that cannot
 * come.
 */
export class SignallingChannel {
    /**
     * `gen` numbers the offer, so the answer can say which offer it answers.
     * @type {(description: RTCSessionDescriptionInit, names?: Record<string, string>, gen?: number) => void}
     */
    onoffer = () => {};
    /**
     * `re` is the number of the offer this answers, when the peer sent one.
     * @type {(description: RTCSessionDescriptionInit, names?: Record<string, string>, re?: number) => void}
     */
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
    /** The peer reclaimed the session it dropped; it can answer again. */
    /** @type {() => void} */
    onpeerback = () => {};

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
        // `gen` and `re` are absent from older peers, and from a signaller
        // that does not pass them on.
        if ( envelope.offer ) {
            return this.onoffer(envelope.offer.offer, envelope.offer.names, sequence(envelope.offer.gen));
        }
        if ( envelope.answer ) {
            return this.onanswer(envelope.answer.answer, envelope.answer.names, sequence(envelope.answer.re));
        }
        if ( envelope.candidate ) {
            // End-of-candidates arrives as an explicit null from older peers.
            if ( envelope.candidate.candidate ) this.oncandidate(envelope.candidate.candidate);
            return;
        }
        if ( envelope.bye ) return this.onbye(envelope.bye.reason);
    }
}

/** An offer number as it arrives: a non-negative integer, or nothing. */
function sequence ( value ) {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Backoff for a client socket that dropped under a live connection. */
const CLIENT_RECONNECT_BASE_MS = 500;
/**
 * Kept short: a dropped client is usually a network that is back within
 * seconds, and its peer server gives a session whose client is away only so
 * long before giving the connection up.
 */
const CLIENT_RECONNECT_MAX_MS = 4000;

/**
 * The connecting side's channel. Owns its own websocket to the signaller.
 *
 * A socket that drops once the session is up is dialled again, and the
 * connect presents the resume token the first one was given, so the
 * signaller hands the same session back: the same id, so the peer server
 * addresses this client as it did, and nothing about the call changes.
 * Until it is back, `alive` is false; a reclaim that is turned down
 * strands the channel, and recovery stops waiting on it.
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
    #closed = false;
    #stranded = false;
    /** What the first connect said, said again on every reclaim. */
    #request = null;
    /** @type {string | undefined} */
    #resumeToken;
    #reconnectTimer = null;
    #reconnectAttempts = 0;

    constructor ( peerConfig ) {
        super();
        this.#peerConfig = peerConfig;
    }

    get alive () {
        return this.#attached;
    }

    /** The session is gone for good: nothing will carry a signal to the peer again. */
    get stranded () {
        return this.#stranded;
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
        this.#request = {
            authToken: this.#peerConfig.authToken,
            anonToken: options.anonToken,
            invitecode,
            port: options.port,
        };
        const ws = await this.#dial(this.#peerConfig.signallerUrl);
        ws.send(JSON.stringify({ client: { connect: this.#request } }));
    }

    /** Opens a socket and wires it up, resolving once it is open. */
    async #dial ( url ) {
        const ws = new WebSocket(url);
        this.#ws = ws;

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not reach the signalling server'));
            ws.onclose = () => reject(new Error('Connection closed unexpectedly'));
        });

        ws.onopen = null;
        ws.onerror = null;
        ws.onmessage = (evt) => this.#onMessage(evt, ws);
        ws.onclose = () => this.#onClosed(ws);
        return ws;
    }

    #scheduleReconnect () {
        if ( this.#closed || this.#stranded || this.#reconnectTimer || ! this.#resumeToken ) return;
        const attempt = this.#reconnectAttempts++;
        const backoff = Math.min(CLIENT_RECONNECT_MAX_MS, CLIENT_RECONNECT_BASE_MS * 2 ** attempt);
        const delay = backoff / 2 + Math.random() * (backoff / 2);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            void this.#reconnect();
        }, delay);
    }

    /**
     * Dials again and reclaims the session. The token goes in the URL too:
     * the signaller fixes a socket's address when it accepts it, before any
     * message, and this one has to come back under the old address.
     */
    async #reconnect () {
        if ( this.#closed || this.#stranded ) return;
        const url = new URL(this.#peerConfig.signallerUrl);
        url.searchParams.set('resume', this.#resumeToken);
        let ws;
        try {
            ws = await this.#dial(url.href);
        } catch {
            this.#ws = null;
            this.#scheduleReconnect();
            return;
        }
        if ( this.#closed ) {
            this.close();
            return;
        }
        ws.send(JSON.stringify({ client: { connect: { ...this.#request, resume: this.#resumeToken } } }));
    }

    sendOffer ( description, names, gen ) {
        return this.#post({ offer: { offer: description, names, gen } });
    }

    sendAnswer ( description, names, re ) {
        return this.#post({ answer: { answer: description, names, re } });
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
        // Gone on purpose: give the session up, so the peer server hears a
        // hangup rather than waiting for a return that will not come.
        if ( this.#attached ) this.#post({ release: {} });
        this.#closed = true;
        this.#attached = false;
        clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
        if ( ! this.#ws ) return;
        this.#ws.onclose = null;
        this.#ws.onmessage = null;
        this.#ws.close();
        this.#ws = null;
    }

    async #onMessage ( evt, ws ) {
        if ( ws !== this.#ws ) return;
        let msg;
        try {
            msg = JSON.parse(evt.data).client;
        } catch {
            return;
        }
        if ( ! msg ) return;

        if ( msg.connect ) {
            const reclaiming = this.#resumeToken !== undefined;
            if ( msg.connect.success ) {
                this.#attached = true;
                this.#resumeToken = msg.connect.resumeToken ?? this.#resumeToken;
                if ( reclaiming ) {
                    this.#reconnectAttempts = 0;
                    this.onusable();
                    return;
                }
                return this.onattached(msg.connect.owner);
            }
            if ( reclaiming ) {
                // The session lapsed, or its server is gone: nothing can be
                // reached through this channel again.
                this.#stranded = true;
                this.onunusable();
                return;
            }
            return this.onrejected(new Error(msg.connect.error));
        }
        if ( msg.reconnect ) {
            this.onpeerback();
            return;
        }
        if ( msg.disconnect ) {
            this.onpeergone(msg.disconnect.reason, !! msg.disconnect.resumable);
            return;
        }
        this.receive(msg);
    }

    #onClosed ( ws ) {
        if ( ws !== this.#ws ) return;
        this.#ws = null;
        this.#attached = false;
        this.onunusable();
        // Only a session that got as far as being attached is worth
        // reclaiming; a handshake that dropped has nothing to come back to.
        this.#scheduleReconnect();
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
    sendOffer ( description, names, gen ) {
        return this.#post({ offer: { offer: description, names, gen, id: this.#id } });
    }

    sendAnswer ( description, names, re ) {
        return this.#post({ answer: { answer: description, names, re, id: this.#id } });
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
