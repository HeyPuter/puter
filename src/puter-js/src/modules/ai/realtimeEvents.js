/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

/**
 * Native realtime event names are open ended.
 *
 * @template {Record<string, RealtimeServerEvent>} [Events=Record<string, RealtimeServerEvent>]
 *   Default is `Record<string, RealtimeServerEvent>`
 */
export class RealtimeEvents {
    /** @type {Map<string, Set<(event: RealtimeServerEvent) => void>>} */
    #listeners = new Map();

    /**
     * @template {keyof Events & string} K
     * @param {K} type
     * @param {(event: Events[K]) => void} handler
     * @returns {() => void} Removes the listener.
     */
    on(type, handler) {
        if (typeof type !== 'string' || typeof handler !== 'function') {
            throw {
                code: 'invalid_argument',
                message: 'Expected an event name and listener',
            };
        }
        let handlers = this.#listeners.get(type);
        if (!handlers) this.#listeners.set(type, (handlers = new Set()));
        handlers.add(handler);
        return () => this.off(type, handler);
    }

    /**
     * @template {keyof Events & string} K
     * @param {K} type
     * @param {(event: Events[K]) => void} handler
     * @returns {void}
     */
    off(type, handler) {
        const handlers = this.#listeners.get(type);
        handlers?.delete(handler);
        if (!handlers?.size) this.#listeners.delete(type);
    }

    /**
     * @param {RealtimeServerEvent} event
     * @returns {void}
     * @internal
     */
    emitRealtime(event) {
        for (const type of [event.type, '*']) {
            for (const handler of this.#listeners.get(type) ?? []) {
                try {
                    handler(event);
                } catch (error) {
                    console.error('[puter.ai] realtime listener error', error);
                }
            }
        }
    }

    /**
     * @param {string} type
     * @returns {boolean}
     * @internal
     */
    hasRealtimeListeners(type) {
        return !!this.#listeners.get(type)?.size;
    }

    /**
     * @returns {void}
     * @internal
     */
    clearRealtimeListeners() {
        this.#listeners.clear();
    }
}
