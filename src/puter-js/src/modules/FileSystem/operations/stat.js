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
        // consistency levels
        if(!options.consistency){
            options.consistency = 'strong';
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

        // Generate cache key based on path or uid
        let cacheKey;
        if(options.path){
            cacheKey = 'item:' + options.path;
        }

        if(options.consistency === 'eventual' && !options.returnSubdomains && !options.returnPermissions && !options.returnVersions && !options.returnSize){
            // Check cache
            const cachedResult = await puter._cache.get(cacheKey);
            if(cachedResult){
                resolve(cachedResult);
                return;
            }
        }

        // create xhr object
        const xhr = utils.initXhr('/stat', this.APIOrigin, undefined, "post", "text/plain;actually=json");

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, async (result) => {
            // Calculate the size of the result for cache eligibility check
            const resultSize = JSON.stringify(result).length;
            
            // Cache the result if it's not bigger than MAX_CACHE_SIZE
            const MAX_CACHE_SIZE = 20 * 1024 * 1024;

            if(resultSize <= MAX_CACHE_SIZE){
                // UPSERT the cache
                puter._cache.set(cacheKey, result);
            }
            
            resolve(result);
        }, reject);

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
        dataToSend.auth_token = this.authToken;

        xhr.send(JSON.stringify(dataToSend));
    })
}

export default stat;