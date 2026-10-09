/** @typedef {import('./PuterPeerConnection.js').PuterPeerConnection} PuterPeerConnection */
/** @typedef {import('./types.js').PuterPeerUser} PuterPeerUser */

/**
 * How the link to a peer is doing: 'unstable' is a wobble nothing is being
 * done about yet, 'recovering' is the link actually being restored.
 *
 * @typedef {'connecting' | 'connected' | 'unstable' | 'recovering' | 'closed'} PuterPeerLinkState
 */

/** A client joined a peer server. */
export class PuterPeerServerConnectionEvent extends Event {
    /** @type {PuterPeerConnection} */
    conn;
    /** @type {PuterPeerUser} */
    user;
    /**
     * @param {PuterPeerConnection} connection
     * @param {PuterPeerUser} user
     */
    constructor (connection, user) {
        super('connection');
        this.conn = connection;
        this.user = user;
    }
}

/**
 * The signaller socket came back. `resumed` says whether the session came
 * with it: when it did, the invite code is the same one and the clients
 * already connected can be renegotiated with again.
 */
export class PuterPeerServerReconnectEvent extends Event {
    /** @type {string | undefined} */
    inviteCode;
    /** @type {boolean} */
    resumed;
    /**
     * Why a reclaim was refused, when one was asked for and turned down.
     * @type {string | undefined}
     */
    refused;
    /**
     * @param {string | undefined} inviteCode
     * @param {boolean} resumed
     * @param {string} [refused]
     */
    constructor (inviteCode, resumed, refused) {
        super('reconnect');
        this.inviteCode = inviteCode;
        this.resumed = resumed;
        this.refused = refused;
    }
}

/** A message arrived over the data channel. */
export class PuterPeerConnectionMessageEvent extends Event {
    /** @type {string | ArrayBuffer | Blob} */
    data;
    /** @param {string | ArrayBuffer | Blob} message */
    constructor (message) {
        super('message');
        this.data = message;
    }
}

/** The data channel is open. */
export class PuterPeerConnectionOpenEvent extends Event {
    constructor () {
        super('open');
    }
}

/** The connection closed. */
export class PuterPeerConnectionCloseEvent extends Event {
    /** @type {string | undefined} */
    reason;
    /** @param {string} [reason] */
    constructor (reason = undefined) {
        super('close');
        this.reason = reason;
    }
}

/** Something went wrong on the connection; it carries on unless a `close` follows. */
export class PuterPeerConnectionErrorEvent extends Event {
    /** @type {Error} */
    error;
    /** @param {Error} error */
    constructor (error) {
        super('error');
        this.error = error;
    }
}

/** A track arrived from the peer, under the name it was published with. */
export class PuterPeerMediaEvent extends Event {
    /** @type {string} */
    name;
    /** @type {MediaStream} */
    stream;
    /** @type {MediaStreamTrack} */
    track;
    /**
     * @param {string} name
     * @param {MediaStream} stream
     * @param {MediaStreamTrack} track
     */
    constructor (name, stream, track) {
        super('media');
        this.name = name;
        this.stream = stream;
        this.track = track;
    }
}

/** The peer stopped publishing a name. */
export class PuterPeerMediaEndedEvent extends Event {
    /** @type {string} */
    name;
    /** @type {MediaStream} */
    stream;
    /**
     * @param {string} name
     * @param {MediaStream} stream
     */
    constructor (name, stream) {
        super('mediaended');
        this.name = name;
        this.stream = stream;
    }
}

/** The link's state changed; `attempt` counts the attempts at restoring it. */
export class PuterPeerLinkStateEvent extends Event {
    /** @type {PuterPeerLinkState} */
    state;
    /** @type {number | undefined} */
    attempt;
    /**
     * @param {PuterPeerLinkState} state
     * @param {{ attempt?: number }} [detail]
     */
    constructor (state, { attempt } = {}) {
        super('linkstate');
        this.state = state;
        this.attempt = attempt;
    }
}

/**
 * The events a `PuterPeerConnection` fires, by name.
 *
 * @typedef {{
 *   open: PuterPeerConnectionOpenEvent,
 *   message: PuterPeerConnectionMessageEvent,
 *   close: PuterPeerConnectionCloseEvent,
 *   error: PuterPeerConnectionErrorEvent,
 *   media: PuterPeerMediaEvent,
 *   mediaended: PuterPeerMediaEndedEvent,
 *   linkstate: PuterPeerLinkStateEvent,
 * }} PuterPeerConnectionEventMap
 */

/**
 * The events a `PuterPeerServer` fires, by name.
 *
 * @typedef {{
 *   connection: PuterPeerServerConnectionEvent,
 *   reconnect: PuterPeerServerReconnectEvent,
 * }} PuterPeerServerEventMap
 */
