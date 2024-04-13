import * as utils from '../lib/utils.js'

class Apps{
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
     * @memberof [Apps]
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

    list = async (...args) => {
        let options = {};

        options = { "predicate": ['user-can-edit'] };
        
        return utils.make_driver_method(['uid'], 'puter-apps', 'select').call(this, options);
    }

    create = async (...args) => {
        let options = {};
        // * allows for: puter.apps.new('example-app') *
        if (typeof args[0] === 'string') {
            let indexURL = args[1];
            let title = args[2] ?? args[0];

            options = { object: { name: args[0], index_url: indexURL, title: title}};
        }else if (typeof args[0] === 'object' && args[0] !== null) {
            let options_raw = args[0];
            options = { 
                object: { 
                    name: options_raw.name, 
                    index_url: options_raw.indexURL, 
                    title: options_raw.title,
                    description: options_raw.description,
                    icon: options_raw.icon,
                    maximize_on_start: options_raw.maximizeOnStart,
                    background: options_raw.background,
                    filetype_associations: options_raw.filetypeAssociations,
                }
            };
        }
        // Call the original chat.complete method
        return await utils.make_driver_method(['object'], 'puter-apps', 'create').call(this, options);
    }

    update = async(...args) => {
        let options = {};

        // if there is one string argument, assume it is the app name
        // * allows for: puter.apps.update('example-app') *
        if (Array.isArray(args) && typeof args[0] === 'string') {
            let object_raw = args[1];
            let object = { 
                name: object_raw.name, 
                index_url: object_raw.indexURL, 
                title: object_raw.title,
                description: object_raw.description,
                icon: object_raw.icon,
                maximize_on_start: object_raw.maximizeOnStart,
                background: object_raw.background,
                filetype_associations: object_raw.filetypeAssociations,
            };

            options = { id: { name: args[0]}, object: object};
        }

        // Call the original chat.complete method
        return await utils.make_driver_method(['object'], 'puter-apps', 'update').call(this, options);
    }

    get = async(...args) => {
        let options = {};
        // if there is one string argument, assume it is the app name
        // * allows for: puter.apps.get('example-app') *
        if (Array.isArray(args) && typeof args[0] === 'string') {
            options = { id: {name: args[0]}};
        }
        return utils.make_driver_method(['uid'], 'puter-apps', 'read').call(this, options);
    }

    delete = async(...args) => {
        let options = {};
        // if there is one string argument, assume it is the app name
        // * allows for: puter.apps.get('example-app') *
        if (Array.isArray(args) && typeof args[0] === 'string') {
            options = { id: {name: args[0]}};
        }
        return utils.make_driver_method(['uid'], 'puter-apps', 'delete').call(this, options);
    }

    getDeveloperProfile = function(...args){
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
                const xhr = utils.initXhr('/get-dev-profile', puter.APIOrigin, puter.authToken, 'get');
    
                // set up event handlers for load and error events
                utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);
    
                xhr.send();
            })
        });
    }
}

export default Apps;