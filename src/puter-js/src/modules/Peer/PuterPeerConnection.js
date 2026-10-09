import { DEFAULT_ANSWER_TIMEOUT, PerfectNegotiator } from './PerfectNegotiator.js';
import { TrackPublisher } from './tracks.js';
import { ClientSignallingChannel } from './signalling.js';
import {
    PuterPeerConnectionCloseEvent,
    PuterPeerConnectionErrorEvent,
    PuterPeerConnectionMessageEvent,
    PuterPeerConnectionOpenEvent,
    PuterPeerLinkStateEvent,
} from './events.js';

/** @typedef {import('./types.js').PuterPeerMessage} PuterPeerMessage */
/** @typedef {import('./types.js').PuterPeerOptions} PuterPeerOptions */
/** @typedef {import('./tracks.js').PuterPeerPublishOptions} PuterPeerPublishOptions */
/** @typedef {import('./events.js').PuterPeerConnectionEventMap} PuterPeerConnectionEventMap */
/** @typedef {import('./events.js').PuterPeerLinkState} PuterPeerLinkState */

/**
 * How long to keep trying to rescue a link before giving it up, counted from
 * the first sign of trouble rather than from the transport failing: Chrome
 * takes a further ten seconds or so to call a silent link `failed`, and an
 * app waiting to act on a peer that vanished should not have to add that on.
 * Apps can shorten it with the `recoveryTimeout` option.
 *
 * Counted in time rather than attempts, because what recovery is usually
 * waiting on is the peer coming back - a lid reopened, a network rejoined -
 * and that takes as long as it takes. A minute covers the ordinary cases
 * and still ends a call to someone who is not coming back.
 */
const RECOVERY_BUDGET_MS = 60_000;

/**
 * How long recovery keeps trying once the peer's own signalling session has
 * ended. Until it comes back they cannot answer an offer at all, so the
 * budget above would be spent on a peer that provably cannot reply - and an
 * app waiting on this connection to close before it acts (to elect a new
 * host, say) would wait that whole time for an answer it was never getting.
 */
const PEER_AWAY_GRACE_MS = 10_000;

/** Gap between restart attempts, doubling, so a long wait stays quiet. */
const RECOVERY_BACKOFF_MS = 2000;
const RECOVERY_BACKOFF_MAX_MS = 15_000;

/** How long an answered restart is given to bring the transport back. */
const TRANSPORT_SETTLE_TIMEOUT = 8000;

/**
 * A WebRTC data channel connection to a peer, and the negotiation that keeps
 * it alive. Both ends of a connection are one of these; they differ only in
 * which signalling channel they were handed and which of them is polite.
 */
export class PuterPeerConnection extends EventTarget {
    peerconnection;

    /**
     * Information about the user who created the server.
     *
     * @type {import('./types.js').PuterPeerUser | undefined}
     */
    owner;

    connected = false;
    closed = false;

    /**
     * How the media path is doing, which is more than the transport's own
     * state says: 'unstable' is a wobble nothing is being done about yet,
     * 'recovering' is an ICE restart actually in flight.
     *
     * @type {PuterPeerLinkState}
     */
    linkState = 'connecting';

    #peerConfig;
    #channel;
    #negotiator;
    #tracks;
    #datachannel;
    #bufferedMessages = [];
    #recovering = false;
    /** The peer said goodbye, or closed the channel. Proof, not evidence. */
    #peerHungUp = false;
    /** The peer's signalling session ended and has not come back. */
    #peerAway = false;
    #transportWaiters = new Set();
    #signallingWaiters = new Set();
    #recoveryBudget;
    #polite;
    /** When the transport last left `connected`; recovery's budget runs from here. */
    #troubleSince = null;
    /** Ends the connection once the budget is spent, whether or not recovery ever began. */
    #troubleTimer = null;

