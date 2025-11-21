import * as utils from '../../../lib/utils.js';

const space = function (...args) {
    let options;

    // If first argument is an object, it's the options
    if ( typeof args[0] === 'object' && args[0] !== null ) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            success: args[0],
            error: args[1],
            // Add more if needed...
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

        // create xhr object
        const xhr = utils.initXhr('/df', this.APIOrigin, this.authToken);

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        xhr.send();
    });
};

export default space;