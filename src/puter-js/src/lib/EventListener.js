/**
 * Minimal named-event emitter. Subclasses declare the event names they
 * support; listening for anything else is reported and ignored.
 *
 * A subclass names its events — and the payload each one carries — by passing
 * an event map through `@extends`, which is what gives callers a typed
 * `handler` argument per event name:
 *
 *   /** @extends {EventListener<{ open: void, data: Uint8Array }>} *\/
 *   class MySocket extends EventListener { ... }
 *
 * @template {Record<string, unknown>} [EventMap=Record<string, unknown>]
 */
export default class EventListener {
    // Array of all supported event names.
    #eventNames;

    // Map of eventName -> array of listeners
    #eventListeners;

    /** @param {(keyof EventMap & string)[] | string[]} eventNames */
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
     * Calls every handler registered for `eventName` with `data`.
     *
     * @template {keyof EventMap & string} K
     * @param {K} eventName
     * @param {EventMap[K]} [data]
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
     * Registers `callback` for `eventName`. Returns `undefined` — after
     * reporting it — when the event is not one this emitter supports.
     *
     * @template {keyof EventMap & string} K
     * @param {K} eventName
     * @param {(data: EventMap[K]) => void} callback
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
     * Removes a handler previously registered with `on`.
     *
     * @template {keyof EventMap & string} K
     * @param {K} eventName
     * @param {(data: EventMap[K]) => void} callback
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
