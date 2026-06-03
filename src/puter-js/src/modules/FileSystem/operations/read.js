import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const read = function (...args) {
    let options;

    // If first argument is an object, it's the options
    if ( typeof args[0] === 'object' && args[0] !== null ) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            path: typeof args[0] === 'string' ? args[0] : (typeof args[0] === 'object' && args[0] !== null ? args[0].path : args[0]),
            ...(typeof (args[1]) === 'object' ? args[1] : {
                success: args[1],
                error: args[2],
            }),
        };
    }

    return new Promise(async (resolve, reject) => {
        // If auth token is not provided and we are in the web environment,
        // try to authenticate with Puter
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                reject('Authentication failed.');
            }
        }

        // convert path to absolute path
        options.path = getAbsolutePathForApp(options.path);

        // create xhr object
        const xhr = utils.initXhr(`/read?${ new URLSearchParams({ file: options.path, ...(options.offset ? { offset: options.offset } : {}), ...(options.byte_count ? { byte_count: options.byte_count } : {}) }).toString()}`, this.APIOrigin, this.authToken, 'get', 'application/json;charset=UTF-8', 'blob');

        // `/read` is a GET on a URL that's identical for a given path, so the
        // browser HTTP-caches the response. Writes go through a different
        // endpoint (upload) and never touch this URL's cache entry, so a
        // read-after-write is served the stale pre-write body. Force the browser
        // to revalidate with the origin on every read. This still allows a cheap
        // 304 when the server sends a validator (ETag/Last-Modified), so it is
        // not a blunt cache-buster. Opt back into caching with { cache: true }.
        if ( options.cache !== true ) {
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.setRequestHeader('Pragma', 'no-cache'); // HTTP/1.0 intermediaries
        }

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        xhr.send();
    });
};

export default read;