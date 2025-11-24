import * as utils from '../lib/utils.js';
import getAbsolutePathForApp from './FileSystem/utils/getAbsolutePathForApp.js';

class Hosting {
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
     * @memberof [Router]
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

    // todo document the `Subdomain` object.
    list = async (...args) => {
        return (await utils.make_driver_method([], 'puter-subdomains', undefined, 'select')(...args)).filter(e => !e.subdomain.startsWith('workers.puter.'));
    };

    create = async (...args) => {
        let options = {};
        // * allows for: puter.hosting.new('example-subdomain') *
        if ( typeof args[0] === 'string' && args.length === 1 ) {
            // if subdomain is in the format of a `subdomain.puter.site` or `subdomain.puter.com`, extract the subdomain
            // and use it as the subdomain. This is to make development easier.
            if ( args[0].match(/^[a-z0-9]+\.puter\.(site|com)$/) ) {
                args[0] = args[0].split('.')[0];
            }

            options = { object: { subdomain: args[0] } };
        }
        // if there are two string arguments, assume they are the subdomain and the target directory
        // * allows for: puter.hosting.new('example-subdomain', '/path/to/target') *
        else if ( Array.isArray(args) && args.length === 2 && typeof args[0] === 'string' ) {
            // if subdomain is in the format of a `subdomain.puter.site` or `subdomain.puter.com`, extract the subdomain
            // and use it as the subdomain. This is to make development easier.
            if ( args[0].match(/^[a-z0-9]+\.puter\.(site|com)$/) ) {
                args[0] = args[0].split('.')[0];
            }

            // if the target directory is not an absolute path, make it an absolute path relative to the app's root directory
            if ( args[1] ) {
                args[1] = getAbsolutePathForApp(args[1]);
            }

            options = { object: { subdomain: args[0], root_dir: args[1] } };
        }
        // allows for: puter.hosting.new({ subdomain: 'subdomain' })
        else if ( typeof args[0] === 'object' ) {
            options = { object: args[0] };
        }
        // Call the original chat.complete method
        return await utils.make_driver_method(['object'], 'puter-subdomains', undefined, 'create').call(this, options);
    };

    update = async (...args) => {
        let options = {};
        // If there are two string arguments, assume they are the subdomain and the target directory
        // * allows for: puter.hosting.update('example-subdomain', '/path/to/target') *
        if ( Array.isArray(args) && typeof args[0] === 'string' ) {
            // if subdomain is in the format of a `subdomain.puter.site` or `subdomain.puter.com`, extract the subdomain
            // and use it as the subdomain. This is to make development easier.
            if ( args[0].match(/^[a-z0-9]+\.puter\.(site|com)$/) ) {
                args[0] = args[0].split('.')[0];
            }

            // if the target directory is not an absolute path, make it an absolute path relative to the app's root directory
            if ( args[1] ) {
                args[1] = getAbsolutePathForApp(args[1]);
            }

            options = { id: { subdomain: args[0] }, object: { root_dir: args[1] ?? null } };
        }

        // Call the original chat.complete method
        return await utils.make_driver_method(['object'], 'puter-subdomains', undefined, 'update').call(this, options);
    };

    get = async (...args) => {
        let options = {};
        // if there is one string argument, assume it is the subdomain
        // * allows for: puter.hosting.get('example-subdomain') *
        if ( Array.isArray(args) && typeof args[0] === 'string' ) {
            // if subdomain is in the format of a `subdomain.puter.site` or `subdomain.puter.com`, extract the subdomain
            // and use it as the subdomain. This is to make development easier.
            if ( args[0].match(/^[a-z0-9]+\.puter\.(site|com)$/) ) {
                args[0] = args[0].split('.')[0];
            }

            options = { id: { subdomain: args[0] } };
        }
        return utils.make_driver_method(['uid'], 'puter-subdomains', undefined, 'read').call(this, options);
    };

    delete = async (...args) => {
        let options = {};
        // if there is one string argument, assume it is the subdomain
        // * allows for: puter.hosting.get('example-subdomain') *
        if ( Array.isArray(args) && typeof args[0] === 'string' ) {
            // if subdomain is in the format of a `subdomain.puter.site` or `subdomain.puter.com`, extract the subdomain
            // and use it as the subdomain. This is to make development easier.
            if ( args[0].match(/^[a-z0-9]+\.puter\.(site|com)$/) ) {
                args[0] = args[0].split('.')[0];
            }

            options = { id: { subdomain: args[0] } };
        }
        return utils.make_driver_method(['uid'], 'puter-subdomains', undefined, 'delete').call(this, options);
    };
}

export default Hosting;
