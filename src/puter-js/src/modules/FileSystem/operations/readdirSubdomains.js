import * as utils from '../../../lib/utils.js';

/**
 * Fetches subdomains for multiple directories in a batch
 * @param {Object} options - Options object
 * @param {Array<number>} options.directory_ids - Array of directory IDs to fetch subdomains for
 * @param {Function} [options.success] - Success callback
 * @param {Function} [options.error] - Error callback
 * @returns {Promise<Array>} Array of objects with directory_id, subdomains, and has_website
 */
const readdirSubdomains = async function (options) {
    return new Promise(async (resolve, reject) => {
        // Validate options
        if ( !options || typeof options !== 'object' ) {
            reject(new Error('Options object is required'));
            return;
        }

        if ( !Array.isArray(options.directory_ids) || options.directory_ids.length === 0 ) {
            reject(new Error('directory_ids must be a non-empty array'));
            return;
        }

        // If auth token is not provided and we are in the web environment,
        // try to authenticate with Puter
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                reject(new Error('Authentication failed.'));
                return;
            }
        }

        // create xhr object
        const xhr = utils.initXhr('/readdir-subdomains', this.APIOrigin, undefined, 'post', 'text/plain;actually=json');

        // set up event handlers for load and error events
        utils.setupXhrEventHandlers(xhr, options.success, options.error, async (result) => {
            resolve(result);
        }, reject);

        // Build request payload
        const payload = {
            directory_ids: options.directory_ids,
            auth_token: this.authToken,
        };

        xhr.send(JSON.stringify(payload));
    });
};

export default readdirSubdomains;
