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
     * @param {string} key
     * @param {unknown} data
     * @param {object} meta
    */
    emit (key, data, meta) {
        for ( const listener of this.#eventListeners[key] ?? [] ) {
            this.#emitEvent(listener, key, data, meta);
        }
    }

    /**
     * @param {string} key
     * @param {(data: unknown, meta: object) => void} callback
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