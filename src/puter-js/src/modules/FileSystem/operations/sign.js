
import * as utils from '../../../lib/utils.js';

/**
 * Signs a file system entry or entries and optionally calls a provided callback with the result.
 * If a single item is passed, it is converted into an array.
 * Sends a POST request to the server to sign the items.
 *
 * @param {(Object|Object[])} items - The file system entry or entries to be signed. Can be a single object or an array of objects.
 * @param {function} [callback] - Optional callback function to be invoked with the result of the signing.
 * @returns {(Object|Object[])} If a single item was passed, returns a single object. If multiple items were passed, returns an array of objects.
 * @throws {Error} If the AJAX request fails.
 * @async
 */
const sign = function (...args) {
    let options;

    // Otherwise, we assume separate arguments are provided
    options = {
        app_uid: args[0],
        items: args[1],
        success: args[2],
        error: args[3],
        // Add more if needed...
    };

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

        let items = options.items;

        // if only a single item is passed, convert it to array
        // so that the code below can work with arrays
        if ( ! Array.isArray(items) ) {
            items = [items];
        }

        // create xhr object
        const xhr = utils.initXhr('/sign', this.APIOrigin, this.authToken);

        // response
        xhr.addEventListener('load', async function (e) {
            const resp = await utils.parseResponse(this);
            // error
            if ( this.status !== 200 ) {
                // if error callback is provided, call it
                if ( options.error && typeof options.error === 'function' )
                {
                    options.error(resp);
                }
                // reject promise
                return reject(resp);
            }
            // success
            else {
                let res = resp;
                let result;
                let token = res.token;
                // if only a single item was passed, return a single object
                if ( items.length == 1 ) {
                    result = { ...(res.signatures[0]) };
                }
                // if multiple items were passed, return an array of objects
                else {
                    let obj = [];
                    for ( let i = 0; i < res.signatures.length; i++ ) {
                        obj.push({ ...res.signatures[i] });
                    }
                    result = obj;
                }

                // if success callback is provided, call it
                if ( options.success && typeof options.success === 'function' )
                {
                    options.success({ token: token, items: result });
                }
                // resolve with success
                return resolve({ token: token, items: result });
            }
        });

        xhr.upload.addEventListener('progress', function (e) {
        });

        // error
        xhr.addEventListener('error', function (e) {
            return utils.handle_error(options.error, reject, this);
        });

        xhr.send(JSON.stringify({
            app_uid: options.app_uid,
            items: items,
        }));
    });
};

export default sign;