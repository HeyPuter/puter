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
    transceivers = [];
    restarts = 0;
    #listeners = new Map();
    /** Set to make the next setLocalDescription reject. */
    failLocalDescription = false;
    /** Set to make the next setRemoteDescription reject. */
    failRemoteDescription = false;
    /**
     * Set to refuse a remote offer once a local one has been applied, until
     * that offer is answered: what an engine does with another engine's offer.
     */
    strictRemoteOffer = false;
    #localOfferApplied = false;
    /**
     * Set to keep a browser's bookkeeping where a test depends on it. A
     * section has no mid until a description is applied, and each offer made
     * before then numbers it anew. The negotiation flag is raised once per
     * need, and again on each return to `stable` with the need still there.
     * PerfectNegotiator.browser.test.js holds Chromium to both.
     */
    browserLike = false;
    #mids = 0;
    /** Changes made, and how many of them the last settled exchange covered. */
    #changes = 0;
    #settled = 0;
    #covers = new WeakMap();
    #flagged = false;
    /** The mids of the sections in the peer's last offer. */
    #remoteMids = [];

    constructor (config) {
        this.config = config;
        FakePeerConnection.instances.push(this);
    }

    addEventListener (type, fn) {
        if ( ! this.#listeners.has(type) ) this.#listeners.set(type, new Set());
        this.#listeners.get(type).add(fn);
    }

    removeEventListener (type, fn) {
        this.#listeners.get(type)?.delete(fn);
    }

    /** Fires both the `on*` property and any addEventListener handlers. */
    fire (type, event = {}) {
        this[`on${type}`]?.(event);
        for ( const fn of this.#listeners.get(type) ?? [] ) fn(event);
    }

    getTransceivers () {
        return this.transceivers;
    }

    /**
     * Something changed that an offer has to carry. A browser says so once,
     * and again each time it is back at `stable` with the need still there.
     */
    needsNegotiation () {
        this.#changes++;
        if ( ! this.browserLike ) return this.fire('negotiationneeded');
        this.#raiseFlag();
    }

    #raiseFlag () {
        if ( this.signalingState !== 'stable' || this.#flagged || this.#changes === this.#settled ) return;
        this.#flagged = true;
        queueMicrotask(() => this.fire('negotiationneeded'));
    }

    #backAtStable () {
        this.#flagged = false;
        if ( this.browserLike ) this.#raiseFlag();
    }

    addTrack (track, stream) {
        const sender = new FakeSender(track);
        sender.streamId = stream?.id;
        const mid = this.browserLike ? null : String(this.transceivers.length);
        this.transceivers.push(new FakeTransceiver(this, sender, mid));
        this.needsNegotiation();
        return sender;
    }

    /**
     * Applying a description is what gives a new section its mid: the one the
     * description names, or the next free one where it was made on the spot.
     */
    #assignMids (description) {
        const named = sectionMids(description?.sdp);
        this.transceivers.forEach((transceiver, index) => {
            if ( transceiver.mid !== null ) return;
            transceiver.mid = description ? named[index] ?? null : String(this.#mids++);
        });
    }

    /** As the spec has it: a sender with no track is left alone. */
    removeTrack (sender) {
        if ( sender.track === null ) return;
        sender.track = null;
        const transceiver = this.transceivers.find((t) => t.sender === sender);
        if ( transceiver ) {
            transceiver.setDirectionQuietly(transceiver.direction === 'sendrecv' ? 'recvonly' : 'inactive');
        }
        this.needsNegotiation();
    }

    /** Test hook: deliver a remote track the way a negotiation would. */
    receiveTrack (track, mid) {
        this.fire('track', { track, transceiver: { mid }, streams: [] });
    }

    createDataChannel (label, options) {
        const channel = new FakeDataChannel(label, options);
        this.channels.push(channel);
        // A first data channel raises the negotiation-needed flag.
        queueMicrotask(() => this.fire('negotiationneeded'));
        return channel;
    }

    /** An offer the caller may apply later; making one changes nothing. */
    async createOffer () {
        const sections = this.transceivers.map((transceiver) => {
            const { mid, kind, sender } = transceiver;
            if ( mid === null ) transceiver.offered = String(this.#mids++);
            return `\r\nm=${kind} 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:${mid ?? transceiver.offered}`
                + ( sender.track ? `\r\na=msid:${sender.streamId} ${sender.track.id}` : '' );
        });
        const offer = { type: 'offer', sdp: `sdp-offer-${++sdpSeq}${sections.join('')}` };
        this.#covers.set(offer, this.#changes);
        return offer;
    }

    async setLocalDescription (description) {
        if ( this.signalingState === 'closed' ) throw new Error('InvalidStateError: closed');
        if ( description?.type === 'rollback' ) {
            this.localDescription = null;
            this.signalingState = 'stable';
            this.fire('signalingstatechange');
            this.#backAtStable();
            return;
        }
        if ( this.failLocalDescription ) {
            this.failLocalDescription = false;
            throw new Error('setLocalDescription failed');
        }
        const type = description?.type
            ?? ( this.signalingState === 'have-remote-offer' ? 'answer' : 'offer' );
        this.localDescription = description ?? { type, sdp: `sdp-${type}-${++sdpSeq}` };
        this.#assignMids(description);
        if ( type === 'offer' ) {
            this.#localOfferApplied = true;
            if ( ! description ) this.#covers.set(this.localDescription, this.#changes);
        }
        this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
        this.fire('signalingstatechange');
        if ( type === 'answer' ) this.#backAtStable();
    }

    async setRemoteDescription (description) {
        if ( this.signalingState === 'closed' ) throw new Error('InvalidStateError: closed');
        if ( this.failRemoteDescription ) {
            this.failRemoteDescription = false;
            throw new Error('setRemoteDescription failed');
        }
        if ( description.type === 'offer' ) {
            // 'have-local-offer' rolls back implicitly, which is what lets the
            // polite side accept an offer it collided with.
            if ( this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer' ) {
                throw new Error(`InvalidStateError: ${this.signalingState}`);
            }
            if ( this.strictRemoteOffer && this.#localOfferApplied ) {
                throw new Error('remote offer refused after a local offer');
            }
            // A section keeps the number the peer first offered it under.
            const mids = sectionMids(description.sdp);
            if ( this.#remoteMids.some((mid, index) => index < mids.length && mids[index] !== mid) ) {
                throw new Error('remote offer renumbers a section already applied');
            }
            if ( mids.length > 0 ) this.#remoteMids = mids;
            // A peer that applied our offer lists its sections in its own, and
            // a track added here takes the section the peer already has for it.
            for ( const transceiver of this.transceivers ) transceiver.mid ??= transceiver.offered ?? null;
            this.remoteDescription = description;
            this.signalingState = 'have-remote-offer';
            this.fire('signalingstatechange');
            return;
        }
        if ( this.signalingState !== 'have-local-offer' ) {
            throw new Error(`InvalidStateError: ${this.signalingState}`);
        }
        this.#localOfferApplied = false;
        this.remoteDescription = description;
        this.#settled = this.#covers.get(this.localDescription) ?? this.#settled;
        this.signalingState = 'stable';
        this.fire('signalingstatechange');
        this.#backAtStable();
    }

    async addIceCandidate (candidate) {
        if ( ! this.remoteDescription ) {
            throw new Error('InvalidStateError: no remote description');
        }
        this.candidates.push(candidate);
    }

    restartIce () {
        this.restarts++;
        queueMicrotask(() => this.fire('negotiationneeded'));
    }

    close () {
        this.signalingState = 'closed';
        this.setConnectionState('closed');
    }

    /** Test hook: drive `connectionState` the way the browser would. */
    setConnectionState (state) {
        this.connectionState = state;
        this.fire('connectionstatechange');
    }
}

const sectionMids = (sdp) => [...(sdp ?? '').matchAll(/^a=mid:(.+)$/gm)].map((match) => match[1]);

/** A transceiver whose direction raises the negotiation flag when changed. */
export class FakeTransceiver {
    #pc;
    #direction = 'sendrecv';

    constructor (pc, sender, mid) {
        this.#pc = pc;
        this.sender = sender;
        this.kind = sender.track?.kind;
        this.mid = mid;
    }

    get direction () {
        return this.#direction;
    }

    set direction (value) {
        if ( value === this.#direction ) return;
        this.#direction = value;
        this.#pc.needsNegotiation();
    }

    setDirectionQuietly (value) {
        this.#direction = value;
    }
}

/** A sender whose encoding parameters a test can inspect. */
export class FakeSender {
    #params = { encodings: [{}] };
    /** Replacements asked for, in order; the sender's track changes only once one lands. */
    replacements = [];

    constructor (track) {
        this.track = track;
    }

    /** Lands a turn later, as the browser's does: `track` is unchanged until then. */
    async replaceTrack (track) {
        this.replacements.push(track);
        await Promise.resolve();
        this.track = track;
    }

    getParameters () {
        return structuredClone(this.#params);
    }

    async setParameters (params) {
        this.#params = structuredClone(params);
    }

    get encoding () {
        return this.#params.encodings[0];
    }

    get degradationPreference () {
        return this.#params.degradationPreference;
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

    /** A server's socket comes back; the channel it carries works again. */
    revive () {
        this._alive = true;
    }

    sendOffer (description, names, gen) {
        return this.#post({ offer: { offer: description, names, gen } });
    }

    sendAnswer (description, names, re) {
        return this.#post({ answer: { answer: description, names, re } });
    }

    sendCandidate (candidate) {
        return this.#post({ candidate: { candidate } });
    }

    sendBye (reason) {
        return this.#post({ bye: { reason } });
    }

    /** Records the wire payload, then hands it to the peer to read as one. */
    #post (payload) {
        if ( this.failSend || ! this._alive ) return false;
        this.delivered.push(payload);
        this.peer?.receive(payload);
        return true;
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
