/** @typedef {import('./signalling.js').PeerSignal} PeerSignal */

/** How long a renegotiation offer may go unanswered before the peer counts as gone. */
export const DEFAULT_ANSWER_TIMEOUT = 8000;

/**
 * Drives SDP for one peer connection using the perfect negotiation pattern,
 * so either side may renegotiate at any time - to restart ICE, or to add a
 * track - without the two colliding.
 *
 * Exactly one side is polite. On a collision the polite side rolls its own
 * offer back and answers; the impolite side ignores the incoming offer and
 * lets its own stand. Everything is applied through a single queue, because
 * an ICE candidate that overtakes the description it belongs to has nowhere
 * to land.
 */
export class PerfectNegotiator {
    #pc;
    #channel;
    #polite;
    #onerror;

    #makingOffer = false;
    #ignoreOffer = false;
    #enabled = false;
    #mayOffer = false;
    #tail = Promise.resolve();
    #waiters = new Set();
    #pendingCandidates = [];

    /**
     * @param {RTCPeerConnection} peerconnection
     * @param {import('./signalling.js').SignallingChannel} channel
     * @param {{ polite: boolean, onerror: (error: Error) => void }} options
     */
    constructor ( peerconnection, channel, { polite, onerror } ) {
        this.#pc = peerconnection;
        this.#channel = channel;
        this.#polite = polite;
        this.#onerror = onerror;

        this.#pc.onnegotiationneeded = () => this.#enqueue(() => this.#offer());
        this.#pc.onicecandidate = ({ candidate }) => {
            if ( candidate ) this.#channel.sendCandidate(candidate);
        };
    }

    /**
     * Answers negotiation, but does not open it. The serving side waits for
     * the connecting side's first offer - offering into it would only collide
     * - and earns the right to offer once that exchange has settled.
     *
     * @returns {void}
     */
    enable () {
        this.#enabled = true;
    }

    /**
     * Opens negotiation with an offer. The data channel raises the
     * negotiation flag while the signalling handshake is still in flight and
     * the browser only delivers that event once, so the first offer has to be
     * asked for rather than waited on.
     *
     * @returns {void}
     */
    start () {
        this.#enabled = true;
        if ( this.#mayOffer ) return;
        this.#mayOffer = true;
        this.#enqueue(() => this.#offer());
    }

    /**
     * Applies a signal from the peer, one at a time and in arrival order.
     *
     * @param {PeerSignal} signal
     * @returns {Promise<void>}
     */
    accept ( signal ) {
        return this.#enqueue(() => this.#apply(signal));
    }

    /**
     * Restarts ICE and resolves once the peer has negotiated back. Rejecting
     * is the clearest evidence available that the peer is gone rather than
     * merely unreachable: signalling travels a different path from the broken
     * media one, so a peer that is still there answers over it.
     *
     * @param {number} [timeout]
     * @returns {Promise<void>}
     */
    async restartIce ( timeout = DEFAULT_ANSWER_TIMEOUT ) {
        const negotiated = this.#nextNegotiation(timeout);
        this.#pc.restartIce();
        await negotiated;
    }

    /**
     * Detaches from the peer connection and fails anything still waiting.
     *
     * @returns {void}
     */
    stop () {
        this.#enabled = false;
        this.#mayOffer = false;
        this.#pc.onnegotiationneeded = null;
        this.#pc.onicecandidate = null;
        this.#pendingCandidates = [];
        for ( const waiter of this.#waiters ) {
            waiter.fail(new Error('The connection closed while negotiating'));
        }
        this.#waiters.clear();
    }

    #enqueue ( task ) {
        const next = this.#tail.then(task);
        this.#tail = next.catch(() => {});
        return next;
    }

    async #offer () {
        if ( ! this.#enabled || ! this.#mayOffer || ! this.#channel.alive ) return;
        if ( this.#pc.signalingState === 'closed' ) return;
        try {
            this.#makingOffer = true;
            await this.#pc.setLocalDescription();
            this.#channel.sendOffer(this.#pc.localDescription);
        } catch ( e ) {
            this.#onerror(e);
        } finally {
            this.#makingOffer = false;
        }
    }

    /** @param {PeerSignal} signal */
    async #apply ( { description, candidate } ) {
        const pc = this.#pc;
        if ( pc.signalingState === 'closed' ) return;
        try {
            if ( description ) {
                const collision = description.type === 'offer'
                    && ( this.#makingOffer || pc.signalingState !== 'stable' );

                // Only the impolite side may ignore an offer. The polite side
                // rolls its own back inside setRemoteDescription and answers.
                this.#ignoreOffer = ! this.#polite && collision;
                if ( this.#ignoreOffer ) return;

                await pc.setRemoteDescription(description);
                await this.#flushCandidates();
                if ( description.type === 'offer' ) {
                    await pc.setLocalDescription();
                    this.#channel.sendAnswer(pc.localDescription);
                }
                if ( pc.signalingState === 'stable' ) this.#settle();
                return;
            }

            if ( candidate ) {
                // A candidate that overtakes the description it belongs to has
                // nothing to attach to yet, so hold it rather than drop it.
                if ( ! pc.remoteDescription ) {
                    this.#pendingCandidates.push(candidate);
                    return;
                }
                await this.#addCandidate(candidate);
            }
        } catch ( e ) {
            this.#onerror(e);
        }
    }

    async #addCandidate ( candidate ) {
        try {
            await this.#pc.addIceCandidate(candidate);
        } catch ( e ) {
            // Candidates belonging to an offer we ignored have no description
            // to attach to; that is expected, not a fault.
            if ( ! this.#ignoreOffer ) this.#onerror(e);
        }
    }

    async #flushCandidates () {
        if ( this.#pendingCandidates.length === 0 ) return;
        const pending = this.#pendingCandidates;
        this.#pendingCandidates = [];
        for ( const candidate of pending ) {
            await this.#addCandidate(candidate);
        }
    }

    #settle () {
        // A side that only answers may renegotiate freely once the opening
        // exchange is behind it - that is what future track additions need.
        this.#mayOffer = true;
        for ( const waiter of this.#waiters ) waiter.settle();
        this.#waiters.clear();
    }

    #nextNegotiation ( timeout ) {
        return new Promise((resolve, reject) => {
            const waiter = {
                settle: () => {
                    clearTimeout(timer);
                    resolve();
                },
                fail: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            };
            const timer = setTimeout(() => {
                this.#waiters.delete(waiter);
                reject(new Error('The peer did not answer'));
            }, timeout);
            this.#waiters.add(waiter);
        });
    }
}
