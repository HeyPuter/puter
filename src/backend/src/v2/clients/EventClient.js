import { PuterClient } from './types';

export class EventClient extends PuterClient {

    #eventListeners = {};

    onServerStart () {
        this.emit('serverStart', {}, {});
    }
    onServerPrepareShutdown () {
        this.emit('serverPrepareShutdown', {}, {});
    }
    onServerShutdown () {
        this.emit('serverShutdown', {}, {});
    }

    /**
     * Dispatch an event to every matching subscriber.
     *
     * Match semantics (mirrors v1's `EventService`): emit walks every
     * dot-separated prefix of `key`, looking up `<prefix>.*` listeners
     * for prefixes shorter than the full key, and exact-key listeners
     * on the final iteration. So emitting `outer.gui.item.removed`
     * fires subscribers on:
     *
     *   - `outer.*`
     *   - `outer.gui.*`
     *   - `outer.gui.item.*`
     *   - `outer.gui.item.removed`
     *
     * Subscribers are still keyed in a single map — wildcards just live
     * under their literal `<prefix>.*` string. No regex, no per-emit
     * scan of every listener.
     *
     * @param {string} key
     * @param {unknown} data
     * @param {object} meta
     */
    emit (key, data, meta) {
        const parts = key.split('.');
        for ( let i = 0; i < parts.length; i++ ) {
            const matchKey = i === parts.length - 1
                ? key
                : `${parts.slice(0, i + 1).join('.')}.*`;
            const listeners = this.#eventListeners[matchKey];
            if ( ! listeners ) continue;
            for ( const listener of listeners ) {
                this.#emitEvent(listener, key, data, meta);
            }
        }
    }

    /**
     * Subscribe to an event by exact key OR a wildcard prefix.
     *
     * Wildcards: a key ending in `.*` matches every event whose name
     * starts with the prefix. `outer.*` matches `outer.gui.item.removed`,
     * `outer.fs.write-hash`, and any other dot-extended descendant.
     * Exact keys still match exactly. See `emit()` for the dispatch order.
     *
     * Callback receives the full `(key, data, meta)` tuple as passed
     * to `emit()` — wildcard subscribers can branch on the triggering
     * event name.
     *
     * @param {string} key
     * @param {(key: string, data: unknown, meta: object) => void} callback
     */
    on (key, callback) {
        if ( ! this.#eventListeners[key] ) {
            this.#eventListeners[key] = [];
        }
        this.#eventListeners[key].push(callback);
    }

    async #emitEvent (listener, key, data, meta) {
        try {
            await listener(key, data, meta);
        } catch (e) {
            console.error('Error in event listener for event', key, e);
        }
    }
}