import EventListener from '../../lib/EventListener.js';
import { clearEpoxyClientCache, getEpoxyClient } from './index.js';

/** @typedef {import('../../../types/modules/networking').SocketEvent} SocketEvent */

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

    // Verbatim from the pre-epoxy socket: apps match on this message, so the
    // trailing '!!' stays.
    throw new Error('Invalid data type (not TypedArray, ArrayBuffer or String!!)');
}

function normalizeError (reason) {
    if ( reason instanceof Error ) {
        return reason;
    }

    return new Error(String(reason));
}

/**
 * A raw TCP socket in the browser, tunnelled over the Wisp relay. Construct it
 * with `puter.net.Socket(hostname, port)`; the connection is established
 * asynchronously, so writes issued before `'open'` fires are queued and sent
 * once the stream is up.
 */
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

    /**
     * @param {string} host hostname or IP address of the server to connect to
     * @param {number} port port to connect to on that server
     * @param {{ tls?: boolean }} [options] `tls: true` wraps the connection in
     * TLS and switches to the `tls`-prefixed events; {@link PTLSSocket} sets it
     */
    constructor (host, port, options = {}) {
        super(['data', 'drain', 'open', 'error', 'close', 'tlsdata', 'tlsopen', 'tlsclose']);

        this.#host = host;
        this.#port = Number(port);
        this.#useTls = Boolean(options.tls);

        void this.#connect();
    }

    /**
     * Registers a handler for a socket event. On a TLS socket, `'open'`,
     * `'data'` and `'close'` are accepted as aliases of the `tls`-prefixed
     * events, so the same handler code works against either socket type.
     *
     * @param {SocketEvent} event
     * @param {(...args: unknown[]) => void} callback
     * @returns {void}
     */
    on (event, callback) {
        if ( this.#useTls && (event === 'open' || event === 'data' || event === 'close') ) {
            return super.on(`tls${event}`, callback);
        }

        return super.on(event, callback);
    }

    /**
     * Registers a handler for a socket event, the same as {@link PSocket#on}.
     *
     * @param {SocketEvent} event
     * @param {(...args: unknown[]) => void} callback
     * @returns {void}
     */
    addListener (event, callback) {
        return this.on(event, callback);
    }

    /**
     * Writes data to the socket, invoking `callback` once it has been handed to
     * the relay. Data written before the socket is open is queued. Throws if
     * `data` is not a string, `ArrayBuffer`, or typed array, or if the socket
     * has already closed.
     *
     * @param {ArrayBuffer | ArrayBufferView | string} data
     * @param {() => void} [callback]
     * @returns {void}
     */
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

    /**
     * Closes the TCP connection.
     *
     * @returns {void}
     */
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
                try {
                    callback();
                } catch ( callbackError ) {
                    setTimeout(() => { throw callbackError; }, 0);
                }
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

            // A teardown already under way owns the close event. Cancelling the
            // reader resolves the pending read with `done`, which lands here
            // first; emitting now would report a clean shutdown and let
            // #closeStreams' hadError flag lose the race.
            if ( ! this.#closing ) {
                this.#emitClose(false);
            }
        } catch ( error ) {
            if ( this.#closing ) {
                // As above: #closeStreams is mid-flight and will emit close.
                return;
            }

            clearEpoxyClientCache();
            this.#emitErrorAndClose(error);
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

        this.emit('error', normalizeError(reason));
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

/**
 * A TLS-protected TCP socket in the browser. Same interface as {@link PSocket},
 * but the connection is encrypted and its events are `'tls'`-prefixed.
 * Construct it with `puter.net.tls.TLSSocket(hostname, port)`.
 */
export class PTLSSocket extends PSocket {
    /**
     * @param {string} host hostname or IP address of the server to connect to
     * @param {number} port port to connect to on that server
     */
    constructor (host, port) {
        super(host, port, { tls: true });
    }
}
