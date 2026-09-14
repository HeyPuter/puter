import { PerfectNegotiator } from './PerfectNegotiator.js';
import { ClientSignallingChannel } from './signalling.js';
import {
    PuterPeerConnectionCloseEvent,
    PuterPeerConnectionErrorEvent,
    PuterPeerConnectionMessageEvent,
    PuterPeerConnectionOpenEvent,
} from './events.js';

/** @typedef {import('../../../types/modules/peer').PuterPeerMessage} PuterPeerMessage */
/** @typedef {import('../../../types/modules/peer').PuterPeerOptions} PuterPeerOptions */

/** How many times ICE may be restarted before the connection is given up on. */
const ICE_RESTART_LIMIT = 3;

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
     * @type {import('../../../types/modules/peer').PuterPeerUser | undefined}
     */
    owner;
    connected = false;
    closed = false;

    #peerConfig;
    #channel;
    #negotiator;
    #datachannel;
    #bufferedMessages = [];
    #iceRestarts = 0;
    #recovering = false;
    #peerGone = false;

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

        this.#negotiator = new PerfectNegotiator(this.peerconnection, this.#channel, {
            polite,
            onerror: (error) => this.dispatchEvent(new PuterPeerConnectionErrorEvent(error)),
        });

        this.peerconnection.onconnectionstatechange = () => this.#onConnectionState();

        this.#channel.onsignal = (signal) => this.#onSignal(signal);
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

    /** @param {import('./signalling.js').PeerSignal} signal */
    #onSignal ( signal ) {
        if ( signal.bye ) {
            this.#peerGone = true;
            this.#doclose(signal.bye.reason, undefined);
            return;
        }
        this.#negotiator.accept(signal);
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
        switch ( this.peerconnection.connectionState ) {
            case 'connected':
                this.#iceRestarts = 0;
                break;
            // 'disconnected' is transient: ICE either recovers by itself or
            // escalates to 'failed', which is where recovery belongs.
            case 'failed':
                this.#recover();
                break;
            case 'closed':
                this.#doclose(undefined, undefined);
                break;
        }
    }

    /**
     * ICE failure looks identical whether the peer hung up or the network
     * path died, so rather than guess, restart and see whether anyone is
     * still there to answer.
     */
    async #recover () {
        if ( this.closed || this.#recovering ) return;

        if ( this.#peerGone || ! this.#channel.alive ) {
            this.#doclose('the peer is no longer reachable', undefined);
            return;
        }
        if ( this.#iceRestarts >= ICE_RESTART_LIMIT ) {
            this.#doclose('could not restore the connection', undefined);
            return;
        }

        this.#recovering = true;
        this.#iceRestarts++;
        try {
            await this.#negotiator.restartIce();
        } catch {
            this.#doclose('the peer stopped responding', undefined);
        } finally {
            this.#recovering = false;
        }
    }

    #doclose ( reason, error ) {
        if ( this.closed ) return;
        this.closed = true;
        this.connected = false;

        this.#negotiator.stop();

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
