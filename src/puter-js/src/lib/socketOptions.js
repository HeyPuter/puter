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
