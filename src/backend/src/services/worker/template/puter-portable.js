// This file is not actually in the webpack project, it is handled seperately.

if (globalThis.Cloudflare) {
    // Cloudflare Workers has a faulty EventTarget implementation which doesn't bind "this" to the event handler
    // This is a workaround to bind "this" to the event handler
    // https://github.com/cloudflare/workerd/issues/4453
    const __cfEventTarget = EventTarget;
    globalThis.EventTarget = class EventTarget extends __cfEventTarget {
        constructor(...args) {
            super(...args)
        }
        addEventListener(type, listener, options) {
            super.addEventListener(type, listener.bind(this), options);
        }
    }
}

globalThis.init_puter_portable = (auth, apiOrigin) => {
    console.log("Starting puter.js initialization");

    // Who put C in my JS??
    /*
     *  This is a hack to include the puter.js file.
     *  It is not a good idea to do this, but it is the only way to get the puter.js file to work.
     *  The puter.js file is handled by the C preprocessor here because webpack cant behave with already minified files.
     * The C preprocessor basically just includes the file and then we can use the puter.js file in the worker.
     */
    #include "../../../../../puter-js/dist/puter.js"
    puter.setAPIOrigin(apiOrigin);
    puter.setAuthToken(auth);
}
#include "../dist/webpackPreamplePart.js"

