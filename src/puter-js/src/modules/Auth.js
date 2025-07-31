import * as utils from '../lib/utils.js'

class Auth{
    // Used to generate a unique message id for each message sent to the host environment
    // we start from 1 because 0 is falsy and we want to avoid that for the message id
    #messageID = 1;


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
     * @memberof [Auth]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     * 
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Auth]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }
    
    signIn = (options) =>{
        options = options || {};

        return new Promise((resolve, reject) => {
            let msg_id = this.#messageID++;
            let w = 600;
            let h = 600;
            let title = 'Puter';
            var left = (screen.width/2)-(w/2);
            var top = (screen.height/2)-(h/2);
            
            // Store reference to the popup window
            const popup = window.open(puter.defaultGUIOrigin + '/action/sign-in?embedded_in_popup=true&msg_id=' + msg_id + (window.crossOriginIsolated ? '&cross_origin_isolated=true' : '') +(options.attempt_temp_user_creation ? '&attempt_temp_user_creation=true' : ''), 
            title, 
            'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left);

            // Set up interval to check if popup was closed
            const checkClosed = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkClosed);
                    // Remove the message listener
                    window.removeEventListener('message', messageHandler);
                    reject({ error: 'auth_window_closed', msg: 'Authentication window was closed by the user without completing the process.' });
                }
            }, 100);

            function messageHandler(e) {
                if(e.data.msg_id == msg_id){
                    // Clear the interval since we got a response
                    clearInterval(checkClosed);
                    
                    // remove redundant attributes
                    delete e.data.msg_id;
                    delete e.data.msg;

                    if(e.data.success){
                        // set the auth token
                        puter.setAuthToken(e.data.token);

                        resolve(e.data);
                    }else
                        reject(e.data);

                    // delete the listener
                    window.removeEventListener('message', messageHandler);
                }
            }

            window.addEventListener('message', messageHandler);
        });
    }

    isSignedIn = () =>{
        if(puter.authToken)
            return true;
        else
            return false;
    }

    getUser = function(...args){
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

        return new Promise((resolve, reject) => {
            const xhr = utils.initXhr('/whoami', puter.APIOrigin, puter.authToken, 'get');

            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

            xhr.send();
        })
    }

    signOut = () =>{
        puter.resetAuthToken();
    }

    async whoami () {
        const resp = await fetch(this.APIOrigin + '/whoami', {
            headers: {
                Authorization: `Bearer ${this.authToken}`
            }
        });
        return await resp.json();
    }
}

export default Auth