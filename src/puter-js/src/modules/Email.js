import * as utils from '../lib/utils.js'

class Email{
    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (authToken, APIOrigin, appID) {
        this.authToken = authToken;
        this.APIOrigin = APIOrigin;
        this.appID = appID;
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [Email]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     * 
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Email]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    send = async(...args) => {
        let options = {};

        // arguments are required
        if(!args || args.length === 0){
            throw ({message: 'Arguments are required', code: 'arguments_required'});
        }

        if(typeof args[0] === 'object'){
            options = args[0];
        }else{
            options = {
                to: args[0],
                subject: args[1],
                html: args[2]
            }
        }

        return utils.make_driver_method(['to', 'subject', 'html'], 'temp-email', 'send').call(this, options);
    }
}

export default Email