import putility from '@heyputer/putility';

import kvjs from '@heyputer/kv.js';
import APICallLogger from './lib/APICallLogger.js';
import path from './lib/path.js';
import localStorageMemory from './lib/polyfills/localStorage.js';
import xhrshim from './lib/polyfills/xhrshim.js';
import * as utils from './lib/utils.js';
import AI from './modules/AI.js';
import Apps from './modules/Apps.js';
import Auth from './modules/Auth.js';
import { Debug } from './modules/Debug.js';
import Drivers from './modules/Drivers.js';
import { PuterJSFileSystemModule } from './modules/FileSystem/index.js';
import FSItem from './modules/FSItem.js';
import Hosting from './modules/Hosting.js';
import KV from './modules/KV.js';
import { PSocket } from './modules/networking/PSocket.js';
import { PTLSSocket } from './modules/networking/PTLS.js';
import { pFetch } from './modules/networking/requests.js';
import OS from './modules/OS.js';
import Perms from './modules/Perms.js';
import Threads from './modules/Threads.js';
import UI from './modules/UI.js';
import Util from './modules/Util.js';
import { WorkersHandler } from './modules/Workers.js';
import { APIAccessService } from './services/APIAccess.js';
import { FilesystemService } from './services/Filesystem.js';
import { FSRelayService } from './services/FSRelay.js';
import { NoPuterYetService } from './services/NoPuterYet.js';
import { XDIncomingService } from './services/XDIncoming.js';

// TODO: This is for a safe-guard below; we should check if we can
//       generalize this behavior rather than hard-coding it.
//       (using defaultGUIOrigin breaks locally-hosted apps)
const PROD_ORIGIN = 'https://puter.com';

