// This file is not actually in the webpack project, it is handled seperately.

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

