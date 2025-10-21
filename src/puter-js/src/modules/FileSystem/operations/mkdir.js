import path from "../../../lib/path.js";
import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const mkdir = function(...args) {
    let options = {};

    // If first argument is a string and the second is an object, or if the first is an object
    if ( (typeof args[0] === 'string' && typeof args[1] === 'object' && !(args[1] instanceof Function)) || (typeof args[0] === 'object' && args[0] !== null) ) {
        // If it's a string followed by an object, it means path then options
        if ( typeof args[0] === 'string' ) {
            options.path = args[0];
            // Merge the options
            Object.assign(options, args[1]);
            options.success = args[2];
            options.error = args[3];
        } else {
            options = args[0];
        }
    } else if ( typeof args[0] === 'string' ) {
        // it means it's a path then functions (success and optionally error)
        options.path = args[0];
        options.success = args[1];
        options.error = args[2];
    }

    return new Promise(async (resolve, reject) => {
        // If auth token is not provided and we are in the web environment,
        // try to authenticate with Puter
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch( e ) {
                // if authentication fails, throw an error
                reject('Authentication failed.');
            }
        }

        // create xhr object
        const xhr = utils.initXhr('/mkdir', this.APIOrigin, this.authToken);

        const originalSuccess = options.success;
        const wrappedSuccess = (...args) => {
            if ( originalSuccess ) {
                originalSuccess(...args);
            }

            // ================== client-replica hook start ==================
            if ( puter.fs.replica.available ) {
                if ( args.length !== 1 ) {
                    console.error('client-replica: mkdir hook only supports 1 argument, got', args);
                    return;
                }
                if ( puter.fs.replica.debug ) {
                    console.log('local mkdir hook, args:', args);
                }
                const new_fs_entry = args[0];
                puter.fs.replica.fs_tree.newFSEntry(new_fs_entry);
                puter.fs.replica.last_local_update = Date.now();
            }
            // ================== client-replica hook end ==================
        };

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, wrappedSuccess, options.error, resolve, reject);

        options.path = getAbsolutePathForApp(options.path);

        xhr.send(JSON.stringify({
            parent: path.dirname(options.path),
            path: path.basename(options.path),
            overwrite: options.overwrite ?? false,
            dedupe_name: (options.rename || options.dedupeName) ?? false,
            shortcut_to: options.shortcutTo,
            original_client_socket_id: this.socket.id,
            create_missing_parents: (options.recursive || options.createMissingParents) ?? false,
        }));
    })
}

export default mkdir;