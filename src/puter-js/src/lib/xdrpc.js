/**
 * This module provides a simple RPC mechanism for cross-document
 * (iframe / window.postMessage) communication.
 */

// Since `Symbol` is not clonable, we use a UUID to identify RPCs.
export const $SCOPE = '9a9c83a4-7897-43a0-93b9-53217b84fde6';

/**
 * Copy a key onto a rebuilt object as an own data property.
 *
 * Both sides of this bridge rebuild objects out of values the *other*
 * document sent, so `result[key] = value` is not safe: a message carrying a
 * literal `__proto__` key would hit `Object.prototype`'s setter and swap the
 * prototype of the object we hand to our own caller, making it look like it
 * has properties it was never sent. `defineProperty` always writes data.
 *
 * @param {Record<string, unknown>} target
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
const defineOwn = (target, key, value) => {
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
};

/**
 * A callback id travels to the other document, so it must not be guessable:
 * any window able to reach ours can post `$SCOPE` messages, and `$SCOPE`
 * itself is a public constant.
 *
 * @returns {string}
 */
const randomCallbackId = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * The CallbackManager is used to manage callbacks for RPCs.
 * It is used by the dehydrator and hydrator to store and retrieve
 * the functions that are being called remotely.
 */
export class CallbackManager {
    constructor () {
        this.callbacks = new Map();
    }

    /**
     * Registers `callback` and binds it to `source`, the only window whose
     * messages may invoke it later. A callback registered without a source
     * can never be invoked from outside this document.
     *
     * @param {Function} callback
     * @param {Window} [source]
     * @returns {string}
     */
    register_callback (callback, source) {
        const id = randomCallbackId();
        this.callbacks.set(id, { callback, source });
        return id;
    }

    /**
     * @param {Window} target
     * @returns {void}
     */
    attach_to_source (target) {
        target.addEventListener('message', event => {
            const { data } = event;
            if ( ! data || typeof data !== 'object' || data.$SCOPE !== $SCOPE ) {
                return;
            }
            const entry = this.callbacks.get(data.id);
            // Only the window the callback was dehydrated for may invoke it,
            // otherwise a sibling frame could drive another app's callbacks.
            if ( ! entry || event.source !== entry.source ) return;
            entry.callback(...(Array.isArray(data.args) ? data.args : []));
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
    constructor ({ callbackManager, source }) {
        this.callbackManager = callbackManager;
        this.source = source;
    }
    dehydrate (value) {
        return this.dehydrate_value_(value);
    }
    dehydrate_value_ (value) {
        if ( typeof value === 'function' ) {
            const id = this.callbackManager.register_callback(value, this.source);
            return { $SCOPE, id };
        } else if ( Array.isArray(value) ) {
            return value.map(this.dehydrate_value_.bind(this));
        } else if ( typeof value === 'object' && value !== null ) {
            const result = {};
            for ( const key of Object.keys(value) ) {
                defineOwn(result, key, this.dehydrate_value_(value[key]));
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
        } else if ( Array.isArray(value) ) {
            return value.map(this.hydrate_value_.bind(this));
        } else if ( typeof value === 'object' && value !== null ) {
            const result = {};
            for ( const key of Object.keys(value) ) {
                defineOwn(result, key, this.hydrate_value_(value[key]));
            }
            return result;
        }
        return value;
    }
}
