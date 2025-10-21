import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const rename = function (...args) {
    let options;

    // If first argument is an object, it's the options
    if (typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            path: args[0],
            new_name: args[1],
            success: args[2],
            error: args[3],
            // Add more if needed...
        };
    }


    return new Promise(async (resolve, reject) => {
        // If auth token is not provided and we are in the web environment, 
        // try to authenticate with Puter
        if (!puter.authToken && puter.env === 'web') {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                reject('Authentication failed.');
            }
        }

        // create xhr object
        const xhr = utils.initXhr('/rename', this.APIOrigin, this.authToken);


        // we have:
        // options.uid, options.new_name

        const originalSuccess = options.success;
        const wrappedSuccess = (...args) => {
            if ( originalSuccess ) {
                originalSuccess(...args);
            }

            // ================== client-replica hook start ==================
            if ( puter.fs.replica.available ) {
                if ( args.length !== 1 ) {
                    console.error('client-replica: rename hook only supports 1 argument, got', args);
                    return;
                }
                if ( puter.fs.replica.debug ) {
                    console.log('local rename hook, args:', args);
                }
                const renamed = args[0];
                puter.fs.replica.fs_tree.rename(renamed.uid, renamed.name, renamed.path);
                puter.fs.replica.last_local_update = Date.now();
            }
            // ================== client-replica hook end ==================
        };

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, wrappedSuccess, options.error, resolve, reject);

        let dataToSend = {
            original_client_socket_id: options.excludeSocketID || options.original_client_socket_id,
            new_name: options.new_name || options.newName,
        };

        if (options.uid !== undefined) {
            dataToSend.uid = options.uid;
        } else if (options.path !== undefined) {
            // If dirPath is not provided or it's not starting with a slash, it means it's a relative path
            // in that case, we need to prepend the app's root directory to it
            dataToSend.path = getAbsolutePathForApp(options.path);
        }

        xhr.send(JSON.stringify(dataToSend));

    })
}

export default rename;