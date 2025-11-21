import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

// why is this called deleteFSEntry instead of just delete?
// because delete is a reserved keyword in javascript
const deleteFSEntry = async function (...args) {
    let options;

    // If first argument is an object, it's the options
    if ( typeof args[0] === 'object' && args[0] !== null ) {
        options = args[0];
    }
    // Otherwise, we assume separate arguments are provided
    else {
        options = {
            paths: args[0],
            recursive: args[1]?.recursive ?? true,
            descendantsOnly: args[1]?.descendantsOnly ?? false,
        };
    }

    // If paths is a string, convert to array
    // this is to make it easier for the user to provide a single path without having to wrap it in an array
    let paths = options.paths;
    if ( typeof paths === 'string' )
    {
        paths = [paths];
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
        const xhr = utils.initXhr('/delete', this.APIOrigin, this.authToken);

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        // convert paths to absolute paths
        paths = paths.map((path) => {
            return getAbsolutePathForApp(path);
        });

        xhr.send(JSON.stringify({
            paths: paths,
            descendants_only: (options.descendants_only || options.descendantsOnly) ?? false,
            recursive: options.recursive ?? true,
        }));
    });
};

export default deleteFSEntry;