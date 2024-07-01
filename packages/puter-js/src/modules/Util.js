import { CallbackManager, Dehydrator, Hydrator } from "../lib/xdrpc";

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
        this.callbackManager.attach_to_source(window);
    }

    getDehydrator () {
        return new Dehydrator({ callbackManager: this.callbackManager });
    }

    getHydrator ({ target }) {
        return new Hydrator({ target });
    }
}
