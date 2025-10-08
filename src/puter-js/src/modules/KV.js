import { TeePromise } from '@heyputer/putility/src/libs/promise.js';
import * as utils from '../lib/utils.js';

const gui_cache_keys = [
    'has_set_default_app_user_permissions',
    'window_sidebar_width',
    'sidebar_items',
    'menubar_style',
    'user_preferences.auto_arrange_desktop',
    'user_preferences.show_hidden_files',
    'user_preferences.language',
    'user_preferences.clock_visible',
    'toolbar_auto_hide_enabled',
    'has_seen_welcome_window',
    'desktop_item_positions',
    'desktop_icons_hidden',
    'taskbar_position',
    'has_seen_toolbar_animation',
];
class KV{
    MAX_KEY_SIZE = 1024;
    MAX_VALUE_SIZE = 399 * 1024;

    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor(context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;

        this.gui_cached = new TeePromise();
        this.gui_cache_init = new TeePromise();
        (async () => {
            await this.gui_cache_init;
            this.gui_cache_init = null;
            const resp = await fetch(`${this.APIOrigin}/drivers/call`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;actually=json',
                },
                body: JSON.stringify({
                    interface: 'puter-kvstore',
                    method: 'get',
                    args: {
                        key: gui_cache_keys,
                    },
                    auth_token: this.authToken,
                }),
            });
            const arr_values = await resp.json();
            if ( ! Array.isArray(arr_values?.result) ) {
                this.gui_cached.resolve({});
                setTimeout(() => {
                    this.gui_cached = null;
                }, 4000);
                return;
            }
            const obj = {};
            for ( let i = 0; i < gui_cache_keys.length; i++ ) {
                obj[gui_cache_keys[i]] = arr_values.result[i];
            }
            this.gui_cached.resolve(obj);
            setTimeout(() => {
                this.gui_cached = null;
            }, 4000);
        })();
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [KV]
     * @returns {void}
     */
    setAuthToken(authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     *
     * @param {string} APIOrigin - The new API origin.
     * @memberof [KV]
     * @returns {void}
     */
    setAPIOrigin(APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    /**
     * @typedef {function(key: string, value: any, expireAt?: number): Promise<boolean>} SetFunction
     * Resolves to 'true' on success, or rejects with an error on failure.
     * @param {string} key - Cannot be undefined or null. Cannot be larger than 1KB.
     * @param {any} value - Cannot be larger than 399KB.
     * @param {number} [expireAt] - Optional expiration time for the key. Note that clients with a clock that is not in sync with the server may experience issues with this method.
     * @memberof KV
     */

    /** @type {SetFunction} */
    set = utils.make_driver_method(['key', 'value', 'expireAt'], 'puter-kvstore', undefined, 'set', {
        /**
         *
         * @param {object} args
         * @param {string} args.key
         * @param {any} args.value
         * @param {number} [args.expireAt]
         * @memberof [KV]
         * @returns
         */
        preprocess: (args) => {
            // key cannot be undefined or null
            if ( args.key === undefined || args.key === null ){
                throw { message: 'Key cannot be undefined', code: 'key_undefined' };
            }
            // key size cannot be larger than MAX_KEY_SIZE
            if ( args.key.length > this.MAX_KEY_SIZE ){
                throw { message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' };
            }
            // value size cannot be larger than MAX_VALUE_SIZE
            if ( args.value && args.value.length > this.MAX_VALUE_SIZE ){
                throw { message: `Value size cannot be larger than ${this.MAX_VALUE_SIZE}`, code: 'value_too_large' };
            }
            return args;
        },
    });

    /**
     * Resolves to the value if the key exists, or `undefined` if the key does not exist. Rejects with an error on failure.
     */
    async get(...args) {
        // Condition for gui boot cache
        if (
            typeof args[0] === 'string' &&
            gui_cache_keys.includes(args[0]) &&
            this.gui_cached !== null
        ) {
            this.gui_cache_init && this.gui_cache_init.resolve();
            const cache = await this.gui_cached;
            return cache[args[0]];
        }

        // Normal get
        return await this.get_(...args);
    }

    get_ = utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'get', {
        preprocess: (args) => {
            // key size cannot be larger than MAX_KEY_SIZE
            if ( args.key.length > this.MAX_KEY_SIZE ){
                throw ({ message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' });
            }

            return args;
        },
        transform: (res) => {
            return res;
        },
    });

    incr = async (...args) => {
        let options = {};

        // arguments are required
        if ( !args || args.length === 0 ){
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        options.key = args[0];
        options.pathAndAmountMap = !args[1] ?  { '': 1 } : typeof args[1] === 'number' ? { '': args[1] } : args[1];

        // key size cannot be larger than MAX_KEY_SIZE
        if ( options.key.length > this.MAX_KEY_SIZE ){
            throw ({ message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' });
        }

        return utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'incr').call(this, options);
    };

    decr = async (...args) => {
        let options = {};

        // arguments are required
        if ( !args || args.length === 0 ){
            throw ({ message: 'Arguments are required', code: 'arguments_required' });
        }

        options.key = args[0];
        options.pathAndAmountMap = !args[1] ?  { '': 1 } : typeof args[1] === 'number' ? { '': args[1] } : args[1];

        // key size cannot be larger than MAX_KEY_SIZE
        if ( options.key.length > this.MAX_KEY_SIZE ){
            throw ({ message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' });
        }

        return utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'decr').call(this, options);
    };

    /**
     * Set a time to live (in seconds) on a key. After the time to live has expired, the key will be deleted.
     * Prefer this over expireAt if you want timestamp to be set by the server, to avoid issues with clock drift.
     * @param  {string} key - The key to set the expiration on.
     * @param  {number} ttl - The ttl
     * @memberof [KV]
     * @returns
     */
    expire = async (key, ttl) => {
        let options = {};
        options.key = key;
        options.ttl = ttl;

        // key size cannot be larger than MAX_KEY_SIZE
        if ( options.key.length > this.MAX_KEY_SIZE ){
            throw ({ message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' });
        }

        return utils.make_driver_method(['key', 'ttl'], 'puter-kvstore', undefined, 'expire').call(this, options);
    };

    /**
     *
     * Set the expiration for a key as a UNIX timestamp (in seconds). After the time has passed, the key will be deleted.
     * Note that clients with a clock that is not in sync with the server may experience issues with this method.
     * @param  {string} key - The key to set the expiration on.
     * @param  {number} timestamp - The timestamp (in seconds since epoch) when the key will expire.
     * @memberof [KV]
     * @returns
     */
    expireAt = async (key, timestamp) => {
        let options = {};
        options.key = key;
        options.timestamp = timestamp;
        // key size cannot be larger than MAX_KEY_SIZE
        if ( options.key.length > this.MAX_KEY_SIZE ){
            throw ({ message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' });
        }

        return utils.make_driver_method(['key', 'timestamp'], 'puter-kvstore', undefined, 'expireAt').call(this, options);
    };

    // resolves to 'true' on success, or rejects with an error on failure
    // will still resolve to 'true' if the key does not exist
    del = utils.make_driver_method(['key'], 'puter-kvstore', undefined, 'del', {
        preprocess: (args) => {
            // key size cannot be larger than this.MAX_KEY_SIZE
            if ( args.key.length > this.MAX_KEY_SIZE ){
                throw ({ message: `Key size cannot be larger than ${this.MAX_KEY_SIZE}`, code: 'key_too_large' });
            }

            return args;
        },
    });

    list = async (...args) => {
        let options = {};
        let pattern;
        let returnValues = false;

        // list(true) or list(pattern, true) will return the key-value pairs
        if ( (args && args.length === 1 && args[0] === true) || (args && args.length === 2 && args[1] === true) ){
            options = {};
            returnValues = true;
        }
        // return only the keys, default behavior
        else {
            options = { as: 'keys' };
        }

        // list(pattern)
        // list(pattern, true)
        if ( (args && args.length === 1 && typeof args[0] === 'string') || (args && args.length === 2 && typeof args[0] === 'string' && args[1] === true) ){
            pattern = args[0];
        }

        return utils.make_driver_method([], 'puter-kvstore', undefined, 'list', {
            transform: (res) => {
                // glob pattern was provided
                if ( pattern ){
                    // consider both the key and the value
                    if ( !returnValues ) {
                        let keys = res.filter((key) => {
                            return globMatch(pattern, key);
                        });
                        return keys;
                    } else {
                        let keys = res.filter((key_value_pair) => {
                            return globMatch(pattern, key_value_pair.key);
                        });
                        return keys;
                    }
                }

                return res;
            },
        }).call(this, options);
    };

    // resolve to 'true' on success, or rejects with an error on failure
    // will still resolve to 'true' if there are no keys
    flush = utils.make_driver_method([], 'puter-kvstore', undefined, 'flush');

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

    let re = new RegExp(`^${regexPattern}$`);
    return re.test(str);
}

export default KV;