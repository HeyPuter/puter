/**
 * This module provides a simple RPC mechanism for cross-document
 * (iframe / window.postMessage) communication.
 */

// Since `Symbol` is not clonable, we use a UUID to identify RPCs.
export const $SCOPE = '9a9c83a4-7897-43a0-93b9-53217b84fde6';

/**
 * The CallbackManager is used to manage callbacks for RPCs.
 * It is used by the dehydrator and hydrator to store and retrieve
 * the functions that are being called remotely.
 */
export class CallbackManager {
    #messageId = 1;

    constructor () {
        this.callbacks = new Map();
    }

    register_callback (callback) {
        const id = this.#messageId++;
        this.callbacks.set(id, callback);
        return id;
    }

    attach_to_source (source) {
        source.addEventListener('message', event => {
            const { data } = event;
            if (data && typeof data === 'object' && data.$SCOPE === $SCOPE) {
                const { id, args } = data;
                const callback = this.callbacks.get(id);
                if (callback) {
                    callback(...args);
                }
            }
        });
    }
}

/**
 * The dehydrator replaces functions in an object with identifiers,
 * so that hydrate() can be called on the other side of the frame
 * to bind RPC stubs. The original functions are stored in a map
 * so that they can be called when the RPC is invoked.
 */
export class Dehydrator {
    constructor ({ callbackManager }) {
        this.callbackManager = callbackManager;
    }
    dehydrate (value) {
        return this.dehydrate_value_(value);
    }
    dehydrate_value_ (value) {
        if (typeof value === 'function') {
            const id = this.callbackManager.register_callback(value);
            return { $SCOPE, id };
        } else if (Array.isArray(value)) {
            return value.map(this.dehydrate_value_.bind(this));
        } else if (typeof value === 'object' && value !== null) {
            const result = {};
            for (const key in value) {
                result[key] = this.dehydrate_value_(value[key]);
            }
            return result;
        } else {
            return value;
        }
    }
}

/**
 * The hydrator binds RPC stubs to the functions that were
 * previously dehydrated. This allows the RPC to be invoked
 * on the other side of the frame.
 */
export class Hydrator {
    constructor ({ target }) {
        this.target = target;
    }
    hydrate (value) {
        return this.hydrate_value_(value);
    }
    hydrate_value_ (value) {
        if (
            value && typeof value === 'object' &&
            value.$SCOPE === $SCOPE
        ) {
            const { id } = value;
            return (...args) => {
                this.target.postMessage({ $SCOPE, id, args }, '*');
            };
        } else if (Array.isArray(value)) {
            return value.map(this.hydrate_value_.bind(this));
        } else if (typeof value === 'object' && value !== null) {
            const result = {};
            for (const key in value) {
                result[key] = this.hydrate_value_(value[key]);
            }
            return result;
        }
        return value;
    }
}
