import { PerfectNegotiator } from './PerfectNegotiator.js';
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

/** How many times ICE may be restarted before the connection is given up on. */
const ICE_RESTART_LIMIT = 3;

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
     * @type {'connecting' | 'connected' | 'unstable' | 'recovering' | 'closed'}
     */
    linkState = 'connecting';

    #peerConfig;
    #channel;
    #negotiator;
    #tracks;
    #datachannel;
    #bufferedMessages = [];
    #iceRestarts = 0;
    #recovering = false;
    #peerGone = false;
    #transportWaiters = new Set();

    /**
     * @param {object} peerConfig
     * @param {{ polite?: boolean, channel?: import('./signalling.js').SignallingChannel }} [options]
     */
    constructor ( peerConfig, { polite = false, channel } = {} ) {
        super();
        this.#peerConfig = peerConfig;
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
            this.#peerGone = true;
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

        this.#channel.onoffer = (description, names) => this.#negotiator.acceptOffer(description, names);
        this.#channel.onanswer = (description, names) => this.#negotiator.acceptAnswer(description, names);
        this.#channel.oncandidate = (candidate) => this.#negotiator.acceptCandidate(candidate);
        this.#channel.onbye = (reason) => this.#onBye(reason);
        this.#channel.onpeergone = (reason) => this.#onPeerGone(reason);
        this.#channel.onunusable = () => this.#onSignallingLost();
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
        this.#peerGone = true;
        this.#doclose(reason, undefined);
    }

    /**
     * The peer's signalling session ended. That is evidence the peer hung up,
     * not proof - its data channel may still be carrying traffic - so it only
     * decides anything once ICE has actually failed.
     *
     * @param {string} [reason]
     */
    #onPeerGone ( reason ) {
        this.#peerGone = true;
        if ( ! this.connected ) this.#doclose(reason, undefined);
    }

    /**
     * Our own signalling socket dropped. Renegotiation is off the table until
     * it returns, but an open data channel keeps working without it.
     */
    #onSignallingLost () {
        if ( ! this.connected ) {
            this.#doclose('lost the signalling connection before the peer connected', undefined);
        }
    }

    #onConnectionState () {
        this.#wakeTransportWaiters();
        switch ( this.peerconnection.connectionState ) {
            case 'connected':
                this.#iceRestarts = 0;
                this.#setLinkState('connected');
                break;
            // 'disconnected' is transient: ICE either recovers by itself or
            // escalates to 'failed', which is where recovery belongs. Nothing
            // is done about it, but a watcher is told, because frozen video
            // starts here rather than at 'failed'.
            case 'disconnected':
                this.#setLinkState('unstable');
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
     * @param {'connecting' | 'connected' | 'unstable' | 'recovering' | 'closed'} state
     * @param {{ attempt?: number, of?: number }} [detail]
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
     */
    async #recover () {
        if ( this.closed || this.#recovering ) return;
        this.#recovering = true;
        try {
            let unanswered = false;
            while ( ! this.closed && this.peerconnection.connectionState === 'failed' ) {
                // Signalling does not come back on its own, so a restart
                // that cannot be offered never will be.
                if ( this.#peerGone || ! this.#channel.alive ) {
                    this.#doclose('the peer is no longer reachable', undefined);
                    return;
                }
                if ( this.#iceRestarts >= ICE_RESTART_LIMIT ) {
                    this.#doclose(
                        unanswered ? 'the peer stopped responding' : 'could not restore the connection',
                        undefined,
                    );
                    return;
                }

                this.#iceRestarts++;
                this.#setLinkState('recovering', { attempt: this.#iceRestarts, of: ICE_RESTART_LIMIT });
                try {
                    await this.#negotiator.restartIce();
                    unanswered = false;
                } catch {
                    unanswered = true;
                    continue;
                }
                // Answered: the new candidates need a moment to either take
                // over or fail, and only then is another attempt warranted.
                if ( this.peerconnection.connectionState === 'failed' ) {
                    await this.#nextTransportChange(TRANSPORT_SETTLE_TIMEOUT);
                }
            }
        } finally {
            this.#recovering = false;
        }
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

        // `close()` below need not raise another state change, so recovery is
        // told directly that there is nothing left to wait for.
        this.#wakeTransportWaiters();
        this.#setLinkState('closed');
        this.#negotiator.stop();
        this.#tracks.close();

        // Say goodbye while signalling is still up. An explicit hangup is the
        // only thing that separates a peer that left from one that broke, and
        // it carries the reason the far side reports to its own listeners.
        if ( ! this.#peerGone ) this.#channel.sendBye(reason);
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
