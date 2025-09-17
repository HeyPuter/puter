// This file exists but I'm pretty sure it's unused
// if you're typing to modify the stat implementation look at src/puter-js/src/lib/filesystem/APIFS.js

import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const stat = async function (...args) {
    let options;

    // If first argument is an object, it's the options
    if (typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            path: args[0],
            options: typeof args[1] === 'object' ? args[1] : {},
            success: typeof args[1] === 'object' ? args[2] : args[1],
            error: typeof args[1] === 'object' ? args[3] : args[2],
            // Add more if needed...
        };
    }

    return new Promise(async (resolve, reject) => {
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
        const xhr = utils.initXhr('/stat', this.APIOrigin, this.authToken);

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        let dataToSend = {};
        if (options.uid !== undefined) {
            dataToSend.uid = options.uid;
        } else if (options.path !== undefined) {
            // If dirPath is not provided or it's not starting with a slash, it means it's a relative path
            // in that case, we need to prepend the app's root directory to it
            dataToSend.path = getAbsolutePathForApp(options.path);
        }
        
        dataToSend.return_subdomains = options.returnSubdomains;
        dataToSend.return_permissions = options.returnPermissions;
        dataToSend.return_versions = options.returnVersions;
        dataToSend.return_size = options.returnSize;

        xhr.send(JSON.stringify(dataToSend));
    })
}

export default stat;