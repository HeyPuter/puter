import { PuterPeerMediaEndedEvent, PuterPeerMediaEvent } from './events.js';

/** The two track kinds a slot reconciles independently. */
const KINDS = ['audio', 'video'];

/**
 * @typedef {{
 *   maxBitrate?: number,
 *   maxFramerate?: number,
 *   scaleResolutionDownBy?: number,
 *   degradationPreference?: RTCDegradationPreference,
 * }} PuterPeerEncoding
 */

/** @typedef {{ audio?: PuterPeerEncoding, video?: PuterPeerEncoding }} PuterPeerPublishOptions */

/** @typedef {{ commit: () => void, rollback: () => void }} StagedNames */

/**
 * Named media slots on one peer connection.
 *
 * A slot's name travels with the SDP that introduces its m-sections, so the
 * receiving side knows what a track is the instant it arrives - no separate
 * announcement to race, and nothing to guess.
 */
export class TrackPublisher {
    #pc;
    #target;
    /** name -> { stream, senders: Map<kind, RTCRtpSender>, options } */
    #published = new Map();
    #remoteNames = new Map();
    #remoteStreams = new Map();
    #closed = false;

    /**
     * @param {RTCPeerConnection} peerconnection
     * @param {EventTarget} target where media events are dispatched
     */
    constructor ( peerconnection, target ) {
        this.#pc = peerconnection;
        this.#target = target;

        this.#pc.addEventListener('track', (evt) => this.#onTrack(evt));
        // Sender encodings exist only once a negotiation settles, and the next
        // one wipes them, so whatever was asked for is re-applied every time.
        this.#pc.addEventListener('signalingstatechange', () => {
            if ( this.#pc.signalingState === 'stable' ) {
                for ( const slot of this.#published.values() ) this.#applyEncodings(slot);
            }
        });
    }

    /** @returns {Map<string, MediaStream | null>} what is being sent, by name */
    get publications () {
        return new Map([...this.#published].map(([name, slot]) => [name, slot.stream]));
    }

    /** @returns {Map<string, MediaStream>} what is arriving, by name */
    get media () {
        return this.#remoteStreams;
    }

    /**
     * Publishes media under `name`. Publishing a name that already exists
     * swaps its tracks in place, which costs no renegotiation; a source with
     * no track of some kind keeps that sender and stops it, so a camera
     * coming back is free too.
     *
     * @param {string} name
     * @param {MediaStream | MediaStreamTrack | null} source
     * @param {PuterPeerPublishOptions} [options]
     * @returns {void}
     */
    publish ( name, source, options ) {
        if ( this.#closed ) throw new Error('The connection is closed.');

        let slot = this.#published.get(name);
        if ( ! slot ) {
            slot = { stream: null, senders: new Map(), options: {} };
            this.#published.set(name, slot);
        }
        this.#merge(slot, options);
        slot.stream = toStream(source);

        for ( const kind of KINDS ) {
            const track = slot.stream?.getTracks().find(
                (t) => t.kind === kind && t.readyState === 'live',
            ) ?? null;
            const sender = slot.senders.get(kind);

            if ( sender ) {
                if ( sender.track !== track ) sender.replaceTrack(track).catch(() => {});
            } else if ( track ) {
                slot.senders.set(kind, this.#pc.addTrack(track, slot.stream));
            }
        }

        this.#applyEncodings(slot);
    }

    /**
     * Stops sending everything published under `name`.
     *
     * @param {string} name
     * @returns {void}
     */
    unpublish ( name ) {
        const slot = this.#published.get(name);
        if ( ! slot ) return;
        this.#published.delete(name);

        for ( const sender of slot.senders.values() ) {
            try {
                this.#pc.removeTrack(sender);
            } catch {
                // connection already closed
            }
        }
    }

    /**
     * Changes the encoding limits on a published name. Applied now, and again
     * after every negotiation.
     *
     * @param {string} name
     * @param {PuterPeerPublishOptions} options
     * @returns {void}
     */
    configure ( name, options ) {
        const slot = this.#published.get(name);
        if ( ! slot ) return;
        this.#merge(slot, options);
        this.#applyEncodings(slot);
    }

    /**
     * The name of every slot currently going out, keyed by the m-section it
     * occupies, to travel alongside a local description.
     *
     * @returns {Record<string, string>}
     */
    localNames () {
        /** @type {Record<string, string>} */
        const names = {};
        const transceivers = this.#pc.getTransceivers?.() ?? [];
        for ( const [name, slot] of this.#published ) {
            for ( const sender of slot.senders.values() ) {
                const mid = transceivers.find((t) => t.sender === sender)?.mid;
                if ( mid !== null && mid !== undefined ) names[mid] = name;
            }
        }
        return names;
    }

    /**
     * Adopts the names carried by a remote description. The map goes on before
     * the description is applied, so that an arriving track can be named on
     * the spot, but the description may still be rejected - and one that is
     * leaves the peer's existing tracks flowing. So retiring the names the
     * peer no longer sends waits for `commit()`, and `rollback()` puts the
     * previous map back.
     *
     * @param {Record<string, string>} names
     * @returns {StagedNames}
     */
    stageRemoteNames ( names ) {
        const previous = this.#remoteNames;
        this.#remoteNames = new Map(Object.entries(names ?? {}));

        return {
            commit: () => {
                // A name the peer no longer sends has ended, whether or not
                // its track says so.
                const live = new Set(this.#remoteNames.values());
                for ( const name of [...this.#remoteStreams.keys()] ) {
                    if ( ! live.has(name) ) this.#endRemote(name);
                }
            },
            rollback: () => {
                this.#remoteNames = previous;
            },
        };
    }

    /** @returns {void} */
    close () {
        this.#closed = true;
        for ( const slot of this.#published.values() ) {
            for ( const sender of slot.senders.values() ) {
                sender.replaceTrack?.(null).catch?.(() => {});
            }
        }
        this.#published.clear();
        this.#remoteStreams.clear();
        this.#remoteNames.clear();
    }

    // -- internals --

    #merge ( slot, options ) {
        for ( const kind of KINDS ) {
            if ( options?.[kind] ) {
                slot.options[kind] = { ...slot.options[kind], ...options[kind] };
            }
        }
    }

    #onTrack ( evt ) {
        if ( this.#closed ) return;
        const mid = evt.transceiver?.mid;
        // A peer that publishes without naming (an older SDK, or a raw
        // addTrack on the exposed handle) is surfaced under its m-section id
        // rather than dropped.
        const name = this.#remoteNames.get(mid) ?? String(mid ?? evt.track.id);

        let stream = this.#remoteStreams.get(name);
        if ( ! stream ) {
            stream = new MediaStream();
            this.#remoteStreams.set(name, stream);
        }
        if ( ! stream.getTracks().includes(evt.track) ) stream.addTrack(evt.track);

        evt.track.addEventListener?.('ended', () => {
            if ( this.#remoteStreams.get(name) !== stream ) return;
            stream.removeTrack?.(evt.track);
            if ( stream.getTracks().length === 0 ) this.#endRemote(name);
        });

        this.#target.dispatchEvent(new PuterPeerMediaEvent(name, stream, evt.track));
    }

    #endRemote ( name ) {
        const stream = this.#remoteStreams.get(name);
        if ( ! stream ) return;
        this.#remoteStreams.delete(name);
        this.#target.dispatchEvent(new PuterPeerMediaEndedEvent(name, stream));
    }

    #applyEncodings ( slot ) {
        for ( const kind of KINDS ) {
            const sender = slot.senders.get(kind);
            const wanted = slot.options[kind];
            if ( sender && wanted ) void this.#setEncoding(sender, wanted);
        }
    }

    async #setEncoding ( sender, wanted ) {
        try {
            const params = sender.getParameters();
            // Encodings appear only after a negotiation settles; the next one
            // to reach 'stable' retries this.
            if ( ! params.encodings?.length ) return;
            const { degradationPreference, ...encoding } = wanted;
            Object.assign(params.encodings[0], encoding);
            if ( degradationPreference ) params.degradationPreference = degradationPreference;
            await sender.setParameters(params);
        } catch {
            // an unsupported field or a transient state; retried on the next
            // settle rather than reported
        }
    }
}

/** A bare track counts as a stream of one. */
function toStream ( source ) {
    if ( ! source ) return null;
    if ( typeof source.getTracks === 'function' ) return source;
    return new MediaStream([source]);
}
