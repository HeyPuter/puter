import OS from './modules/OS.js';
import { PuterJSFileSystemModule } from './modules/FileSystem/index.js';
import Hosting from './modules/Hosting.js';
import Email from './modules/Email.js';
import Apps from './modules/Apps.js';
import UI from './modules/UI.js';
import KV from './modules/KV.js';
import AI from './modules/AI.js';
import Auth from './modules/Auth.js';
import FSItem from './modules/FSItem.js';
import * as utils from './lib/utils.js';
import path from './lib/path.js';
import Util from './modules/Util.js';
import Drivers from './modules/Drivers.js';
import putility from '@heyputer/putility';
import { FSRelayService } from './services/FSRelay.js';
import { FilesystemService } from './services/Filesystem.js';
import { APIAccessService } from './services/APIAccess.js';
import { XDIncomingService } from './services/XDIncoming.js';
import { NoPuterYetService } from './services/NoPuterYet.js';
import { Debug } from './modules/Debug.js';

window.puter = (function() {
    'use strict';

    class Puter{
        // The environment that the SDK is running in. Can be 'gui', 'app' or 'web'.
        // 'gui' means the SDK is running in the Puter GUI, i.e. Puter.com.
        // 'app' means the SDK is running as a Puter app, i.e. within an iframe in the Puter GUI.
        // 'web' means the SDK is running in a 3rd-party website.
        env;

        defaultAPIOrigin = globalThis.PUTER_API_ORIGIN ?? 'https://api.puter.com';
        defaultGUIOrigin = globalThis.PUTER_ORIGIN ?? 'https://puter.com';

        // An optional callback when the user is authenticated. This can be set by the app using the SDK.
        onAuth;

        /**
         * State object to keep track of the authentication request status.
         * This is used to prevent multiple authentication popups from showing up by different parts of the app.
         */
        puterAuthState = {
            isPromptOpen: false,
            authGranted: null,
            resolver: null
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
            this.registerModule('email', Email);
            this.registerModule('apps', Apps);
            this.registerModule('ai', AI);
            this.registerModule('kv', KV);
            this.registerModule('drivers', Drivers);
            this.registerModule('debug', Debug);

            // Path
            this.path = path;
        }

        // --------------------------------------------
        // Constructor
        // --------------------------------------------
        constructor(options) {
            options = options ?? {};
            
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
            let URLParams = new URLSearchParams(window.location.search);

            // Figure out the environment in which the SDK is running
            if (URLParams.has('puter.app_instance_id'))
                this.env = 'app';
            else if(window.puter_gui_enabled === true)
                this.env = 'gui';
            else
                this.env = 'web';

            // There are some specific situations where puter is definitely loaded in GUI mode
            // we're going to check for those situations here so that we don't break anything unintentionally
            // if navigator URL's hostname is 'puter.com'
            if(this.env !== 'gui'){
                // Retrieve the hostname from the URL: Remove the trailing dot if it exists. This is to handle the case where the URL is, for example, `https://puter.com.` (note the trailing dot).
                // This is necessary because the trailing dot can cause the hostname to not match the expected value. 
                let hostname = location.hostname.replace(/\.$/, '');

                // Create a new URL object with the URL string
                const url = new URL(this.defaultGUIOrigin);

                // Extract hostname from the URL object
                const gui_hostname = url.hostname;

                // If the hostname matches the GUI hostname, then the SDK is running in the GUI environment
                if(hostname === gui_hostname){
                    this.env = 'gui';
                }
            }

            // Get the 'args' from the URL. This is used to pass arguments to the app.
            if(URLParams.has('puter.args')){
                this.args = JSON.parse(decodeURIComponent(URLParams.get('puter.args')));
            }else{
                this.args = {};
            }

            // Try to extract appInstanceID from the URL. appInstanceID is included in every messaage
            // sent to the host environment. This is used to help host environment identify the app
            // instance that sent the message and communicate back to it.
            if(URLParams.has('puter.app_instance_id')){
                this.appInstanceID = decodeURIComponent(URLParams.get('puter.app_instance_id'));
            }

            // Try to extract parentInstanceID from the URL. If another app launched this app instance, parentInstanceID
            // holds its instance ID, and is used to communicate with that parent app.
            if(URLParams.has('puter.parent_instance_id')){
                this.parentInstanceID = decodeURIComponent(URLParams.get('puter.parent_instance_id'));
            }

            // Try to extract `puter.app.id` from the URL. `puter.app.id` is the unique ID of the app.
            // App ID is useful for identifying the app when communicating with the Puter API, among other things.
            if(URLParams.has('puter.app.id')){
                this.appID = decodeURIComponent(URLParams.get('puter.app.id'));
            }

            // Construct this App's AppData path based on the appID. AppData path is used to store files that are specific to this app.
            // The default AppData path is `~/AppData/<appID>`.
            if(this.appID){
                this.appDataPath = `~/AppData/${this.appID}`;
            }

            // Construct APIOrigin from the URL. APIOrigin is used to build the URLs for the Puter API endpoints.
            // The default APIOrigin is https://api.puter.com. However, if the URL contains a `puter.api_origin` query parameter,
            // then that value is used as the APIOrigin. If the URL contains a `puter.domain` query parameter, then the APIOrigin
            // is constructed as `https://api.<puter.domain>`.
            // This should only be done when the SDK is running in 'app' mode.
            this.APIOrigin = this.defaultAPIOrigin;
            if(URLParams.has('puter.api_origin') && this.env === 'app'){
                this.APIOrigin = decodeURIComponent(URLParams.get('puter.api_origin'));
            }else if(URLParams.has('puter.domain') && this.env === 'app'){
                this.APIOrigin = 'https://api.' + URLParams.get('puter.domain');
            }

            // === START :: Logger ===

            // logger will log to console
            let logger = new putility.libs.log.ConsoleLogger();

            // logs can be toggled based on categories
            logger = new putility.libs.log.CategorizedToggleLogger(
                { delegate: logger });
            const cat_logger = logger;
            
            // create facade for easy logging
            this.log = new putility.libs.log.LoggerFacade({
                impl: logger,
                cat: cat_logger,
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
                    ['authToken','auth_token'],
                    ['APIOrigin','api_origin'],
                ].forEach(([k1,k2]) => {
                    Object.defineProperty(this, k1, {
                        get () {
                            return svc_apiAccess[k2];
                        },
                        set (v) {
                            svc_apiAccess[k2] = v;
                            return true;
                        }
                    });
                });
            })();

            // === Start :: Modules === //

            // The SDK is running in the Puter GUI (i.e. 'gui')
            if(this.env === 'gui'){
                this.authToken = window.auth_token;
                // initialize submodules
                this.initSubmodules();
            }
            // Loaded in an iframe in the Puter GUI (i.e. 'app')
            // When SDK is loaded in App mode the initiation process should start when the DOM is ready
            else if (this.env === 'app') {
                this.authToken = decodeURIComponent(URLParams.get('puter.auth.token'));
                // initialize submodules
                this.initSubmodules();
                // If the authToken is already set in localStorage, then we don't need to show the dialog
                try {
                    if(localStorage.getItem('puter.auth.token')){
                        this.setAuthToken(localStorage.getItem('puter.auth.token'));
                    }
                    // if appID is already set in localStorage, then we don't need to show the dialog
                    if(localStorage.getItem('puter.app.id')){
                        this.setAppID(localStorage.getItem('puter.app.id'));
                    }
                } catch (error) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            }
            // SDK was loaded in a 3rd-party website.
            // When SDK is loaded in GUI the initiation process should start when the DOM is ready. This is because
            // the SDK needs to show a dialog to the user to ask for permission to access their Puter account.
            else if(this.env === 'web') {
                // initialize submodules
                this.initSubmodules();
                try{
                    // If the authToken is already set in localStorage, then we don't need to show the dialog
                    if(localStorage.getItem('puter.auth.token')){
                        this.setAuthToken(localStorage.getItem('puter.auth.token'));
                    }
                    // if appID is already set in localStorage, then we don't need to show the dialog
                    if(localStorage.getItem('puter.app.id')){
                        this.setAppID(localStorage.getItem('puter.app.id'));
                    }
                } catch (error) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
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

                this.log.impl = logger;
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
        }

        /**
         * @internal
         * Makes a request to `/rao`. This method aquires a lock to prevent
         * multiple requests, and is effectively idempotent.
         */
        async request_rao_ () {
            await this.p_can_request_rao_;
            
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
                        Authorization: `Bearer ${this.authToken}`
                    }
                });
                return await resp.json();
            } catch (e) {
                had_error = true;
                console.error(e);
            } finally {
                this.lock_rao_.release();
            }
            if ( ! had_error ) {
                this.rao_requested_ = true;
            }
        }
        
        registerModule (name, cls, parameters = {}) {
            const instance = new cls(this.context, parameters);
            this.modules_.push(name);
            this[name] = instance;
        }

        updateSubmodules() {
            // Update submodules with new auth token and API origin
            for ( const name of this.modules_ ) {
                if ( ! this[name] ) continue;
                this[name]?.setAuthToken?.(this.authToken);
                this[name]?.setAPIOrigin?.(this.APIOrigin);
            }
        }

        setAppID = function (appID) {
            // save to localStorage
            try{
                localStorage.setItem('puter.app.id', appID);
            } catch (error) {
                // Handle the error here
                console.error('Error accessing localStorage:', error);
            }
            this.appID = appID;
        }

        setAuthToken = function (authToken) {
            this.authToken = authToken;
            // If the SDK is running on a 3rd-party site or an app, then save the authToken in localStorage
            if(this.env === 'web' || this.env === 'app'){
                try{
                    localStorage.setItem('puter.auth.token', authToken);
                } catch (error) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            }
            // reinitialize submodules
            this.updateSubmodules();
            // rao
            this.request_rao_();
        }

        setAPIOrigin = function (APIOrigin) {
            this.APIOrigin = APIOrigin;
            // reinitialize submodules
            this.updateSubmodules();
        }

        resetAuthToken = function () {
            this.authToken = null;
            // If the SDK is running on a 3rd-party site or an app, then save the authToken in localStorage
            if(this.env === 'web' || this.env === 'app'){
                try{
                    localStorage.removeItem('puter.auth.token');
                } catch (error) {
                    // Handle the error here
                    console.error('Error accessing localStorage:', error);
                }
            }
            // reinitialize submodules
            this.updateSubmodules();
        }

        exit = function(statusCode = 0) {
            if (statusCode && (typeof statusCode !== 'number')) {
                console.warn('puter.exit() requires status code to be a number. Treating it as 1');
                statusCode = 1;
            }

            window.parent.postMessage({
                msg: "exit",
                appInstanceID: this.appInstanceID,
                statusCode,
            }, '*');
        }

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
            const first_adj = ['helpful','sensible', 'loyal', 'honest', 'clever', 'capable','calm', 'smart', 'genius', 'bright', 'charming', 'creative', 'diligent', 'elegant', 'fancy', 
            'colorful', 'avid', 'active', 'gentle', 'happy', 'intelligent', 'jolly', 'kind', 'lively', 'merry', 'nice', 'optimistic', 'polite', 
            'quiet', 'relaxed', 'silly', 'victorious', 'witty', 'young', 'zealous', 'strong', 'brave', 'agile', 'bold'];

            const nouns = ['street', 'roof', 'floor', 'tv', 'idea', 'morning', 'game', 'wheel', 'shoe', 'bag', 'clock', 'pencil', 'pen', 
            'magnet', 'chair', 'table', 'house', 'dog', 'room', 'book', 'car', 'cat', 'tree', 
            'flower', 'bird', 'fish', 'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'mountain', 
            'river', 'lake', 'sea', 'ocean', 'island', 'bridge', 'road', 'train', 'plane', 'ship', 'bicycle', 
            'horse', 'elephant', 'lion', 'tiger', 'bear', 'zebra', 'giraffe', 'monkey', 'snake', 'rabbit', 'duck', 
            'goose', 'penguin', 'frog', 'crab', 'shrimp', 'whale', 'octopus', 'spider', 'ant', 'bee', 'butterfly', 'dragonfly', 
            'ladybug', 'snail', 'camel', 'kangaroo', 'koala', 'panda', 'piglet', 'sheep', 'wolf', 'fox', 'deer', 'mouse', 'seal',
            'chicken', 'cow', 'dinosaur', 'puppy', 'kitten', 'circle', 'square', 'garden', 'otter', 'bunny', 'meerkat', 'harp']

            // return a random combination of first_adj + noun + number (between 0 and 9999)
            // e.g. clever-idea-123
            return first_adj[Math.floor(Math.random() * first_adj.length)] + separateWith + nouns[Math.floor(Math.random() * nouns.length)] + separateWith + Math.floor(Math.random() * 10000);
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
                const xhr = utils.initXhr('/whoami', this.APIOrigin, this.authToken, 'get');
    
                // set up event handlers for load and error events
                utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);
    
                xhr.send();
            })
        }

        print = function(...args){
            for(let arg of args){
                document.body.innerHTML += arg;
            }
        }
    }

    // Create a new Puter object and return it
    const puterobj = new Puter();

    // Return the Puter object
    return puterobj;
}());

window.addEventListener('message', async (event) => {
    // if the message is not from Puter, then ignore it
    if(event.origin !== puter.defaultGUIOrigin) return;

    if(event.data.msg && event.data.msg === 'requestOrigin'){
        event.source.postMessage({
            msg: "originResponse",
        }, '*');    
    }
    else if (event.data.msg === 'puter.token') {
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
        if(puter.onAuth && typeof puter.onAuth === 'function'){
            puter.getUser().then((user) => {
                puter.onAuth(user)
            });
        }

        puter.puterAuthState.isPromptOpen = false;
        // Resolve or reject any waiting promises.
        if (puter.puterAuthState.resolver) {
            if (puter.puterAuthState.authGranted) {
                puter.puterAuthState.resolver.resolve();
            } else {
                puter.puterAuthState.resolver.reject();
            }
            puter.puterAuthState.resolver = null;
        };
    }
})
