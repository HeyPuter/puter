import { WebSocket as WebSocketTransport, XHR as PollingTransport } from 'engine.io-client';

/** @typedef {import('../index.js').Puter} Puter */

/**
 * Whether socket.io may unref its connection so an idle socket does not keep
 * a node process alive. Its autoUnref path expects `ws._socket.unref()` to
 * exist, which only the `ws` package provides — Undici's WebSocket has no such
 * thing, so asking for it there throws.
 *
 * @param {Puter} puter
 * @returns {boolean}
 */
export const socketAutoUnref = (puter) => {
    if ( puter.env !== 'nodejs' ) return false;

    const WebSocketImpl = globalThis.WebSocket;
    if ( typeof WebSocketImpl !== 'function' ) return false;

    // ws instances are EventEmitter-like; Undici's are EventTarget-like.
    const wsPrototype = /** @type {Record<string, unknown>} */ (WebSocketImpl.prototype ?? {});
    return typeof wsPrototype.on === 'function' &&
        typeof wsPrototype.removeListener === 'function';
};

/**
 * The socket.io connection options that pick the transport. When the socket
 * is unref'd, the WebSocket transport must be built from the same
 * `globalThis.WebSocket` that `socketAutoUnref` checked: engine.io's own
 * lookup can land on another realm's global (as under `init.cjs`).
 *
 * @param {Puter} puter
 * @returns {{ autoUnref: boolean, transports: Array<string | typeof WebSocketTransport | typeof PollingTransport> }}
 */
export const socketTransportOptions = (puter) => {
    if ( ! socketAutoUnref(puter) ) {
        return { autoUnref: false, transports: ['websocket', 'polling'] };
    }

    const WebSocketImpl = globalThis.WebSocket;
    class UnrefableWebSocketTransport extends WebSocketTransport {
        /**
         * @param {string} uri
         * @param {string | string[] | undefined} protocols
         */
        createSocket (uri, protocols) {
            return protocols ? new WebSocketImpl(uri, protocols) : new WebSocketImpl(uri);
        }
    }
    return { autoUnref: true, transports: [UnrefableWebSocketTransport, PollingTransport] };
};
