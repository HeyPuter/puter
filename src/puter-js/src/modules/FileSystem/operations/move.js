import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import stat from "./stat.js"
import path from "../../../lib/path.js"

const move = function (...args) {
    let options;
    // If first argument is an object, it's the options
    if (typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            source: args[0],
            destination: args[1],
            overwrite: args[2]?.overwrite,
            new_name: args[2]?.newName || args[2]?.new_name,
            create_missing_parents: args[2]?.createMissingParents || args[2]?.create_missing_parents,
            new_metadata: args[2]?.newMetadata || args[2]?.new_metadata,
            original_client_socket_id: args[2]?.excludeSocketID || args[2]?.original_client_socket_id,
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

        // convert source and destination to absolute path
        options.source = getAbsolutePathForApp(options.source);
        options.destination = getAbsolutePathForApp(options.destination);

        if (!options.new_name) {
            // Handler to check if dest is supposed to be a file or a folder
            try {
                const destStats = await stat.bind(this)(options.destination); // this is meant to error if it doesn't exist
                if (!destStats.is_dir) {
                    throw "is not directory" // just a wuick way to just to the catch
                }
            } catch (e) {
                options.new_name = path.basename(options.destination);
                options.destination = path.dirname(options.destination);
            }
        }

        // create xhr object
        const xhr = utils.initXhr('/move', this.APIOrigin, this.authToken);

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        xhr.send(JSON.stringify({
            source: options.source,
            destination: options.destination,
            overwrite: options.overwrite,
            new_name: (options.new_name || options.newName),
            create_missing_parents: (options.create_missing_parents || options.createMissingParents),
            new_metadata: (options.new_metadata || options.newMetadata),
            original_client_socket_id: options.excludeSocketID,
        }));

        // todo: EXTREMELY NAIVE CACHE PURGE
        puter._cache.flushall();

    })
}

export default move;