const puterInit = (function() {
    'use strict';

    class Puter{
        // The environment that the SDK is running in. Can be 'gui', 'app' or 'web'.
        // 'gui' means the SDK is running in the Puter GUI, i.e. Puter.com.
        // 'app' means the SDK is running as a Puter app, i.e. within an iframe in the Puter GUI.
        // 'web' means the SDK is running in a 3rd-party website.
        env;

        #defaultAPIOrigin = 'https://api.puter.com';
        #defaultGUIOrigin = 'https://puter.com';

        get defaultAPIOrigin() {
            return globalThis.PUTER_API_ORIGIN || globalThis.PUTER_API_ORIGIN_ENV || this.#defaultAPIOrigin;
        }
        set defaultAPIOrigin(v) {
            this.#defaultAPIOrigin = v;
        }

        get defaultGUIOrigin() {
            return globalThis.PUTER_ORIGIN || globalThis.PUTER_ORIGIN_ENV || this.#defaultGUIOrigin;
        }
        set defaultGUIOrigin(v) {
            this.#defaultGUIOrigin = v;
        }

        // An optional callback when the user is authenticated. This can be set by the app using the SDK.
        onAuth;

        /**
         * State object to keep track of the authentication request status.
         * This is used to prevent multiple authentication popups from showing up by different parts of the app.
         */
        puterAuthState = {
            isPromptOpen: false,
            authGranted: null,
            resolver: null,
        };

        // Holds the unique app instance ID that is provided by the host environment
        appInstanceID;

        // Holds the unique app instance ID for the parent (if any), which is provided by the host environment
        parentInstanceID;

        // Expose the FSItem class
        static FSItem = FSItem;

        // Event handling properties
        eventHandlers = {};

        // debug flag
        debugMode = false;

        /**
         * Puter.js Modules
         *
         * These are the modules you see on docs.puter.com; for example:
         * - puter.fs
         * - puter.kv
         * - puter.ui
         *
         * initSubmodules is called from the constructor of this class.
         */
        initSubmodules = function(){
            // Util
            this.util = new Util();

            this.registerModule('auth', Auth);
            this.registerModule('os', OS);
            this.registerModule('fs', PuterJSFileSystemModule);
            this.registerModule('ui', UI, {
                appInstanceID: this.appInstanceID,
                parentInstanceID: this.parentInstanceID,
            });
            this.registerModule('hosting', Hosting);
            this.registerModule('apps', Apps);
            this.registerModule('ai', AI);
            this.registerModule('kv', KV);
            this.registerModule('threads', Threads);
            this.registerModule('perms', Perms);
            this.registerModule('drivers', Drivers);
            this.registerModule('debug', Debug);

            // Path
            this.path = path;
        };

        // --------------------------------------------
        // Constructor
        // --------------------------------------------
        constructor() {

            // Initialize the cache using kv.js
            this._cache = new kvjs({dbName: 'puter_cache'});
            this._opscache = new kvjs();

            // "modules" in puter.js are external interfaces for the developer
            this.modules_ = [];
            // "services" in puter.js are used by modules and may interact with each other
            const context = new putility.libs.context.Context()
                .follow(this, ['env', 'util', 'authToken', 'APIOrigin', 'appID']);

            context.puter = this;

            this.services = new putility.system.ServiceManager({ context });
            this.context = context;
            context.services = this.services;

            // Holds the query parameters found in the current URL
            let URLParams = new URLSearchParams(globalThis.location?.search);

            // Figure out the environment in which the SDK is running
            if ( URLParams.has('puter.app_instance_id') ) {
                this.env = 'app';
            } else if ( globalThis.puter_gui_enabled === true )
            {
                this.env = 'gui';
            }
            else if ( globalThis.WorkerGlobalScope ) {
                if ( globalThis.ServiceWorkerGlobalScope ) {
                    this.env = 'service-worker';
                    if ( !globalThis.XMLHttpRequest ) {
                        globalThis.XMLHttpRequest = xhrshim;
                    }
                    if ( !globalThis.location ) {
                        globalThis.location = new URL('https://puter.site/');
                    }
                    // XHRShimGlobalize here
                } else {
                    this.env = 'web-worker';
                }
                if ( !globalThis.localStorage ) {
                    globalThis.localStorage = localStorageMemory;
                }
            } else if ( globalThis.process ) {
                this.env = 'nodejs';
                if ( !globalThis.localStorage ) {
                    globalThis.localStorage = localStorageMemory;
                }
                if ( !globalThis.XMLHttpRequest ) {
                    globalThis.XMLHttpRequest = xhrshim;
                }
                if ( !globalThis.location ) {
                    globalThis.location = new URL('https://nodejs.puter.site/');
                }
                if ( !globalThis.addEventListener ) {
                    globalThis.addEventListener = () => {
                    }; // API Stub
                }
            } else {
                this.env = 'web';
            }

            // There are some specific situations where puter is definitely loaded in GUI mode
            // we're going to check for those situations here so that we don't break anything unintentionally
            // if navigator URL's hostname is 'puter.com'
            if ( this.env !== 'gui' ){
                // Retrieve the hostname from the URL: Remove the trailing dot if it exists. This is to handle the case where the URL is, for example, `https://puter.com.` (note the trailing dot).
                // This is necessary because the trailing dot can cause the hostname to not match the expected value.
                let hostname = location.hostname.replace(/\.$/, '');

                // Create a new URL object with the URL string
                const url = new URL(PROD_ORIGIN);

                // Extract hostname from the URL object
                const gui_hostname = url.hostname;

                // If the hostname matches the GUI hostname, then the SDK is running in the GUI environment
                if ( hostname === gui_hostname ){
                    this.env = 'gui';
                }
            }

            // Get the 'args' from the URL. This is used to pass arguments to the app.
            if ( URLParams.has('puter.args') ){
                this.args = JSON.parse(decodeURIComponent(URLParams.get('puter.args')));
            } else {
                this.args = {};
            }

            // Try to extract appInstanceID from the URL. appInstanceID is included in every messaage
            // sent to the host environment. This is used to help host environment identify the app
            // instance that sent the message and communicate back to it.
            if ( URLParams.has('puter.app_instance_id') ){
                this.appInstanceID = decodeURIComponent(URLParams.get('puter.app_instance_id'));
            }

            // Try to extract parentInstanceID from the URL. If another app launched this app instance, parentInstanceID
            // holds its instance ID, and is used to communicate with that parent app.
            if ( URLParams.has('puter.parent_instance_id') ){
                this.parentInstanceID = decodeURIComponent(URLParams.get('puter.parent_instance_id'));
            }

            // Try to extract `puter.app.id` from the URL. `puter.app.id` is the unique ID of the app.
            // App ID is useful for identifying the app when communicating with the Puter API, among other things.
            if ( URLParams.has('puter.app.id') ){
                this.appID = decodeURIComponent(URLParams.get('puter.app.id'));
            }

            // Extract app name (added later)
            if ( URLParams.has('puter.app.name') ){
                this.appName = decodeURIComponent(URLParams.get('puter.app.name'));
            }

            // Construct this App's AppData path based on the appID. AppData path is used to store files that are specific to this app.
            // The default AppData path is `~/AppData/<appID>`.
            if ( this.appID ){
                this.appDataPath = `~/AppData/${this.appID}`;
            }

            // Construct APIOrigin from the URL. APIOrigin is used to build the URLs for the Puter API endpoints.
            // The default APIOrigin is https://api.puter.com. However, if the URL contains a `puter.api_origin` query parameter,
            // then that value is used as the APIOrigin. If the URL contains a `puter.domain` query parameter, then the APIOrigin
            // is constructed as `https://api.<puter.domain>`.
            // This should only be done when the SDK is running in 'app' mode.
            this.APIOrigin = this.defaultAPIOrigin;
            if ( URLParams.has('puter.api_origin') && this.env === 'app' ){
                this.APIOrigin = decodeURIComponent(URLParams.get('puter.api_origin'));
            } else if ( URLParams.has('puter.domain') && this.env === 'app' ){
                this.APIOrigin = 'https://api.' + URLParams.get('puter.domain');
            }

            // === START :: Logger ===

            // logger will log to console
            let logger = new putility.libs.log.ConsoleLogger();

            // logs can be toggled based on categories
            logger = new putility.libs.log.CategorizedToggleLogger({ delegate: logger });
            const cat_logger = logger;

            // create facade for easy logging
            this.logger = new putility.libs.log.LoggerFacade({
                impl: logger,
                cat: cat_logger,
            });

            // Initialize API call logger
            this.apiCallLogger = new APICallLogger({
                enabled: false, // Disabled by default
            });

            // === START :: Services === //

            this.services.register('no-puter-yet', NoPuterYetService);
            this.services.register('filesystem', FilesystemService);
            this.services.register('api-access', APIAccessService);
            this.services.register('xd-incoming', XDIncomingService);
            if ( this.env !== 'app' ) {
                this.services.register('fs-relay', FSRelayService);
            }

            // When api-access is initialized, bind `.authToken` and
            // `.APIOrigin` as a 1-1 mapping with the `puter` global
            (async () => {
                await this.services.wait_for_init(['api-access']);
                const svc_apiAccess = this.services.get('api-access');

                svc_apiAccess.auth_token = this.authToken;
                svc_apiAccess.api_origin = this.APIOrigin;
                [
                    ['authToken', 'auth_token'],
                    ['APIOrigin', 'api_origin'],
                ].forEach(([k1, k2]) => {
                    Object.defineProperty(this, k1, {
                        get() {
                            return svc_apiAccess[k2];
                        },
                        set(v) {
                            svc_apiAccess[k2] = v;
                        },
                    });
                });
            })();

            // === Start :: Modules === //

            // The SDK is running in the Puter GUI (i.e. 'gui')
            if ( this.env === 'gui' ){
                this.authToken = window.auth_token;
                // initialize submodules
                this.initSubmodules();
            }
            // Loaded in an iframe in the Puter GUI (i.e. 'app')
            // When SDK is loaded in App mode the initiation process should start when the DOM is ready
            else if ( this.env === 'app' ) {
                this.authToken = decodeURIComponent(URLParams.get('puter.auth.token'));
                // initialize submodules
                this.initSubmodules();
                // If the authToken is already set in localStorage, then we don't need to show the dialog
                try {
                    if ( localStorage.getItem('puter.auth.token') ){
                        this.setAuthToken(localStorage.getItem('puter.auth.token'));
                    }
                    // if appID is already set in localStorage, then we don't need to show the dialog
                    if ( localStorage.getItem('puter.app.id') ){
                        this.setAppID(localStorage.getItem('puter.app.id'));
                    }
                } catch( error ) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            }
            // SDK was loaded in a 3rd-party website.
            // When SDK is loaded in GUI the initiation process should start when the DOM is ready. This is because
            // the SDK needs to show a dialog to the user to ask for permission to access their Puter account.
            else if ( this.env === 'web' ) {
                // initialize submodules
                this.initSubmodules();
                try {
                    // If the authToken is already set in localStorage, then we don't need to show the dialog
                    if ( localStorage.getItem('puter.auth.token') ){
                        this.setAuthToken(localStorage.getItem('puter.auth.token'));
                    }
                    // if appID is already set in localStorage, then we don't need to show the dialog
                    if ( localStorage.getItem('puter.app.id') ){
                        this.setAppID(localStorage.getItem('puter.app.id'));
                    }
                } catch( error ) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            } else if ( this.env === 'web-worker' || this.env === 'service-worker' || this.env === 'nodejs' ) {
                this.initSubmodules();
            }

            // Add prefix logger (needed to happen after modules are initialized)
            (async () => {
                await this.services.wait_for_init(['api-access']);
                const whoami = await this.auth.whoami();
                logger = new putility.libs.log.PrefixLogger({
                    delegate: logger,
                    prefix: '[' +
                        (whoami?.app_name ?? this.appInstanceID ?? 'HOST') +
                        '] ',
                });

                this.logger.impl = logger;
            })();

            // Lock to prevent multiple requests to `/rao`
            this.lock_rao_ = new putility.libs.promise.Lock();
            // Promise that resolves when it's okay to request `/rao`
            this.p_can_request_rao_ = new putility.libs.promise.TeePromise();
            // Flag that indicates if a request to `/rao` has been made
            this.rao_requested_ = false;

            // In case we're already auth'd, request `/rao`
            (async () => {
                await this.services.wait_for_init(['api-access']);
                this.p_can_request_rao_.resolve();
            })();

            this.net = {
                generateWispV1URL: async () => {
                    const { token: wispToken, server: wispServer } = (await (await fetch(this.APIOrigin + '/wisp/relay-token/create', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${this.authToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({}),
                    })).json());
                    return `${wispServer}/${wispToken}/`;
                },
                Socket: PSocket,
                tls: {
                    TLSSocket: PTLSSocket,
                },
                fetch: pFetch,
            };

            this.workers = new WorkersHandler(this.authToken);

            // Initialize network connectivity monitoring and cache purging
            this.initNetworkMonitoring();
        }

        /**
         * @internal
         * Makes a request to `/rao`. This method aquires a lock to prevent
         * multiple requests, and is effectively idempotent.
         */
        async request_rao_() {
            await this.p_can_request_rao_;

            if ( this.env === 'gui' ) {
                return;
            }

            // setAuthToken is called more than once when auth completes, which
            // causes multiple requests to /rao. This lock prevents that.
            await this.lock_rao_.acquire();
            if ( this.rao_requested_ ) {
                this.lock_rao_.release();
                return;
            }

            let had_error = false;
            try {
                const resp = await fetch(this.APIOrigin + '/rao', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.authToken}`,
                        Origin: location.origin, // This is ignored in the browser but needed for workers and nodejs
                    },
                });
                return await resp.json();
            } catch( e ) {
                had_error = true;
                console.error(e);
            } finally {
                this.lock_rao_.release();
            }
            if ( ! had_error ) {
                this.rao_requested_ = true;
            }
        }

        registerModule(name, cls, parameters = {}) {
            const instance = new cls(this.context, parameters);
            this.modules_.push(name);
            this[name] = instance;
            if ( instance._init ) instance._init({ puter: this });
        }

        updateSubmodules() {
            // Update submodules with new auth token and API origin
            for ( const name of this.modules_ ) {
                if ( ! this[name] ) continue;
                this[name]?.setAuthToken?.(this.authToken);
                this[name]?.setAPIOrigin?.(this.APIOrigin);
            }
        }

        setAppID = function(appID) {
            // save to localStorage
            try {
                localStorage.setItem('puter.app.id', appID);
            } catch( error ) {
                // Handle the error here
                console.error('Error accessing localStorage:', error);
            }
            this.appID = appID;
        };

        setAuthToken = function(authToken) {
            this.authToken = authToken;
            // If the SDK is running on a 3rd-party site or an app, then save the authToken in localStorage
            if ( this.env === 'web' || this.env === 'app' ){
                try {
                    localStorage.setItem('puter.auth.token', authToken);
                } catch( error ) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            }
            // initialize loop for updating caches for major directories
            if(this.env === 'gui'){
                // check and update gui fs cache regularly
                setInterval(puter.checkAndUpdateGUIFScache, 10000);
            }
            // reinitialize submodules
            this.updateSubmodules();

            // rao
            this.request_rao_();

            // perform whoami and cache results
            this.getUser().then((user) => {
                this.whoami = user;
            });
        };

        setAPIOrigin = function(APIOrigin) {
            this.APIOrigin = APIOrigin;
            // reinitialize submodules
            this.updateSubmodules();
        };

        resetAuthToken = function() {
            this.authToken = null;
            // If the SDK is running on a 3rd-party site or an app, then save the authToken in localStorage
            if ( this.env === 'web' || this.env === 'app' ){
                try {
                    localStorage.removeItem('puter.auth.token');
                } catch( error ) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            }
            // reinitialize submodules
            this.updateSubmodules();
        };

        exit = function(statusCode = 0) {
            if ( statusCode && (typeof statusCode !== 'number') ) {
                console.warn('puter.exit() requires status code to be a number. Treating it as 1');
                statusCode = 1;
            }

            globalThis.parent.postMessage({
                msg: 'exit',
                appInstanceID: this.appInstanceID,
                statusCode,
            }, '*');
        };

        /**
         * A function that generates a domain-safe name by combining a random adjective, a random noun, and a random number (between 0 and 9999).
         * The result is returned as a string with components separated by hyphens.
         * It is useful when you need to create unique identifiers that are also human-friendly.
         *
         * @param {string} [separateWith='-'] - The character to use to separate the components of the generated name.
         * @returns {string} A unique, hyphen-separated string comprising of an adjective, a noun, and a number.
         *
         */
        randName = function(separateWith = '-'){
            const first_adj = ['helpful', 'sensible', 'loyal', 'honest', 'clever', 'capable', 'calm', 'smart', 'genius', 'bright', 'charming', 'creative', 'diligent', 'elegant', 'fancy',
                'colorful', 'avid', 'active', 'gentle', 'happy', 'intelligent', 'jolly', 'kind', 'lively', 'merry', 'nice', 'optimistic', 'polite',
                'quiet', 'relaxed', 'silly', 'victorious', 'witty', 'young', 'zealous', 'strong', 'brave', 'agile', 'bold'];

            const nouns = ['street', 'roof', 'floor', 'tv', 'idea', 'morning', 'game', 'wheel', 'shoe', 'bag', 'clock', 'pencil', 'pen',
                'magnet', 'chair', 'table', 'house', 'dog', 'room', 'book', 'car', 'cat', 'tree',
                'flower', 'bird', 'fish', 'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'mountain',
                'river', 'lake', 'sea', 'ocean', 'island', 'bridge', 'road', 'train', 'plane', 'ship', 'bicycle',
                'horse', 'elephant', 'lion', 'tiger', 'bear', 'zebra', 'giraffe', 'monkey', 'snake', 'rabbit', 'duck',
                'goose', 'penguin', 'frog', 'crab', 'shrimp', 'whale', 'octopus', 'spider', 'ant', 'bee', 'butterfly', 'dragonfly',
                'ladybug', 'snail', 'camel', 'kangaroo', 'koala', 'panda', 'piglet', 'sheep', 'wolf', 'fox', 'deer', 'mouse', 'seal',
                'chicken', 'cow', 'dinosaur', 'puppy', 'kitten', 'circle', 'square', 'garden', 'otter', 'bunny', 'meerkat', 'harp'];

            // return a random combination of first_adj + noun + number (between 0 and 9999)
            // e.g. clever-idea-123
            return first_adj[Math.floor(Math.random() * first_adj.length)] + separateWith + nouns[Math.floor(Math.random() * nouns.length)] + separateWith + Math.floor(Math.random() * 10000);
        };

        getUser = function(...args){
            let options;

            // If first argument is an object, it's the options
            if ( typeof args[0] === 'object' && args[0] !== null ) {
                options = args[0];
            } else {
                // Otherwise, we assume separate arguments are provided
                options = {
                    success: args[0],
                    error: args[1],
                };
            }

            return new Promise((resolve, reject) => {
                const xhr = utils.initXhr('/whoami', this.APIOrigin, this.authToken, 'get');
                // set up event handlers for load and error events
                utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

                xhr.send();
            });
        };

        print = function(...args){
            // Check if the last argument is an options object with escapeHTML or code property
            let options = {};
            if ( args.length > 0 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null &&
                ('escapeHTML' in args[args.length - 1] || 'code' in args[args.length - 1]) ) {
                options = args.pop();
            }

            for ( let arg of args ){
                // Escape HTML if the option is set to true or if code option is true
                if ( (options.escapeHTML === true || options.code === true) && typeof arg === 'string' ) {
                    arg = arg.replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                }

                // Wrap in code/pre tags if code option is true
                if ( options.code === true ) {
                    arg = `<code><pre>${arg}</pre></code>`;
                }

                document.body.innerHTML += arg;
            }
        };

        /**
         * Configures API call logging settings
         * @param {Object} config - Configuration options for API call logging
         * @param {boolean} config.enabled - Enable/disable API call logging
          * @param {boolean} config.enabled - Enable/disable API call logging
         */
        configureAPILogging = function(config = {}){
            if ( this.apiCallLogger ) {
                this.apiCallLogger.updateConfig(config);
            }
            return this;
        };

        /**
         * Enables API call logging with optional configuration
         * @param {Object} config - Optional configuration to apply when enabling
         */
        enableAPILogging = function(config = {}) {
            if ( this.apiCallLogger ) {
                this.apiCallLogger.updateConfig({ ...config, enabled: true });
            }
            return this;
        };

        /**
         * Disables API call logging
         */
        disableAPILogging = function() {
            if ( this.apiCallLogger ) {
                this.apiCallLogger.disable();
            }
            return this;
        };

        /**
         * Initializes network connectivity monitoring to purge cache when connection is lost
         * @private
         */
        initNetworkMonitoring = function() {
            // Only initialize in environments that support navigator.onLine and window events
            if ( typeof globalThis.navigator === 'undefined' ||
                typeof globalThis.addEventListener !== 'function' ) {
                return;
            }

            // Track previous online state
            let wasOnline = navigator.onLine;

            // Function to handle network state changes
            const handleNetworkChange = () => {
                const isOnline = navigator.onLine;

                // If we went from online to offline, purge the cache
                if ( wasOnline && !isOnline ) {
                    console.log('Network connection lost - purging cache');
                    try {
                        this._cache.flushall();
                        console.log('Cache purged successfully');
                    } catch( error ) {
                        console.error('Error purging cache:', error);
                    }
                }

                // Update the previous state
                wasOnline = isOnline;
            };

            // Listen for online/offline events
            globalThis.addEventListener('online', handleNetworkChange);
            globalThis.addEventListener('offline', handleNetworkChange);

            // Also listen for visibility change as an additional indicator
            // (some browsers don't fire offline events reliably)
            if ( typeof document !== 'undefined' ) {
                document.addEventListener('visibilitychange', () => {
                    // Small delay to allow network state to update
                    setTimeout(handleNetworkChange, 100);
                });
            }
        };

        /**
         * Checks and updates the GUI FS cache for most-commonly used paths
         * @private
         */
        checkAndUpdateGUIFScache = function(){
            // only run in gui environment
            if(puter.env !== 'gui') return;
            // only run if user is authenticated
            if(!puter.whoami) return;

            let username = puter.whoami.username;

            // common paths
            let home_path = `/${username}`;
            let desktop_path = `/${username}/Desktop`;
            let documents_path = `/${username}/Documents`;
            let public_path = `/${username}/Public`;

            // item:Home
            if(!puter._cache.get('item:' + home_path)){
                console.log(`/${username} item is not cached, refetching cache`);
                // fetch home
                puter.fs.stat(home_path);
            }
            // item:Desktop
            if(!puter._cache.get('item:' + desktop_path)){
                console.log(`/${username}/Desktop item is not cached, refetching cache`);
                // fetch desktop
                puter.fs.stat(desktop_path);
            }
            // item:Documents
            if(!puter._cache.get('item:' + documents_path)){
                console.log(`/${username}/Documents item is not cached, refetching cache`);
                // fetch documents
                puter.fs.stat(documents_path);
            }
            // item:Public
            if(!puter._cache.get('item:' + public_path)){
                console.log(`/${username}/Public item is not cached, refetching cache`);
                // fetch public
                puter.fs.stat(public_path);
            }

            // readdir:Home
            if(!puter._cache.get('readdir:' + home_path)){
                console.log(`/${username} is not cached, refetching cache`);
                // fetch home
                puter.fs.readdir(home_path);
            }
            // readdir:Desktop
            if(!puter._cache.get('readdir:' + desktop_path)){
                console.log(`/${username}/Desktop is not cached, refetching cache`);
                // fetch desktop
                puter.fs.readdir(desktop_path);
            }
            // readdir:Documents
            if(!puter._cache.get('readdir:' + documents_path)){
                console.log(`/${username}/Documents is not cached, refetching cache`);
                // fetch documents
                puter.fs.readdir(documents_path);
            }
            // readdir:Public
            if(!puter._cache.get('readdir:' + public_path)){
                console.log(`/${username}/Public is not cached, refetching cache`);
                // fetch public
                puter.fs.readdir(public_path);
            }
        }
    }

    // Create a new Puter object and return it
    const puterobj = new Puter();

    // Return the Puter object
    return puterobj;
});

export const puter =  puterInit();
export default puter;
globalThis.puter = puter;

puter.tools = [];
/**
 * @type {{messageTarget: Window}}
 */
const puterParent = puter.ui.parentApp();
window.puterParent = puterParent;
if (puterParent) {
    console.log("I have a parent, registering tools")
    puterParent.on('message', async (event) => {
        console.log("Got tool req ", event)
        if (event.$ === "requestTools") {
            console.log("Responding with tools")
            puterParent.postMessage({
                $: "providedTools",
                tools: JSON.parse(JSON.stringify(puter.tools))
            });
        }

        if (event.$ === "executeTool") {
            console.log("xecuting tools")
            /**
             * Puter tools format
             * @type {[{exec: Function, function: {description: string, name: string, parameters: {properties: any, required: Array<string>}, type: string}}]}
             */
            const [tool] = puter.tools.filter(e=>e.function.name === event.toolName);

            const response = await tool.exec(event.parameters);
            puterParent.postMessage({
                $: "toolResponse",
                response,
                tag: event.tag,
            });
        }
    });
    puterParent.postMessage({$: "ready"});
}

globalThis.addEventListener && globalThis.addEventListener('message', async (event) => {
    // if the message is not from Puter, then ignore it
    if ( event.origin !== puter.defaultGUIOrigin ) return;

    if ( event.data.msg && event.data.msg === 'requestOrigin' ){
        event.source.postMessage({
            msg: 'originResponse',
        }, '*');
    }
    else if ( event.data.msg === 'puter.token' ) {
        // puterDialog.close();
        // Set the authToken property
        puter.setAuthToken(event.data.token);
        // update appID
        puter.setAppID(event.data.app_uid);
        // Remove the event listener to avoid memory leaks
        // window.removeEventListener('message', messageListener);

        puter.puterAuthState.authGranted = true;
        // Resolve the promise
        // resolve();

        // Call onAuth callback
        if ( puter.onAuth && typeof puter.onAuth === 'function' ){
            puter.getUser().then((user) => {
                puter.onAuth(user);
            });
        }

        puter.puterAuthState.isPromptOpen = false;
        // Resolve or reject any waiting promises.
        if ( puter.puterAuthState.resolver ) {
            if ( puter.puterAuthState.authGranted ) {
                puter.puterAuthState.resolver.resolve();
            } else {
                puter.puterAuthState.resolver.reject();
            }
            puter.puterAuthState.resolver = null;
        };
    }
});