    /**
     * @param {object} peerConfig
     * @param {{
     *   polite?: boolean,
     *   channel?: import('./signalling.js').SignallingChannel,
     *   recoveryTimeout?: number,
     * }} [options]
     */
    constructor ( peerConfig, { polite = false, channel, recoveryTimeout = RECOVERY_BUDGET_MS } = {} ) {
        super();
        this.#peerConfig = peerConfig;
        this.#polite = polite;
        this.#recoveryBudget = recoveryTimeout;
        this.#channel = channel ?? new ClientSignallingChannel(peerConfig);

        this.peerconnection = new RTCPeerConnection({
            iceTransportPolicy: peerConfig.forceRelay ? 'relay' : 'all',
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
        };
        this.#datachannel.onclose = () => {
            // A channel the peer closed cleanly is a hangup, not a fault.
            this.#peerHungUp = true;
            this.#doclose(undefined, undefined);
        };
        this.#datachannel.onerror = (evt) => {
            this.#doclose(undefined, evt.error);
        };

        this.#tracks = new TrackPublisher(this.peerconnection, this);

        this.#negotiator = new PerfectNegotiator(this.peerconnection, this.#channel, {
            polite,
            onerror: (error) => this.dispatchEvent(new PuterPeerConnectionErrorEvent(error)),
            localNames: () => this.#tracks.localNames(),
            onRemoteNames: (names) => this.#tracks.stageRemoteNames(names),
        });

        this.peerconnection.onconnectionstatechange = () => this.#onConnectionState();

        this.#channel.onoffer = (description, names, gen) => this.#negotiator.acceptOffer(description, names, gen);
        this.#channel.onanswer = (description, names, re) => this.#negotiator.acceptAnswer(description, names, re);
        this.#channel.oncandidate = (candidate) => this.#negotiator.acceptCandidate(candidate);
        this.#channel.onbye = (reason) => this.#onBye(reason);
        this.#channel.onpeergone = (reason, resumable) => this.#onPeerGone(reason, resumable);
        this.#channel.onunusable = () => this.#onSignallingLost();
        this.#channel.onusable = () => {
            this.#wakeSignallingWaiters();
            this.#negotiator.signallingRestored();
        };
        this.#channel.onpeerback = () => this.#onPeerBack();
    }

    /**
     * @template {keyof PuterPeerConnectionEventMap} K
     * @overload
     * @param {K} type
     * @param {(this: PuterPeerConnection, event: PuterPeerConnectionEventMap[K]) => void} listener
     * @param {boolean | AddEventListenerOptions} [options]
     * @returns {void}
     */
    /**
     * @overload
     * @param {string} type
     * @param {EventListenerOrEventListenerObject | null} listener
     * @param {boolean | AddEventListenerOptions} [options]
     * @returns {void}
     */
    /**
     * @param {string} type
     * @param {any} listener
     * @param {boolean | AddEventListenerOptions} [options]
     * @returns {void}
     */
    addEventListener ( type, listener, options ) {
        super.addEventListener(type, listener, options);
    }

    /**
     * @template {keyof PuterPeerConnectionEventMap} K
     * @overload
     * @param {K} type
     * @param {(this: PuterPeerConnection, event: PuterPeerConnectionEventMap[K]) => void} listener
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    /**
     * @overload
     * @param {string} type
     * @param {EventListenerOrEventListenerObject | null} listener
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    /**
     * @param {string} type
     * @param {any} listener
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    removeEventListener ( type, listener, options ) {
        super.removeEventListener(type, listener, options);
    }

    /**
     * Connects to the server that issued `invitecode`, resolving once the
     * connect request is away. `puter.peer.connect()` calls this.
     *
     * @param {string} invitecode
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<void>}
     */
    async connect ( invitecode, options = {} ) {
        this.#channel.onattached = (owner) => {
            this.owner = owner;
            // The connecting side makes the opening offer.
            this.#negotiator.start();
        };
        this.#channel.onrejected = (error) => this.#doclose(undefined, error);
        await this.#channel.open(invitecode, options);
    }

    /**
     * Begins answering negotiation without offering. Peer servers wait for
     * the connecting side's offer, but must still be able to renegotiate.
     *
     * @returns {void}
     */
    acceptNegotiation () {
        this.#negotiator.enable();
    }

    /** The peer said goodbye, so there is nothing to recover. */
    #onBye ( reason ) {
        this.#peerHungUp = true;
        this.#doclose(reason, undefined);
    }

    /**
     * The peer's signalling session ended. Evidence they hung up, never
     * proof - the data channel may still be carrying traffic - so while we
     * are connected it decides nothing and recovery is left to find out.
     * A session the signaller says is reclaimable is not even evidence:
     * the peer is expected back on it.
     *
     * @param {string} [reason]
     * @param {boolean} [resumable]
     */
    #onPeerGone ( reason, resumable ) {
        if ( ! resumable ) this.#peerHungUp = true;
        this.#peerAway = true;
        // A handshake has nothing to wait on either way: whoever is dialling
        // needs a definite answer rather than a socket that may come back.
        if ( ! this.connected ) this.#doclose(reason, undefined);
    }

    /**
     * The peer reclaimed the session it dropped, so it can answer again.
     * Anything waiting on that gets to stop waiting now.
     */
    #onPeerBack () {
        this.#peerAway = false;
        this.#wakeSignallingWaiters();
        this.#wakeTransportWaiters();
        this.#negotiator.signallingRestored();
    }

    /**
     * Our own signalling socket dropped. Renegotiation is off the table until
     * it returns, but an open data channel keeps working without it.
     */
    #onSignallingLost () {
        // Anything waiting on signalling has to look again: it may have
        // gone for good rather than merely gone away.
        this.#wakeSignallingWaiters();
        if ( ! this.connected ) {
            this.#doclose('lost the signalling connection before the peer connected', undefined);
        }
    }

    #onConnectionState () {
        this.#wakeTransportWaiters();
        const state = this.peerconnection.connectionState;
        if ( state === 'connected' ) this.#clearTrouble();
        else if ( state === 'disconnected' || state === 'failed' ) this.#noteTrouble();
        switch ( state ) {
            case 'connected':
                this.#setLinkState('connected');
                this.#negotiator.transportRestored();
                break;
            // 'disconnected' is transient: ICE either recovers by itself or
            // escalates to 'failed', which is where recovery belongs. Nothing
            // is done about it, but a watcher is told, because frozen video
            // starts here rather than at 'failed'.
            // Recovery is already saying more than that, and an unanswered
            // restart lands here too.
            case 'disconnected':
                if ( ! this.#recovering ) this.#setLinkState('unstable');
                break;
            case 'failed':
                this.#recover();
                break;
            case 'closed':
                this.#doclose(undefined, undefined);
                break;
        }
    }

    /**
     * The link has stopped carrying traffic. Recovery proper waits for the
     * browser to call it `failed`, which can take a while or never come -
     * a link can sit in `disconnected` indefinitely - so the deadline is
     * kept here, from the first sign of trouble. While recovery is running
     * it keeps its own, bounded by the same budget, and says why it gave up.
     */
    #noteTrouble () {
        if ( this.#troubleSince !== null ) return;
        this.#troubleSince = Date.now();
        this.#troubleTimer = setTimeout(() => {
            this.#troubleTimer = null;
            if ( this.closed || this.#recovering ) return;
            if ( this.peerconnection.connectionState === 'connected' ) return;
            this.#doclose('could not restore the connection', undefined);
        }, this.#recoveryBudget);
    }

    #clearTrouble () {
        this.#troubleSince = null;
        clearTimeout(this.#troubleTimer);
        this.#troubleTimer = null;
    }

    /**
     * @param {PuterPeerLinkState} state
     * @param {{ attempt?: number }} [detail]
     */
    #setLinkState ( state, detail ) {
        // Each restart attempt is worth announcing, so only the quiet states
        // are deduplicated.
        if ( this.linkState === state && state !== 'recovering' ) return;
        this.linkState = state;
        this.dispatchEvent(new PuterPeerLinkStateEvent(state, detail));
    }

    /**
     * ICE failure looks identical whether the peer hung up or the network
     * path died, so rather than guess, restart and see whether anyone is
     * still there to answer.
     *
     * One unanswered restart is not proof either - a peer whose tab is
     * throttled answers late - so attempts run until the transport recovers
     * or the budget is spent. The browser has no reason to raise another
     * `connectionstatechange` while the state stays `failed`, so the retries
     * belong in here rather than in the event.
     *
     * Recovery lasts until the transport is connected again, not merely until
     * it stops reading `failed`: Chrome answers an unanswered restart offer by
     * reporting `disconnected`, then `failed` again once that times out too.
     * Letting that end recovery would start a fresh budget every cycle, and a
     * peer that vanished would never be given up.
     *
     * Only the impolite side restarts; the polite side answers and waits.
     * Restart offers from both sides made during an outage are held up
     * together and collide the moment it ends, and the polite side rolling
     * its own back then leaves Chrome's congestion control stuck near zero:
     * the link reports connected, data flows, and the polite side's video
     * never encodes another frame. Nor does a polite restart ever help - with
     * the impolite side's signalling up it restarts by itself, and with it
     * down the offer has nowhere to go.
     */
    async #recover () {
        if ( this.closed || this.#recovering ) return;
        this.#recovering = true;
        const deadline = (this.#troubleSince ?? Date.now()) + this.#recoveryBudget;
        let attempt = 0;
        /** Set while the peer is away; recovery outlives it only so long. */
        let awayDeadline = null;
        try {
            let unanswered = false;
            while ( ! this.closed && this.peerconnection.connectionState !== 'connected' ) {
                if ( this.#peerHungUp ) {
                    this.#doclose('the peer hung up', undefined);
                    return;
                }
                if ( this.#peerAway ) {
                    awayDeadline ??= Date.now() + PEER_AWAY_GRACE_MS;
                    if ( Date.now() >= awayDeadline ) {
                        this.#doclose('the peer is no longer reachable', undefined);
                        return;
                    }
                } else {
                    awayDeadline = null;
                }
                // No route left to offer over, and none coming.
                if ( this.#channel.stranded ) {
                    this.#doclose('the peer is no longer reachable', undefined);
                    return;
                }
                const left = deadline - Date.now();
                if ( left <= 0 ) {
                    this.#doclose(
                        unanswered ? 'the peer stopped responding' : 'could not restore the connection',
                        undefined,
                    );
                    return;
                }

                if ( this.#polite ) {
                    if ( this.linkState !== 'recovering' ) this.#setLinkState('recovering');
                    // Woken early by the transport changing or the peer
                    // reclaiming its session; the checks above run again on
                    // the way round.
                    await this.#nextTransportChange(Math.min(RECOVERY_BACKOFF_MS, left));
                    continue;
                }

                // Nothing can be offered without signalling. It comes back
                // on its own when a peer server reclaims its session, so
                // wait on it rather than spend an attempt failing.
                if ( ! this.#channel.alive ) {
                    await this.#awaitSignalling(left);
                    if ( ! this.#channel.alive ) continue;
                }

                attempt++;
                this.#setLinkState('recovering', { attempt });
                try {
                    // An answer after the deadline is too late to use.
                    await this.#negotiator.restartIce(Math.min(DEFAULT_ANSWER_TIMEOUT, deadline - Date.now()));
                    unanswered = false;
                } catch {
                    unanswered = true;
                }

                // Either the new candidates take over or they do not, and
                // only then is another attempt worth making.
                if ( this.peerconnection.connectionState !== 'connected' ) {
                    const backoff = Math.min(
                        RECOVERY_BACKOFF_MAX_MS,
                        RECOVERY_BACKOFF_MS * 2 ** (attempt - 1),
                    );
                    await this.#nextTransportChange(
                        Math.min(unanswered ? backoff : TRANSPORT_SETTLE_TIMEOUT, deadline - Date.now()),
                    );
                }
            }
        } finally {
            this.#recovering = false;
        }
    }

    /**
     * Resolves when signalling is usable again, or when `timeout` runs out.
     *
     * @param {number} timeout
     * @returns {Promise<void>}
     */
    #awaitSignalling ( timeout ) {
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                this.#signallingWaiters.delete(done);
                resolve();
            };
            const timer = setTimeout(done, timeout);
            this.#signallingWaiters.add(done);
        });
    }

    #wakeSignallingWaiters () {
        for ( const wake of [...this.#signallingWaiters] ) wake();
    }

    /**
     * Resolves on the next transport state change, or when `timeout` expires.
     *
     * @param {number} timeout
     * @returns {Promise<void>}
     */
    #nextTransportChange ( timeout ) {
        return new Promise((resolve) => {
            const wake = () => {
                clearTimeout(timer);
                this.#transportWaiters.delete(wake);
                resolve();
            };
            const timer = setTimeout(wake, timeout);
            this.#transportWaiters.add(wake);
        });
    }

    #wakeTransportWaiters () {
        for ( const wake of [...this.#transportWaiters] ) wake();
    }

    #doclose ( reason, error ) {
        if ( this.closed ) return;
        this.closed = true;
        this.connected = false;
        this.#clearTrouble();

        // `close()` below need not raise another state change, so recovery is
        // told directly that there is nothing left to wait for.
        this.#wakeTransportWaiters();
        this.#wakeSignallingWaiters();
        this.#setLinkState('closed');
        this.#negotiator.stop();
        this.#tracks.close();

        // Say goodbye while signalling is still up. An explicit hangup is the
        // only thing that separates a peer that left from one that broke, and
        // it carries the reason the far side reports to its own listeners.
        if ( ! this.#peerHungUp ) this.#channel.sendBye(reason);
        this.#channel.close();

        if ( this.#datachannel ) {
            this.#datachannel.onclose = null;
            this.#datachannel.close();
        }
        this.peerconnection.close();

        if ( error ) this.dispatchEvent(new PuterPeerConnectionErrorEvent(error));
        this.dispatchEvent(new PuterPeerConnectionCloseEvent(reason));
    }

    /**
     * Closes the connection, optionally telling the peer why.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    close ( reason ) {
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
    async setRemoteDescription ( description ) {
        await this.peerconnection.setRemoteDescription(description);
    }

    /**
     * Adds an ICE candidate received from the peer.
     *
     * @param {RTCIceCandidateInit} candidate
     * @returns {Promise<void>}
     */
    async addIceCandidate ( candidate ) {
        await this.peerconnection.addIceCandidate(candidate);
    }

    /**
     * Media currently being sent, by name.
     *
     * @returns {Map<string, MediaStream | null>}
     */
    get publications () {
        return this.#tracks.publications;
    }

    /**
     * Media arriving from the peer, by the name they published it under. Each
     * name keeps one stream for as long as it is published, so a `<video>`
     * pointed at it once keeps working as tracks come and go.
     *
     * @returns {Map<string, MediaStream>}
     */
    get media () {
        return this.#tracks.media;
    }

    /**
     * Sends media to the peer under `name`, which is the name they receive it
     * with. Publishing a name again swaps its tracks in place and costs no
     * renegotiation, so muting or switching camera is cheap.
     *
     * @param {string} name
     * @param {MediaStream | MediaStreamTrack | null} source
     * @param {PuterPeerPublishOptions} [options]
     * @returns {void}
     */
    publish ( name, source, options ) {
        this.#tracks.publish(name, source, options);
    }

    /**
     * Stops sending the media published under `name`.
     *
     * @param {string} name
     * @returns {void}
     */
    unpublish ( name ) {
        this.#tracks.unpublish(name);
    }

    /**
     * Changes the encoding limits on published media. Applied immediately and
     * re-applied after every later negotiation.
     *
     * @param {string} name
     * @param {PuterPeerPublishOptions} options
     * @returns {void}
     */
    configure ( name, options ) {
        this.#tracks.configure(name, options);
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
