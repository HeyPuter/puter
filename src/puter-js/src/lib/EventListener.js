/**
 * Minimal named-event emitter. Subclasses declare the event names they
 * support; listening for anything else is reported and ignored.
 */
export default class EventListener {
    // Array of all supported event names.
    #eventNames;

    // Map of eventName -> array of listeners
    #eventListeners;

    /** @param {string[]} eventNames */
    constructor (eventNames) {
        this.#eventNames = eventNames;

        this.#eventListeners = (() => {
            const map = new Map();
            for ( let eventName of this.#eventNames ) {
                map[eventName] = [];
            }
            return map;
        })();
    }

    /**
     * @param {string} eventName
     * @param {unknown} [data]
     * @returns {void}
     */
    emit (eventName, data) {
        if ( ! this.#eventNames.includes(eventName) ) {
            console.error(`Event name '${eventName}' not supported`);
            return;
        }
        this.#eventListeners[eventName].forEach((listener) => {
            listener(data);
        });
    }

    /**
     * @param {string} eventName
     * @param {(data: never) => void} callback
     * @returns {this | undefined}
     */
    on (eventName, callback) {
        if ( ! this.#eventNames.includes(eventName) ) {
            console.error(`Event name '${eventName}' not supported`);
            return;
        }
        this.#eventListeners[eventName].push(callback);
        return this;
    }

    /**
     * @param {string} eventName
     * @param {(data: never) => void} callback
     * @returns {this | undefined}
     */
    off (eventName, callback) {
        if ( ! this.#eventNames.includes(eventName) ) {
            console.error(`Event name '${eventName}' not supported`);
            return;
        }
        const listeners = this.#eventListeners[eventName];
        const index = listeners.indexOf(callback);
        if ( index !== -1 ) {
            listeners.splice(index, 1);
        }
        return this;
    }
}