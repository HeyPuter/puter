import EventListener from '../../lib/EventListener.js';
import { clearEpoxyClientCache, getEpoxyClient } from './index.js';

const textEncoder = new TextEncoder();

function normalizeWriteData (data) {
    if ( typeof data === 'string' ) {
        return textEncoder.encode(data);
    }

    if ( data instanceof ArrayBuffer ) {
        return new Uint8Array(data);
    }

    if ( ArrayBuffer.isView(data) ) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    throw new Error('Invalid data type (not TypedArray, ArrayBuffer or String).');
}

function normalizeErrorReason (reason) {
    if ( reason instanceof Error ) {
        return reason.message;
    }

    return String(reason);
}

export class PSocket extends EventListener {
    #host;
    #port;
    #useTls;

    #reader;
    #writer;

    #open = false;
    #closing = false;
    #closed = false;
    #pendingWrites = [];

    constructor (host, port, options = {}) {
        super(['data', 'drain', 'open', 'error', 'close', 'tlsdata', 'tlsopen', 'tlsclose']);

        this.#host = host;
        this.#port = Number(port);
        this.#useTls = Boolean(options.tls);

        void this.#connect();
    }

    on (event, callback) {
        if ( this.#useTls && (event === 'open' || event === 'data' || event === 'close') ) {
            return super.on(`tls${event}`, callback);
        }

        return super.on(event, callback);
    }

    addListener (...args) {
        return this.on(...args);
    }

    write (data, callback) {
        const payload = normalizeWriteData(data);

        if ( this.#closed ) {
            throw new Error('Socket is already closed.');
        }

        if ( ! this.#writer ) {
            this.#pendingWrites.push({ payload, callback });
            return;
        }

        void this.#writePayload(payload, callback);
    }

    close () {
        if ( this.#closing || this.#closed ) {
            return;
        }

        this.#closing = true;
        void this.#closeStreams(false);
    }

    async #connect () {
        try {
            await this.#connectWithClient(false);
        } catch {
            try {
                await this.#connectWithClient(true);
            } catch ( retryError ) {
                clearEpoxyClientCache();
                this.#emitErrorAndClose(retryError);
            }
        }
    }

    async #connectWithClient (refresh) {
        if ( this.#closing || this.#closed ) {
            return;
        }

        const client = await getEpoxyClient({ refresh });
        const stream = await this.#openStream(client);

        if ( this.#closing || this.#closed ) {
            try {
                await stream.read.cancel();
            } catch {
                // ignored
            }
            try {
                await stream.write.abort();
            } catch {
                // ignored
            }
            return;
        }

        this.#reader = stream.read.getReader();
        this.#writer = stream.write.getWriter();
        this.#open = true;

        this.emit(this.#eventName('open'));
        await this.#flushPendingWrites();
        void this.#readLoop();
    }

    async #openStream (client) {
        if ( this.#useTls ) {
            return await client.connectTls(this.#host, this.#port);
        }

        return await client.connect(this.#host, this.#port);
    }

    async #flushPendingWrites () {
        while ( this.#pendingWrites.length && !this.#closed && !this.#closing ) {
            const { payload, callback } = this.#pendingWrites.shift();
            await this.#writePayload(payload, callback);
        }
    }

    async #writePayload (payload, callback) {
        if ( !this.#writer || this.#closed || this.#closing ) {
            return;
        }

        try {
            await this.#writer.write(payload);
            if ( callback ) {
                callback();
            }
        } catch ( error ) {
            clearEpoxyClientCache();
            this.#emitErrorAndClose(error);
        }
    }

    async #readLoop () {
        if ( ! this.#reader ) {
            return;
        }

        try {
            while ( !this.#closing && !this.#closed ) {
                const { done, value } = await this.#reader.read();
                if ( done ) {
                    break;
                }

                if ( value ) {
                    this.emit(this.#eventName('data'), value);
                }
            }

            this.#emitClose(false);
        } catch ( error ) {
            if ( this.#closing ) {
                this.#emitClose(false);
            } else {
                clearEpoxyClientCache();
                this.#emitErrorAndClose(error);
            }
        } finally {
            try {
                this.#reader.releaseLock();
            } catch {
                // ignored
            }
        }
    }

    async #closeStreams (hadError) {
        this.#pendingWrites = [];

        if ( ! this.#open ) {
            this.#emitClose(hadError);
            return;
        }

        try {
            if ( this.#reader ) {
                await this.#reader.cancel();
            }
        } catch {
            // ignored
        }

        try {
            if ( this.#writer ) {
                await this.#writer.close();
            }
        } catch {
            // ignored
        }

        try {
            if ( this.#writer ) {
                this.#writer.releaseLock();
            }
        } catch {
            // ignored
        }

        this.#open = false;
        this.#emitClose(hadError);
    }

    #emitErrorAndClose (reason) {
        if ( this.#closed ) {
            return;
        }

        this.emit('error', normalizeErrorReason(reason));
        this.#closing = true;
        void this.#closeStreams(true);
    }

    #emitClose (hadError) {
        if ( this.#closed ) {
            return;
        }

        this.#closed = true;
        this.emit(this.#eventName('close'), Boolean(hadError));
    }

    #eventName (event) {
        if ( this.#useTls && (event === 'open' || event === 'data' || event === 'close') ) {
            return `tls${event}`;
        }

        return event;
    }
}

export class PTLSSocket extends PSocket {
    constructor (host, port) {
        super(host, port, { tls: true });
    }
}
