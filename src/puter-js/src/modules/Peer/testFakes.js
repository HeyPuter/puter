import { SignallingChannel } from './signalling.js';

let sdpSeq = 0;

export class FakeDataChannel {
    readyState = 'connecting';
    sent = [];
    onmessage = null;
    onopen = null;
    onclose = null;
    onerror = null;

    constructor (label, options) {
        this.label = label;
        this.options = options;
    }

    send (data) {
        this.sent.push(data);
    }

    close () {
        this.readyState = 'closed';
    }

    open () {
        this.readyState = 'open';
        this.onopen?.();
    }
}

/**
 * Models the parts of the WebRTC state machine the negotiator depends on:
 * signalling state transitions, implicit rollback when an offer arrives in
 * `have-local-offer`, and the negotiation flag a data channel raises.
 */
export class FakePeerConnection {
    static instances = [];

    localDescription = null;
    remoteDescription = null;
    signalingState = 'stable';
    connectionState = 'new';
    onnegotiationneeded = null;
    onicecandidate = null;
    onconnectionstatechange = null;

    channels = [];
    candidates = [];
    restarts = 0;
    /** Set to make the next setLocalDescription reject. */
    failLocalDescription = false;

    constructor (config) {
        this.config = config;
        FakePeerConnection.instances.push(this);
    }

    createDataChannel (label, options) {
        const channel = new FakeDataChannel(label, options);
        this.channels.push(channel);
        // A first data channel raises the negotiation-needed flag.
        queueMicrotask(() => this.onnegotiationneeded?.());
        return channel;
    }

    async setLocalDescription (description) {
        if ( this.signalingState === 'closed' ) throw new Error('InvalidStateError: closed');
        if ( this.failLocalDescription ) {
            this.failLocalDescription = false;
            throw new Error('setLocalDescription failed');
        }
        const type = description?.type
            ?? ( this.signalingState === 'have-remote-offer' ? 'answer' : 'offer' );
        this.localDescription = description ?? { type, sdp: `sdp-${type}-${++sdpSeq}` };
        this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
    }

    async setRemoteDescription (description) {
        if ( this.signalingState === 'closed' ) throw new Error('InvalidStateError: closed');
        if ( description.type === 'offer' ) {
            // 'have-local-offer' rolls back implicitly, which is what lets the
            // polite side accept an offer it collided with.
            if ( this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer' ) {
                throw new Error(`InvalidStateError: ${this.signalingState}`);
            }
            this.remoteDescription = description;
            this.signalingState = 'have-remote-offer';
            return;
        }
        if ( this.signalingState !== 'have-local-offer' ) {
            throw new Error(`InvalidStateError: ${this.signalingState}`);
        }
        this.remoteDescription = description;
        this.signalingState = 'stable';
    }

    async addIceCandidate (candidate) {
        if ( ! this.remoteDescription ) {
            throw new Error('InvalidStateError: no remote description');
        }
        this.candidates.push(candidate);
    }

    restartIce () {
        this.restarts++;
        queueMicrotask(() => this.onnegotiationneeded?.());
    }

    close () {
        this.signalingState = 'closed';
        this.setConnectionState('closed');
    }

    /** Test hook: drive `connectionState` the way the browser would. */
    setConnectionState (state) {
        this.connectionState = state;
        this.onconnectionstatechange?.();
    }
}

/**
 * A signalling channel wired straight to another one, so a test can watch two
 * peers negotiate without a signaller in between.
 */
export class LoopbackChannel extends SignallingChannel {
    peer = null;
    delivered = [];
    failSend = false;

    constructor (name = 'peer') {
        super();
        this.name = name;
        this._alive = true;
    }

    get alive () {
        return this._alive;
    }

    kill () {
        this._alive = false;
    }

    sendOffer (description) {
        this.#post({ offer: { offer: description } }, { description });
    }

    sendAnswer (description) {
        this.#post({ answer: { answer: description } }, { description });
    }

    sendCandidate (candidate) {
        this.#post({ candidate: { candidate } }, { candidate });
    }

    sendBye (reason) {
        this.#post({ bye: { reason } }, { bye: { reason } });
    }

    /** Records what went on the wire, and hands the peer what it would decode. */
    #post (payload, signal) {
        if ( this.failSend ) throw new Error('signalling send failed');
        if ( ! this._alive ) return;
        this.delivered.push(payload);
        this.peer?.deliver(signal);
    }

    /** Hands a signal to the connection on this end. */
    deliver (signal) {
        this.onsignal(signal);
    }

    close () {
        this._alive = false;
    }
}

export function linkChannels (a, b) {
    a.peer = b;
    b.peer = a;
}

export const flush = async (times = 12) => {
    for ( let i = 0; i < times; i++ ) await Promise.resolve();
};
