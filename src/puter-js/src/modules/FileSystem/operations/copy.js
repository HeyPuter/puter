/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const copy = function (...args) {
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
            success: args[3],
            error: args[4],
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

        // convert paths to absolute path
        options.source = getAbsolutePathForApp(options.source);
        options.destination = getAbsolutePathForApp(options.destination);

        // create xhr object
        const xhr = utils.initXhr('/copy', this.APIOrigin, this.authToken);

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

        xhr.send(JSON.stringify({
            original_client_socket_id: this.socket.id,
            socket_id: this.socket.id,
            source: options.source,
            destination: options.destination,
            overwrite: options.overwrite,
            new_name: (options.new_name || options.newName),
            // if user is copying an item to where its source is, change the name so there is no conflict
            dedupe_name: (options.dedupe_name || options.dedupeName),
        }));
    })
}

export default copy;