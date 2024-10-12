import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const readdir = async function (...args) {
    let options;

    // If first argument is an object, it's the options
    if (typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            path: args[0],
            success: args[1],
            error: args[2],
        };
    }

    return new Promise(async (resolve, reject) => {
        // path is required
        if(!options.path){
            throw new Error({ code: 'NO_PATH', message: 'No path provided.' });
        }

        // If auth token is not provided and we are in the web environment, 
        // try to authenticate with Puter
        if(!puter.authToken && puter.env === 'web'){
            try{
                await puter.ui.authenticateWithPuter();
            }catch(e){
                // if authentication fails, throw an error
                reject('Authentication failed.');
            }
        }

        // create xhr object
        const xhr = utils.initXhr('/readdir', this.APIOrigin, this.authToken);

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        xhr.send(JSON.stringify({
            path: getAbsolutePathForApp(options.path),
            no_thumbs: options.no_thumbs,
            no_assocs: options.no_assocs,
        }));
    })
}

export default readdir;