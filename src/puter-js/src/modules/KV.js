import * as utils from '../lib/utils.js'

class KV{
    MAX_KEY_SIZE = 1024;
    MAX_VALUE_SIZE = 400 * 1024;

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
     * @memberof [KV]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     * 
     * @param {string} APIOrigin - The new API origin.
     * @memberof [KV]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    /**
     * Resolves to 'true' on success, or rejects with an error on failure
     * 
     * `key` cannot be undefined or null.
     * `key` size cannot be larger than 1mb.
     * `value` size cannot be larger than 10mb.
     */
    set = utils.make_driver_method(['key', 'value'], 'puter-kvstore', 'set',{
        preprocess: (args)=>{
            // key cannot be undefined or null
            if(args.key === undefined || args.key === null){
                throw { message: 'Key cannot be undefined', code: 'key_undefined'};
            }
            // key size cannot be larger than MAX_KEY_SIZE
            if(args.key.length > this.MAX_KEY_SIZE){
                throw {message: 'Key size cannot be larger than ' + this.MAX_KEY_SIZE, code: 'key_too_large'};
            }
            // value size cannot be larger than MAX_VALUE_SIZE
            if(args.value && args.value.length > this.MAX_VALUE_SIZE){
                throw {message: 'Value size cannot be larger than ' + this.MAX_VALUE_SIZE, code: 'value_too_large'};
            }
            return args;
        }
    })

    /**
     * Resolves to the value if the key exists, or `undefined` if the key does not exist. Rejects with an error on failure.
     */
    get = utils.make_driver_method(['key'], 'puter-kvstore', 'get', {
        preprocess: (args)=>{
            // key size cannot be larger than MAX_KEY_SIZE
            if(args.key.length > this.MAX_KEY_SIZE){
                throw ({message: 'Key size cannot be larger than ' + this.MAX_KEY_SIZE, code: 'key_too_large'});
            }

            return args;
        },
        transform: (res)=>{
            return res;
        }
    })

    incr = async(...args) => {
        let options = {};

        // arguments are required
        if(!args || args.length === 0){
            throw ({message: 'Arguments are required', code: 'arguments_required'});
        }

        options.key = args[0];
        options.amount = args[1] ?? 1;

        // key size cannot be larger than MAX_KEY_SIZE
        if(options.key.length > this.MAX_KEY_SIZE){
            throw ({message: 'Key size cannot be larger than ' + this.MAX_KEY_SIZE, code: 'key_too_large'});
        }

        return utils.make_driver_method(['key'], 'puter-kvstore', 'incr').call(this, options);
    }

    decr = async(...args) => {
        let options = {};

        // arguments are required
        if(!args || args.length === 0){
            throw ({message: 'Arguments are required', code: 'arguments_required'});
        }

        options.key = args[0];
        options.amount = args[1] ?? 1;

        // key size cannot be larger than MAX_KEY_SIZE
        if(options.key.length > this.MAX_KEY_SIZE){
            throw ({message: 'Key size cannot be larger than ' + this.MAX_KEY_SIZE, code: 'key_too_large'});
        }

        return utils.make_driver_method(['key'], 'puter-kvstore', 'decr').call(this, options);
    }

    // resolves to 'true' on success, or rejects with an error on failure
    // will still resolve to 'true' if the key does not exist
    del = utils.make_driver_method(['key'], 'puter-kvstore', 'del', {
        preprocess: (args)=>{
            // key size cannot be larger than this.MAX_KEY_SIZE
            if(args.key.length > this.MAX_KEY_SIZE){
                throw ({message: 'Key size cannot be larger than ' + this.MAX_KEY_SIZE, code: 'key_too_large'});
            }

            return args;
        }
    });

    list = async(...args) => {
        let options = {};
        let pattern;
        let returnValues = false;

        // list(true) or list(pattern, true) will return the key-value pairs
        if((args && args.length === 1 && args[0] === true) || (args && args.length === 2 && args[1] === true)){
            options = {};
            returnValues = true;
        }
        // return only the keys, default behavior
        else{
            options = { as: 'keys'};
        }

        // list(pattern)
        // list(pattern, true)
        if((args && args.length === 1 && typeof args[0] === 'string') || (args && args.length === 2 && typeof args[0] === 'string' && args[1] === true)){
            pattern = args[0];
        }

        return utils.make_driver_method([], 'puter-kvstore', 'list', {
            transform: (res)=>{
                // glob pattern was provided
                if(pattern){
                    // consider both the key and the value 
                    if(!returnValues) {                  
                        let keys = res.filter((key)=>{
                            return globMatch(pattern, key);
                        });
                        return keys;
                    }else{
                        let keys = res.filter((key_value_pair)=>{
                            return globMatch(pattern, key_value_pair.key);
                        });
                        return keys;
                    }
                }

                return res;
            }
        }).call(this, options);
    }

    // resolve to 'true' on success, or rejects with an error on failure
    // will still resolve to 'true' if there are no keys
    flush = utils.make_driver_method([], 'puter-kvstore', 'flush')

    // clear is an alias for flush
    clear = this.flush;
}


function globMatch(pattern, str) {
    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let regexPattern = escapeRegExp(pattern)
        .replace(/\\\*/g, '.*') // Replace * with .*
        .replace(/\\\?/g, '.') // Replace ? with .
        .replace(/\\\[/g, '[') // Replace [ with [
        .replace(/\\\]/g, ']') // Replace ] with ]
        .replace(/\\\^/g, '^'); // Replace ^ with ^

    let re = new RegExp('^' + regexPattern + '$');
    return re.test(str);
}



export default KV