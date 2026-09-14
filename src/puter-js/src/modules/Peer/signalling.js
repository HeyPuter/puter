/**
 * An inbound signal. Only arriving messages need this shape - a sender
 * always knows what it is sending, so it names the message directly.
 *
 * @typedef {{
 *   description?: RTCSessionDescriptionInit,
 *   candidate?: RTCIceCandidateInit,
 *   bye?: { reason?: string },
 * }} PeerSignal
 */

/**
 * Maps a relayed envelope back onto a negotiation signal. Envelopes from a
 * peer server also carry the connection id, which is not part of the signal.
 *
 * @param {Record<string, Record<string, unknown>>} envelope
 * @returns {PeerSignal | null}
 */
export function decodeSignal ( envelope ) {
    if ( envelope.offer ) return { description: envelope.offer.offer };
    if ( envelope.answer ) return { description: envelope.answer.answer };
    if ( envelope.candidate ) {
        // End-of-candidates arrives as an explicit null from older peers.
        return envelope.candidate.candidate
            ? { candidate: envelope.candidate.candidate }
            : null;
    }
    if ( envelope.bye ) return { bye: { reason: envelope.bye.reason } };
    return null;
}

/**
 * The connection a relayed envelope belongs to. Every signal a peer server
 * receives is addressed, because one socket carries all of its clients.
 *
 * @param {Record<string, Record<string, unknown>>} envelope
 * @returns {string | undefined}
 */
export function signalTarget ( envelope ) {
    const payload = envelope.offer ?? envelope.answer ?? envelope.candidate ?? envelope.bye;
    return payload?.id;
}

/**
 * Carries SDP, ICE and hangups to the other end of one peer connection.
 * `PuterPeerConnection` owns the WebRTC state machine and reaches its peer
 * only through this, so serving and connecting differ in nothing but which
 * envelope their signals travel in.
 */
export class SignallingChannel {
    /** @type {(signal: PeerSignal) => void} */
    onsignal = () => {};
    /** Peer's signalling session ended. Evidence it hung up, never proof. */
    /** @type {(reason?: string) => void} */
    onpeergone = () => {};
    /** Our own signalling path died; renegotiation is unavailable. */
    /** @type {() => void} */
    onunusable = () => {};

    /** @returns {boolean} whether a signal sent right now would get through */
    get alive () {
        return false;
    }

    /** @param {RTCSessionDescriptionInit} _description @returns {void} */
    sendOffer ( _description ) {}

    /** @param {RTCSessionDescriptionInit} _description @returns {void} */
    sendAnswer ( _description ) {}

    /** @param {RTCIceCandidateInit} _candidate @returns {void} */
    sendCandidate ( _candidate ) {}

    /** @param {string} [_reason] @returns {void} */
    sendBye ( _reason ) {}

    /** @returns {void} */
    close () {}

    /**
     * Hands a signal to the connection on this end.
     *
     * @param {PeerSignal} signal
     * @returns {void}
     */
    deliver ( signal ) {
        this.onsignal(signal);
    }
}

/**
 * The connecting side's channel. Owns its own websocket to the signaller.
 */
export class ClientSignallingChannel extends SignallingChannel {
    /** Handshake accepted; carries the peer server's owner. */
    /** @type {(owner: import('../../../types/modules/peer').PuterPeerUser) => void} */
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
     * @param {import('../../../types/modules/peer').PuterPeerOptions} [options]
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

    sendOffer ( description ) {
        this.#post({ offer: { offer: description } });
    }

    sendAnswer ( description ) {
        this.#post({ answer: { answer: description } });
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

    #onMessage ( evt ) {
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
                this.onattached(msg.connect.owner);
            } else {
                this.onrejected(new Error(msg.connect.error));
            }
            return;
        }
        if ( msg.disconnect ) {
            this.onpeergone(msg.disconnect.reason);
            return;
        }

        const signal = decodeSignal(msg);
        if ( signal ) this.deliver(signal);
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
    sendOffer ( description ) {
        this.#post({ offer: { offer: description, id: this.#id } });
    }

    sendAnswer ( description ) {
        this.#post({ answer: { answer: description, id: this.#id } });
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

    /** @param {string} [reason] */
    peerGone ( reason ) {
        this.onpeergone(reason);
    }

    unusable () {
        this.onunusable();
    }
}
