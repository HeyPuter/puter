export class PuterPeerServerConnectionEvent extends Event {
    conn;
    user;
    constructor (connection, user) {
        super('connection');
        this.conn = connection;
        this.user = user;
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
