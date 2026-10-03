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
    #offerQueued = false;
    /**
     * An offer was wanted and could not go: the signalling path was down, or
     * the send failed. The browser raises the negotiation flag once and
     * does not raise it again, so the offer is remembered here and made
     * when the path is back (`signallingRestored`).
     */
    #offerPending = false;
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

        this.#pc.onnegotiationneeded = () => this.#requestOffer();
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
        this.#requestOffer();
    }

    /**
     * Applies an offer from the peer. Offers are the only signal that can
     * collide, since an answer only ever replies to an offer we made.
     *
     * @param {RTCSessionDescriptionInit} description
     * @param {Record<string, string>} [names]
     * @param {number} [gen] the peer's number for this offer, echoed in our answer
     * @returns {Promise<void>}
     */
    acceptOffer ( description, names, gen ) {
        return this.#enqueue(() => this.#applyOffer(description, names, gen));
    }

    /**
     * @param {RTCSessionDescriptionInit} description
     * @param {Record<string, string>} [names]
     * @param {number} [re] the number of the offer this answers, where the
     *   peer (and the signaller between us) passed it back
     * @returns {Promise<void>}
     */
    acceptAnswer ( description, names, re ) {
        return this.#enqueue(() => this.#applyAnswer(description, names, re));
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
        // `restartIce()` only raises the negotiation flag, and a connection
        // that is mid-exchange - or a browser that has already spent the
        // event - never fires it. Ask for the offer rather than wait for it;
        // `#requestOffer` collapses this with the event's own request.
        this.#requestOffer();
        await negotiated;
    }

    /**
     * The signalling path is usable again, or the peer reclaimed its
     * session. An offer that could not go is made now - and so is one that
     * went out and was never answered, since the path it went down is the
     * one that just came back.
     *
     * @returns {void}
     */
    signallingRestored () {
        if ( this.#pc.signalingState === 'have-local-offer' ) this.#offerPending = true;
        this.#offerIfPending();
    }

    /**
     * The transport is connected again. An offer held back while it was not
     * goes now.
     *
     * @returns {void}
     */
    transportRestored () {
        this.#offerIfPending();
    }

    /**
     * Makes a remembered offer, once it can both reach the peer and not
     * collide with an ICE restart from it: while the transport is down the
     * impolite side may be restarting, and a polite offer crossing that
     * restart is rolled back at the worst moment (see PuterPeerConnection's
     * recovery). Any offer carries the whole of the current state, so a
     * restart offer that goes out meanwhile settles it too.
     */
    #offerIfPending () {
        if ( ! this.#offerPending || ! this.#enabled || ! this.#mayOffer ) return;
        if ( ! this.#channel.alive || this.#pc.connectionState !== 'connected' ) return;
        this.#requestOffer();
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

    /**
     * Queues one offer. Several things ask for the same one - the
     * negotiation flag, an ICE restart, a rolled-back offer that has to be
     * made again - and each extra offer is one the peer has to answer before
     * the exchange settles, so they collapse into the one already waiting.
     */
    #requestOffer () {
        if ( this.#offerQueued ) return;
        this.#offerQueued = true;
        this.#enqueue(() => {
            this.#offerQueued = false;
            return this.#offer();
        });
    }

    async #offer () {
        // Nothing can be offered, so anything waiting on one is waiting for
        // something that will not happen: say so now rather than let it
        // spend a whole answer timeout first.
        if ( ! this.#enabled || ! this.#mayOffer || ! this.#channel.alive
            || this.#pc.signalingState === 'closed' ) {
            // Only a missing path is worth coming back to: before the opening
            // exchange the browser raises the flag again itself once it is
            // settled, and a closed connection has nothing left to offer.
            if ( this.#enabled && this.#mayOffer && this.#pc.signalingState !== 'closed' ) {
                this.#offerPending = true;
            }
            this.#failUnboundWaiters(new Error('The connection cannot renegotiate'));
            return;
        }
        // Only what was already waiting when the description was built can
        // be carried by it: an ICE restart asked for during `createOffer`
        // belongs to the next offer, not this one.
        const carried = [...this.#waiters];
        try {
            this.#makingOffer = true;
            await this.#pc.setLocalDescription();
            const generation = ++this.#offerGeneration;
            if ( ! this.#channel.sendOffer(this.#pc.localDescription, this.#localNames(), generation) ) {
                this.#offerPending = true;
                await this.#abandonOffer();
                return;
            }
            this.#offerPending = false;
            this.#bindWaiters(generation, carried);
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

    async #applyOffer ( description, names, gen ) {
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
            const delivered = this.#channel.sendAnswer(pc.localDescription, this.#localNames(), gen);

            if ( pc.signalingState === 'stable' ) {
                // A side that only answers may renegotiate freely once the
                // opening exchange is behind it - that is what future track
                // additions need.
                this.#mayOffer = true;
                // Nothing raises the negotiation flag again for an offer that
                // was rolled back, so the replacement has to be asked for -
                // once there is a signalling path to carry it.
                if ( rebound && delivered ) this.#requestOffer();
            }
            if ( ! delivered ) {
                this.#failWaiters(new Error('The signalling connection is unavailable'));
            }
        } catch ( e ) {
            this.#onerror(e);
        }
    }

    async #applyAnswer ( description, names, re ) {
        const pc = this.#pc;
        // An answer with no offer of ours outstanding replies to one that has
        // since been rolled back or replaced - several restart offers held up
        // by a stalled socket arrive at once, and so do their answers. There
        // is nothing for it to settle.
        if ( pc.signalingState !== 'have-local-offer' ) return;
        // Nor is there for one that names an older offer than the one out
        // now. Applied, it would pair our newest description with the peer's
        // answer to an older one - an ICE restart answered with credentials
        // the peer has already replaced - and report the newest as settled.
        // An answer that names no offer comes from a peer, or through a
        // signaller, that does not pass the number back; it is taken as the
        // answer to the offer outstanding, as it always was.
        const answered = Number.isInteger(re) ? re : this.#offerGeneration;
        if ( answered !== this.#offerGeneration ) return;
        try {
            await this.#adopt(description, names);
            if ( pc.signalingState === 'stable' ) {
                this.#mayOffer = true;
                this.#settleNegotiation(answered);
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
        } catch {
            // Candidates are best effort. One left over from an offer that
            // was ignored, or from the ufrag an ICE restart just replaced,
            // has nothing to attach to - routine, and not the connection's
            // problem, which is what reporting it here would make it.
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

    /** Ties the waiters this offer carries to the offer just sent. */
    #bindWaiters ( generation, carried ) {
        for ( const waiter of carried ) {
            if ( this.#waiters.has(waiter) && waiter.generation === null ) {
                waiter.generation = generation;
            }
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

    /**
     * Settles the waiters whose offer this answer replied to - and those of
     * any offer it replaced, since the newer offer carried everything theirs
     * did. A waiter for an offer not yet sent waits on.
     */
    #settleNegotiation ( generation ) {
        for ( const waiter of [...this.#waiters] ) {
            if ( waiter.generation === null || waiter.generation > generation ) continue;
            this.#waiters.delete(waiter);
            waiter.settle();
        }
    }

    #failWaiters ( error ) {
        for ( const waiter of this.#waiters ) waiter.fail(error);
        this.#waiters.clear();
    }

    /** Fails only what is waiting for an offer that has not gone out yet. */
    #failUnboundWaiters ( error ) {
        for ( const waiter of [...this.#waiters] ) {
            if ( waiter.generation !== null ) continue;
            this.#waiters.delete(waiter);
            waiter.fail(error);
        }
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
