import { $SCOPE, CallbackManager, Dehydrator, Hydrator } from '../lib/xdrpc.js';

/**
 * The Util module exposes utilities within puter.js itself.
 * These utilities may be used internally by other modules.
 */
export default class Util {
    constructor () {
        // This is in `puter.util.rpc` instead of `puter.rpc` because
        // `puter.rpc` is reserved for an app-to-app RPC interface.
        // This is a lower-level RPC interface used to communicate
        // with iframes.
        this.rpc = new UtilRPC();
    }
}

class UtilRPC {
    constructor () {
        this.callbackManager = new CallbackManager();
        this.callbackManager.attach_to_source(globalThis);
    }

    /**
     * A dehydrator that replaces functions in a value with callback ids this
     * side can later resolve, so the value survives `postMessage`.
     *
     * @returns {{ dehydrate: (value: unknown) => unknown }}
     */
    getDehydrator () {
        return new Dehydrator({ callbackManager: this.callbackManager });
    }

    /**
     * A hydrator that turns callback ids in a dehydrated value back into
     * functions which post to `target`.
     *
     * @param {{ target: Window | Worker | MessagePort }} config
     * @returns {{ hydrate: (value: unknown) => unknown }}
     */
    getHydrator ({ target }) {
        return new Hydrator({ target });
    }

    /**
     * Registers a function under a callback id the other side can invoke.
     *
     * @param {(value: unknown) => void} resolve
     * @returns {string}
     */
    registerCallback (resolve) {
        return this.callbackManager.register_callback(resolve);
    }

    /**
     * Invokes a registered callback on `target` by id.
     *
     * @param {Window | Worker | MessagePort} target
     * @param {string} id
     * @param {...unknown} args
     * @returns {void}
     */
    send (target, id, ...args) {
        target.postMessage({ $SCOPE, id, args }, '*');
    }
}
