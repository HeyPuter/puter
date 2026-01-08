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

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        xhr.send();
    });
};

export default read;