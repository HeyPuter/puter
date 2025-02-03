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
    constructor (context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
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

        let opt_i = 0;
        if(typeof args[0] === 'object'){
            options = args[0];
            opt_i = 1;
        }else{
            options = {
                to: args[0],
                subject: args[1],
                body: args[2]
            }
            opt_i = 3;
        }

        for ( const opt of args.slice(opt_i) ) {
            if ( typeof opt === 'object' ) {
                Object.assign(options, opt);
            }
        }

        return utils.make_driver_method(['to', 'subject', 'body'], 'puter-send-mail', undefined, 'send').call(this, options);
    }
}

export default Email