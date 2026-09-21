export class PuterPeerServerConnectionEvent extends Event {
    conn;
    user;
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
    inviteCode;
    resumed;
    constructor (inviteCode, resumed) {
        super('reconnect');
        this.inviteCode = inviteCode;
        this.resumed = resumed;
    }
}

export class PuterPeerConnectionMessageEvent extends Event {
    data;
    constructor (message) {
        super('message');
        this.data = message;
    }
}

export class PuterPeerConnectionOpenEvent extends Event {
    constructor () {
        super('open');
    }
}

export class PuterPeerConnectionCloseEvent extends Event {
    reason;
    constructor (reason = undefined) {
        super('close');
        this.reason = reason;
    }
}

export class PuterPeerConnectionErrorEvent extends Event {
    error;
    constructor (error) {
        super('error');
        this.error = error;
    }
}

export class PuterPeerMediaEvent extends Event {
    name;
    stream;
    track;
    constructor (name, stream, track) {
        super('media');
        this.name = name;
        this.stream = stream;
        this.track = track;
    }
}

export class PuterPeerMediaEndedEvent extends Event {
    name;
    stream;
    constructor (name, stream) {
        super('mediaended');
        this.name = name;
        this.stream = stream;
    }
}

export class PuterPeerLinkStateEvent extends Event {
    state;
    attempt;
    of;
    constructor (state, { attempt, of } = {}) {
        super('linkstate');
        this.state = state;
        this.attempt = attempt;
        this.of = of;
    }
}
