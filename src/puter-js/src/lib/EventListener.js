export default class EventListener {
    // Array of all supported event names.
    #eventNames;

    // Map of eventName -> array of listeners
    #eventListeners;

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

    emit (eventName, data) {
        if ( ! this.#eventNames.includes(eventName) ) {
            console.error(`Event name '${eventName}' not supported`);
            return;
        }
        this.#eventListeners[eventName].forEach((listener) => {
            listener(data);
        });
    }

    on (eventName, callback) {
        if ( ! this.#eventNames.includes(eventName) ) {
            console.error(`Event name '${eventName}' not supported`);
            return;
        }
        this.#eventListeners[eventName].push(callback);
        return this;
    }

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