import EventListener from '../../lib/EventListener.js';
import { fetchUrl } from '../../lib/networkUtils.js';
import { errors } from './parsers.js';
import { PWispHandler } from './PWispHandler.js';
const texten = new TextEncoder();
const requireAuth = true;

export let wispInfo = {
    server: 'wss://puter.cafe/', // Unused currently
    handler: undefined,
};

/** @typedef {import('../../../types/modules/networking').SocketEvent} SocketEvent */

/**
 * A raw TCP socket in the browser, tunnelled over the Wisp relay. Construct it
 * with `puter.net.Socket(hostname, port)`; the connection is established
 * asynchronously, so write once `'open'` has fired.
 */
export class PSocket extends EventListener {
    _events = new Map();
    _streamID;
    /**
     * @param {string} host hostname or IP address of the server to connect to
     * @param {number} port port to connect to on that server
     */
    constructor (host, port) {
        super(['data', 'drain', 'open', 'error', 'close', 'tlsdata', 'tlsopen', 'tlsclose']);

        (async () => {
            if ( !puter.authToken && puter.env === 'web' && requireAuth ) {
                try {
                    await puter.ui.authenticateWithPuter();

                } catch (e) {
                    // if authentication fails, throw an error
                    throw (e);
                }
            }
            if ( ! wispInfo.handler ) {
                // first launch -- lets init the socket
                const { token: wispToken, server: wispServer } = (await (await fetchUrl(`${puter.APIOrigin }/wisp/relay-token/create`, {
                    method: 'POST',
                    includePuterAuth: !! puter.authToken,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                })).json());

                wispInfo.handler = new PWispHandler(wispServer, wispToken);
                // Wait for websocket to fully open
                await new Promise((res, req) => {
                    wispInfo.handler.onReady = res;
                });
            }

            const callbacks = {
                dataCallBack: (data) => {
                    this.emit('data', data);
                },
                closeCallBack: (reason) => {
                    if ( reason !== 0x02 ) {
                        this.emit('error', new Error(errors[reason]));
                        this.emit('close', true);
                        return;
                    }
                    this.emit('close', false);
                },
            };

            this._streamID = wispInfo.handler.register(host, port, callbacks);
            setTimeout(() => {
                this.emit('open', undefined);
            }, 0);

        })();
    }
    /**
     * Registers a handler for a socket event, the same as `on`.
     *
     * @param {...unknown} args a `(event, handler)` pair
     * @returns {void}
     */
    addListener (...args) {
        this.on(...args);
    }

    /**
     * Writes data to the socket, invoking `callback` once it has been handed
     * to the relay. Throws if `data` is not a string, `ArrayBuffer`, or typed
     * array.
     *
     * @param {ArrayBuffer | ArrayBufferView | string} data
     * @param {() => void} [callback]
     * @returns {void}
     */
    write (data, callback) {
        if ( data.buffer ) { // TypedArray
            wispInfo.handler.write(this._streamID, data);
            if ( callback ) callback();
        } else if ( data.resize ) { // ArrayBuffer
            data.write(this._streamID, new Uint8Array(data));
            if ( callback ) callback();
        } else if ( typeof (data) === 'string' ) {
            wispInfo.handler.write(this._streamID, texten.encode(data));
            if ( callback ) callback();
        } else {
            throw new Error('Invalid data type (not TypedArray, ArrayBuffer or String!!)');
        }
    }
    /**
     * Closes the TCP connection.
     *
     * @returns {void}
     */
    close () {
        wispInfo.handler.close(this._streamID);
    }
}