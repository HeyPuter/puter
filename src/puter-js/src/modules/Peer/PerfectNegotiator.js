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
    #localNames;
    #onRemoteNames;

    #makingOffer = false;
    #ignoreOffer = false;
    #enabled = false;
    #mayOffer = false;
    #tail = Promise.resolve();
    #waiters = new Set();
    #pendingCandidates = [];
    /**
     * Counts the local offers that have gone out. A caller waiting on a
     * negotiation waits for one particular offer, so an unrelated exchange
     * reaching `stable` - a track the peer added, say - cannot report someone
     * else's ICE restart as having been answered.
     */
    #offerGeneration = 0;

    /**
     * @param {RTCPeerConnection} peerconnection
     * @param {import('./signalling.js').SignallingChannel} channel
     * @param {{
     *   polite: boolean,
     *   onerror: (error: Error) => void,
     *   localNames?: () => Record<string, string>,
     *   onRemoteNames?: (names: Record<string, string>) => import('./tracks.js').StagedNames | null,
     * }} options
     */
    constructor ( peerconnection, channel, { polite, onerror, localNames, onRemoteNames } ) {
        this.#pc = peerconnection;
        this.#channel = channel;
        this.#polite = polite;
        this.#onerror = onerror;
        this.#localNames = localNames ?? (() => ({}));
        this.#onRemoteNames = onRemoteNames ?? (() => null);

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
     * Applies an offer from the peer. Offers are the only signal that can
     * collide, since an answer only ever replies to an offer we made.
     *
     * @param {RTCSessionDescriptionInit} description
     * @param {Record<string, string>} [names]
     * @returns {Promise<void>}
     */
    acceptOffer ( description, names ) {
        return this.#enqueue(() => this.#applyOffer(description, names));
    }

    /**
     * @param {RTCSessionDescriptionInit} description
     * @param {Record<string, string>} [names]
     * @returns {Promise<void>}
     */
    acceptAnswer ( description, names ) {
        return this.#enqueue(() => this.#applyAnswer(description, names));
    }

    /**
     * @param {RTCIceCandidateInit} candidate
     * @returns {Promise<void>}
     */
    acceptCandidate ( candidate ) {
        return this.#enqueue(() => this.#applyCandidate(candidate));
    }

    /**
     * Restarts ICE and resolves once the peer has answered the offer that
     * carries the restart. Rejecting is the clearest evidence available that
     * the peer is gone rather than merely unreachable: signalling travels a
     * different path from the broken media one, so a peer that is still there
     * answers over it.
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
        this.#failWaiters(new Error('The connection closed while negotiating'));
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
            const generation = ++this.#offerGeneration;
            if ( ! this.#channel.sendOffer(this.#pc.localDescription, this.#localNames()) ) {
                await this.#abandonOffer();
                return;
            }
            this.#bindWaiters(generation);
        } catch ( e ) {
            this.#onerror(e);
        } finally {
            this.#makingOffer = false;
        }
    }

    /**
     * An offer that never reached the peer leaves the connection waiting for
     * an answer that cannot come, so it is rolled back to `stable` where the
     * next negotiation can start from. Anything waiting fails now rather than
     * spending its whole timeout on a signal that was never sent.
     */
    async #abandonOffer () {
        try {
            if ( this.#pc.signalingState === 'have-local-offer' ) {
                await this.#pc.setLocalDescription({ type: 'rollback' });
            }
        } catch {
            // Best effort: the failure reported below is what matters.
        }
        this.#failWaiters(new Error('The signalling connection is unavailable'));
    }

    async #applyOffer ( description, names ) {
        const pc = this.#pc;
        if ( pc.signalingState === 'closed' ) return;

        const collision = this.#makingOffer || pc.signalingState !== 'stable';
        // Only the impolite side may ignore an offer. The polite side rolls
        // its own back inside setRemoteDescription and answers instead.
        this.#ignoreOffer = ! this.#polite && collision;
        if ( this.#ignoreOffer ) return;

        // Our own offer is about to be rolled back, so whatever was waiting on
        // it has to wait for the offer that replaces it.
        const rebound = collision && this.#rebindWaiters();

        try {
            await this.#adopt(description, names);
            await pc.setLocalDescription();
            const delivered = this.#channel.sendAnswer(pc.localDescription, this.#localNames());

            if ( pc.signalingState === 'stable' ) {
                // A side that only answers may renegotiate freely once the
                // opening exchange is behind it - that is what future track
                // additions need.
                this.#mayOffer = true;
                // Nothing raises the negotiation flag again for an offer that
                // was rolled back, so the replacement has to be asked for -
                // once there is a signalling path to carry it.
                if ( rebound && delivered ) this.#enqueue(() => this.#offer());
            }
            if ( ! delivered ) {
                this.#failWaiters(new Error('The signalling connection is unavailable'));
            }
        } catch ( e ) {
            this.#onerror(e);
        }
    }

    async #applyAnswer ( description, names ) {
        const pc = this.#pc;
        if ( pc.signalingState === 'closed' ) return;
        try {
            await this.#adopt(description, names);
            if ( pc.signalingState === 'stable' ) {
                this.#mayOffer = true;
                this.#settleNegotiation();
            }
        } catch ( e ) {
            this.#onerror(e);
        }
    }

    /**
     * Names go on before the description, because ontrack fires while one is
     * being applied and a track has to be named by then. Retiring the names
     * the peer dropped waits until the description has actually applied: a
     * description that is rejected leaves its tracks flowing.
     */
    async #adopt ( description, names ) {
        const staged = names ? this.#onRemoteNames(names) : null;
        try {
            await this.#pc.setRemoteDescription(description);
        } catch ( e ) {
            staged?.rollback();
            throw e;
        }
        staged?.commit();
        await this.#flushCandidates();
    }

    async #applyCandidate ( candidate ) {
        const pc = this.#pc;
        if ( pc.signalingState === 'closed' ) return;
        // A candidate that overtakes the description it belongs to has nothing
        // to attach to yet, so hold it rather than drop it.
        if ( ! pc.remoteDescription ) {
            this.#pendingCandidates.push(candidate);
            return;
        }
        await this.#addCandidate(candidate);
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

    /** Ties everything waiting for a negotiation to the offer just sent. */
    #bindWaiters ( generation ) {
        for ( const waiter of this.#waiters ) {
            if ( waiter.generation === null ) waiter.generation = generation;
        }
    }

    /**
     * Releases waiters from an offer that was discarded, so they attach to
     * the next one instead. Reports whether anything was waiting.
     */
    #rebindWaiters () {
        let rebound = false;
        for ( const waiter of this.#waiters ) {
            if ( waiter.generation === null ) continue;
            waiter.generation = null;
            rebound = true;
        }
        return rebound;
    }

    /** Settles the waiters whose offer this answer replied to. */
    #settleNegotiation () {
        for ( const waiter of [...this.#waiters] ) {
            if ( waiter.generation === null ) continue;
            this.#waiters.delete(waiter);
            waiter.settle();
        }
    }

    #failWaiters ( error ) {
        for ( const waiter of this.#waiters ) waiter.fail(error);
        this.#waiters.clear();
    }

    #nextNegotiation ( timeout ) {
        return new Promise((resolve, reject) => {
            const waiter = {
                /** The local offer this is waiting on; set once one is sent. */
                generation: null,
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
