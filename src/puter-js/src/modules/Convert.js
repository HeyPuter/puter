import * as utils from '../lib/utils.js';

class Convert {
    constructor(context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID; //  Might not be strictly necessary for this module, but good for consistency
    }

    setAuthToken(authToken) {
        this.authToken = authToken;
    }

    setAPIOrigin(APIOrigin) {
        this.APIOrigin = APIOrigin;
    }


    convert = async (...args) => {
        let options = {};

        // if args is a single object, assume it is the options object
        if (typeof args[0] === 'object' && args[0] !== null) {
            options = args[0];
        } else {
            // Otherwise, we assume separate arguments are provided
            options = {
                source: args[0],
                to: args[1],
                success: args[2],
                error: args[3],
            };
        }

        return utils.make_driver_method(['source', 'to'], 'convert-files', undefined, 'convert').call(this, options);
    }
}

export default Convert;