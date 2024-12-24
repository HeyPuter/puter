import * as utils from '../lib/utils.js'

class OS{
    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [OS]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     * 
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Apps]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    user = function(...args){
        let options;

        // If first argument is an object, it's the options
        if (typeof args[0] === 'object' && args[0] !== null) {
            options = args[0];
        } else {
            // Otherwise, we assume separate arguments are provided
            options = {
                success: args[0],
                error: args[1],
            };
        }

        let query = '';
        if(options?.query){
            query = '?' + new URLSearchParams(options.query).toString();
        }

        return new Promise((resolve, reject) => {
            const xhr = utils.initXhr('/whoami' + query, this.APIOrigin, this.authToken, 'get');

            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

            xhr.send();
        })
    }

    version = function(...args){
        let options;

        // If first argument is an object, it's the options
        if (typeof args[0] === 'object' && args[0] !== null) {
            options = args[0];
        } else {
            // Otherwise, we assume separate arguments are provided
            options = {
                success: args[0],
                error: args[1],
                // Add more if needed...
            };
        }

        return new Promise((resolve, reject) => {
            const xhr = utils.initXhr('/version', this.APIOrigin, this.authToken, 'get');

            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

            xhr.send();
        })
    }
}

export default OS