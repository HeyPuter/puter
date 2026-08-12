import kvjs from '@heyputer/kv.js';
import APICallLogger from './lib/APICallLogger.js';
import { fetchUrl } from './lib/networkUtils.js';
import { isStoredTokenUsableForOrigin } from './lib/authTokenOrigin.js';
import path from 'path-browserify';
import localStorageMemory from './lib/polyfills/localStorage.js';
import xhrshim from './lib/polyfills/xhrshim.js';
import * as utils from './lib/utils.js';
import { AI } from './modules/ai/index.js';
import { Apps } from './modules/apps/index.js';
import Auth from './modules/Auth.js';
import { Debug } from './modules/Debug.js';
import Drivers from './modules/Drivers.js';
import Email from './modules/Email.js';
import { PuterJSFileSystemModule } from './modules/FileSystem/index.js';
import FSItem from './modules/FSItem.js';
import { Hosting } from './modules/hosting/index.js';
import { KV } from './modules/kv/index.js';
import { PSocket } from './modules/networking/PSocket.js';
import { PTLSSocket } from './modules/networking/PTLS.js';
import { pFetch } from './modules/networking/requests.js';
import { OS } from './modules/os/index.js';
import { Perms } from './modules/perms/index.js';
import PuterDialog from './modules/PuterDialog.js';
import UI from './modules/UI.js';
import Util from './modules/Util.js';
import { WorkersHandler } from './modules/Workers.js';
import Peer from './modules/Peer.js';
import { registerComponents } from './ui/registerComponents.js';

class SimpleLogger {
    constructor(fields = {}) {
        this.fieldsObj = fields;
        this.enabled = new Set();
    }

    on(category) {
        this.enabled.add(category);
    }

    fields(extra = {}) {
        return new SimpleLogger({ ...this.fieldsObj, ...extra });
    }

    info(...args) {
        console.log(...this._prefix(), ...args);
    }

    warn(...args) {
        console.warn(...this._prefix(), ...args);
    }

    error(...args) {
        console.error(...this._prefix(), ...args);
    }

    debug(...args) {
        console.debug(...this._prefix(), ...args);
    }

    _prefix() {
        const entries = Object.entries(this.fieldsObj);
        if (!entries.length) return [];
        return [`[${entries.map(([k, v]) => `${k}=${v}`).join(' ')}]`];
    }
}

class Lock {
    constructor() {
        this.locked = false;
        this.queue = [];
    }

    async acquire() {
        if (!this.locked) {
            this.locked = true;
            return;
        }

        await new Promise((resolve) => this.queue.push(resolve));
        this.locked = true;
    }

    release() {
        const next = this.queue.shift();
        if (next) {
            next();
            return;
        }
        this.locked = false;
    }
}
// TODO: This is for a safe-guard below; we should check if we can
//       generalize this behavior rather than hard-coding it.
//       (using defaultGUIOrigin breaks locally-hosted apps)
const PROD_ORIGIN = 'https://puter.com';

// localStorage key for the auth token. The retired key below is never read —
// only deleted, so a token from before the format change doesn't linger in a
// visitor's browser (see `discardRetiredAuthToken_`).
const STORAGE_KEY_V2 = 'puter.auth.token.v2';
const STORAGE_KEY_V1 = 'puter.auth.token';
// Records the API origin a stored token was minted against. A stored token is
// only ever replayed to this origin, so a URL-controlled `puter.api_origin`
// can't harvest a previously-stored token and forward it to a foreign origin.
const STORAGE_KEY_ORIGIN_V2 = 'puter.auth.token.origin.v2';

export class Puter {
    /**
     * The environment that the SDK is running in.
     *
     * `gui` means the SDK is running in the Puter GUI, i.e. Puter.com.
     * `app` means it is running as a Puter app, i.e. within an iframe in
     * the Puter GUI. `web` means it is running in a 3rd-party website.
     *
     * @type {import('./lib/types.js').PuterEnvironment}
     */
    env;

    /**
     * Arguments the host environment launched this app with.
     *
     * @type {Record<string, unknown>}
     */
    args = {};

    /**
     * The token the SDK authenticates API calls with, if any.
     *
     * @type {string | null}
     */
    authToken = null;

    /**
     * Origin every API call is sent to.
     *
     * @type {string}
     */
    APIOrigin;

    /**
     * Tool schemas this app exposes to `puter.ai`.
     *
     * @type {import('./lib/types.js').ToolSchema[]}
     */
    tools = [];

    // The modules, declared here rather than left to inference because
    // `initSubmodules` assigns them outside the constructor, which would
    // otherwise make every one of them possibly-undefined for consumers.
    // Each type comes from the module's own public export, so the
    // implementation stays the source of truth.

    /** @type {InstanceType<typeof Util>} */
    util;
    /** @type {InstanceType<typeof Auth>} */
    auth;
    /** @type {InstanceType<typeof OS>} */
    os;
    /** @type {InstanceType<import('./modules/FileSystem/index.js').FSConstructor>} */
    fs;
    /** @type {InstanceType<typeof UI>} */
    ui;
    /** @type {InstanceType<typeof Hosting>} */
    hosting;
    /** @type {InstanceType<typeof Apps>} */
    apps;
    /** @type {InstanceType<typeof AI>} */
    ai;
    /** @type {InstanceType<typeof KV>} */
    kv;
    /** @type {InstanceType<typeof Email>} */
    email;
    /** @type {InstanceType<typeof Perms>} */
    perms;
    /** @type {InstanceType<typeof Drivers>} */
    drivers;
    /** @type {InstanceType<typeof Debug>} */
    debug;
    /** @type {InstanceType<typeof Peer>} */
    peer;
    /** @type {InstanceType<import('./modules/Workers.js').WorkersConstructor>} */
    workers;
    /**
     * The `path-browserify` helpers, re-exposed so apps can build Puter paths
     * without pulling in their own copy. Spelled out rather than taken from
     * the package, which ships no types of its own.
     *
     * @type {{
     *     join: (...parts: string[]) => string,
     *     dirname: (p: string) => string,
     *     basename: (p: string) => string,
     *     normalize?: (p: string) => string,
     *     [key: string]: unknown,
     * }}
     */
    path;

    #defaultAPIOrigin = 'https://api.puter.com';
    #defaultGUIOrigin = 'https://puter.com';

    /** @returns {string} */
    get defaultAPIOrigin() {
        return (
            globalThis.PUTER_API_ORIGIN ||
            globalThis.PUTER_API_ORIGIN_ENV ||
            this.#defaultAPIOrigin
        );
    }
    set defaultAPIOrigin(v) {
        this.#defaultAPIOrigin = v;
    }

    /** @returns {string} */
    get defaultGUIOrigin() {
        return (
            globalThis.PUTER_ORIGIN ||
            globalThis.PUTER_ORIGIN_ENV ||
            this.#defaultGUIOrigin
        );
    }
    set defaultGUIOrigin(v) {
        this.#defaultGUIOrigin = v;
    }

    /**
     * Called once the user is authenticated. Set by the app using the SDK.
     *
     * @type {((user: Record<string, unknown>) => void) | undefined}
     */
    onAuth;

    /**
     * State object to keep track of the authentication request status. This
     * is used to prevent multiple authentication popups from showing up by
     * different parts of the app.
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

    // Reauth coordinator state. When the backend signals
    // `401 { code: 'reauth_required' }`, in-flight requests await this
    // promise; the first caller drives the interactive flow, everyone
    // else replays after it resolves.
    _reauthInflight = null;

    // Subscribers to token / API origin changes. Modules read both live
    // off this instance, so this is only for the few that hold an open
    // connection and have to rebuild it.
    _authStateListeners = new Set();

    // debug flag
    debugMode = false;

    // Whether to suppress the developer CTA in the console
    quiet = false;

    /**
     * Puter.js Modules
     *
     * These are the modules you see on docs.puter.com; for example:
     *
     * - Puter.fs
     * - Puter.kv
     * - Puter.ui
     *
     * InitSubmodules is called from the constructor of this class.
     */
    initSubmodules() {
        // Util
        this.util = new Util();

        this.auth = this.registerModule('auth', Auth);
        this.os = this.registerModule('os', OS);
        this.fs = this.registerModule('fs', PuterJSFileSystemModule);
        this.ui = this.registerModule('ui', UI, {
            appInstanceID: this.appInstanceID,
            parentInstanceID: this.parentInstanceID,
        });
        this.hosting = this.registerModule('hosting', Hosting);
        this.apps = this.registerModule('apps', Apps);
        this.ai = this.registerModule('ai', AI);
        this.kv = this.registerModule('kv', KV);
        this.email = this.registerModule('email', Email);
        this.perms = this.registerModule('perms', Perms);
        this.drivers = this.registerModule('drivers', Drivers);
        this.debug = this.registerModule('debug', Debug);
        this.peer = this.registerModule('peer', Peer);
        this.workers = this.registerModule('workers', WorkersHandler);

        // Path
        this.path = path;

        // Register web components for standalone UI fallback
        registerComponents();
    }

    normalizeAuthTokenCandidate = function (tokenCandidate) {
        if (typeof tokenCandidate !== 'string') return null;
        const trimmedTokenCandidate = tokenCandidate.trim();
        if (
            !trimmedTokenCandidate ||
            trimmedTokenCandidate === 'null' ||
            trimmedTokenCandidate === 'undefined'
        ) {
            return null;
        }
        return trimmedTokenCandidate;
    };

    decodeJwtPayload = function (tokenCandidate) {
        if (typeof tokenCandidate !== 'string') return null;
        const tokenParts = tokenCandidate.split('.');
        if (tokenParts.length < 2) return null;

        let payloadPart = tokenParts[1];
        payloadPart = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const missingPaddingLength = payloadPart.length % 4;
        if (missingPaddingLength) {
            payloadPart += '='.repeat(4 - missingPaddingLength);
        }

        try {
            let decodedPayloadText;
            if (typeof globalThis.atob === 'function') {
                decodedPayloadText = decodeURIComponent(
                    Array.prototype.map
                        .call(
                            globalThis.atob(payloadPart),
                            (character) =>
                                `%${`00${character.charCodeAt(0).toString(16)}`.slice(-2)}`,
                        )
                        .join(''),
                );
            } else if (typeof globalThis.Buffer !== 'undefined') {
                decodedPayloadText = globalThis.Buffer.from(
                    payloadPart,
                    'base64',
                ).toString('utf8');
            } else {
                return null;
            }
            const parsedPayload = JSON.parse(decodedPayloadText);
            return parsedPayload && typeof parsedPayload === 'object'
                ? parsedPayload
                : null;
        } catch {
            return null;
        }
    };

    normalizeStringCandidate = function (valueCandidate) {
        if (typeof valueCandidate !== 'string') return null;
        const trimmedValueCandidate = valueCandidate.trim();
        return trimmedValueCandidate || null;
    };

    decodeCompressedAppID = function (compressedAppIDCandidate) {
        const normalizedCompressedAppID = this.normalizeStringCandidate(
            compressedAppIDCandidate,
        );
        if (!normalizedCompressedAppID) return null;

        // TokenService may already provide an expanded UID value.
        if (normalizedCompressedAppID.includes('-')) {
            return normalizedCompressedAppID;
        }

        try {
            let decodedBytes;
            if (typeof globalThis.Buffer !== 'undefined') {
                decodedBytes = globalThis.Buffer.from(
                    normalizedCompressedAppID,
                    'base64',
                );
            } else if (typeof globalThis.atob === 'function') {
                const decodedBinary = globalThis.atob(
                    normalizedCompressedAppID,
                );
                decodedBytes = Uint8Array.from(decodedBinary, (character) =>
                    character.charCodeAt(0),
                );
            } else {
                return null;
            }

            if (!decodedBytes || decodedBytes.length !== 16) return null;

            const decodedHex =
                typeof globalThis.Buffer !== 'undefined' &&
                typeof globalThis.Buffer.isBuffer === 'function' &&
                globalThis.Buffer.isBuffer(decodedBytes)
                    ? decodedBytes.toString('hex')
                    : Array.from(decodedBytes)
                          .map((byte) => byte.toString(16).padStart(2, '0'))
                          .join('');
            if (decodedHex.length !== 32) return null;

            return `app-${[
                decodedHex.slice(0, 8),
                decodedHex.slice(8, 12),
                decodedHex.slice(12, 16),
                decodedHex.slice(16, 20),
                decodedHex.slice(20),
            ].join('-')}`;
        } catch {
            return null;
        }
    };

    getAppIDFromAuthToken = function (tokenCandidate) {
        const payload = this.decodeJwtPayload(tokenCandidate);
        if (!payload) return null;

        const uncompressedAppUid = this.normalizeStringCandidate(
            payload.app_uid,
        );
        if (uncompressedAppUid) return uncompressedAppUid;

        // `auth` JWT scope may compress `app_uid` to `au`.
        return this.decodeCompressedAppID(payload.au);
    };

    // --------------------------------------------
    // Constructor
    // --------------------------------------------
    constructor() {
        // Initialize the cache using kv.js
        this._cache = new kvjs({ dbName: 'puter_cache' });
        this._opscache = new kvjs();

        // Holds the query parameters found in the current URL
        let URLParams = new URLSearchParams(globalThis.location?.search);

        // Figure out the environment in which the SDK is running
        if (URLParams.has('puter.app_instance_id')) {
            this.env = 'app';
        } else if (globalThis.puter_gui_enabled === true) {
            this.env = 'gui';
        } else if (globalThis.WorkerGlobalScope) {
            if (globalThis.ServiceWorkerGlobalScope) {
                this.env = 'service-worker';
                if (!globalThis.XMLHttpRequest) {
                    globalThis.XMLHttpRequest = xhrshim;
                }
                if (!globalThis.location) {
                    globalThis.location = new URL('https://puter.site/');
                }
                // XHRShimGlobalize here
            } else {
                this.env = 'web-worker';
            }
            if (!globalThis.localStorage) {
                globalThis.localStorage = localStorageMemory;
            }
        } else if (globalThis.process) {
            this.env = 'nodejs';
            if (!globalThis.localStorage) {
                globalThis.localStorage = localStorageMemory;
            }
            if (!globalThis.XMLHttpRequest) {
                globalThis.XMLHttpRequest = xhrshim;
            }
            if (!globalThis.location) {
                globalThis.location = new URL('https://nodejs.puter.site/');
            }
            if (!globalThis.addEventListener) {
                globalThis.addEventListener = () => {}; // API Stub
            }
        } else {
            this.env = 'web';
        }

        // There are some specific situations where puter is definitely loaded in GUI mode
        // we're going to check for those situations here so that we don't break anything unintentionally
        // if navigator URL's hostname is 'puter.com'
        if (this.env !== 'gui') {
            // Retrieve the hostname from the URL: Remove the trailing dot if it exists. This is to handle the case where the URL is, for example, `https://puter.com.` (note the trailing dot).
            // This is necessary because the trailing dot can cause the hostname to not match the expected value.
            let hostname = location.hostname.replace(/\.$/, '');

            // Create a new URL object with the URL string
            const url = new URL(PROD_ORIGIN);

            // Extract hostname from the URL object
            const gui_hostname = url.hostname;

            // If the hostname matches the GUI hostname, then the SDK is running in the GUI environment
            if (hostname === gui_hostname) {
                this.env = 'gui';
            }
        }

        // Get the 'args' from the URL. This is used to pass arguments to the app.
        if (URLParams.has('puter.args')) {
            this.args = JSON.parse(
                decodeURIComponent(URLParams.get('puter.args')),
            );
        } else {
            this.args = {};
        }

        // Try to extract appInstanceID from the URL. appInstanceID is included in every messaage
        // sent to the host environment. This is used to help host environment identify the app
        // instance that sent the message and communicate back to it.
        if (URLParams.has('puter.app_instance_id')) {
            this.appInstanceID = decodeURIComponent(
                URLParams.get('puter.app_instance_id'),
            );
        }

        // Try to extract parentInstanceID from the URL. If another app launched this app instance, parentInstanceID
        // holds its instance ID, and is used to communicate with that parent app.
        if (URLParams.has('puter.parent_instance_id')) {
            this.parentInstanceID = decodeURIComponent(
                URLParams.get('puter.parent_instance_id'),
            );
        }

        // Try to extract `puter.app.id` from the URL. `puter.app.id` is the unique ID of the app.
        // App ID is useful for identifying the app when communicating with the Puter API, among other things.
        if (URLParams.has('puter.app.id')) {
            this.appID = decodeURIComponent(URLParams.get('puter.app.id'));
        }

        // Extract app name (added later)
        if (URLParams.has('puter.app.name')) {
            this.appName = decodeURIComponent(
                URLParams.get('puter.app.name'),
            );
        }

        // Construct this App's AppData path based on the appID. AppData path is used to store files that are specific to this app.
        // The default AppData path is `~/AppData/<appID>`.
        if (this.appID) {
            this.appDataPath = `~/AppData/${this.appID}`;
        }

        // Construct APIOrigin from the URL. APIOrigin is used to build the URLs for the Puter API endpoints.
        // The default APIOrigin is https://api.puter.com. However, if the URL contains a `puter.api_origin` query parameter,
        // then that value is used as the APIOrigin. If the URL contains a `puter.domain` query parameter, then the APIOrigin
        // is constructed as `https://api.<puter.domain>`.
        // This should only be done when the SDK is running in 'app' mode.
        this.APIOrigin = this.defaultAPIOrigin;
        if (URLParams.has('puter.api_origin') && this.env === 'app') {
            this.APIOrigin = decodeURIComponent(
                URLParams.get('puter.api_origin'),
            );
        } else if (URLParams.has('puter.domain') && this.env === 'app') {
            this.APIOrigin = `https://api.${URLParams.get('puter.domain')}`;
        }

        // === START :: Logger ===

        // Basic logger replacement (console-based)
        let logger = new SimpleLogger();
        this.logger = logger;

        // Initialize API call logger
        this.apiCallLogger = new APICallLogger({
            enabled: false, // Disabled by default
        });

        // `/rao` state, set up before the environment branches below
        // because those call setAuthToken, which requests `/rao`.
        // Lock to prevent multiple requests to `/rao`
        this.lock_rao_ = new Lock();
        // Promise that resolves when it's okay to request `/rao`
        this.p_can_request_rao_ = Promise.resolve();
        // Flag that indicates if a request to `/rao` has been made
        this.rao_requested_ = false;
        // The in-flight boot `/whoami`, awaited by anything that wants the
        // cached user without issuing its own request.
        this.whoamiCache_ = null;

        // === Start :: Modules === //

        // The SDK is running in the Puter GUI (i.e. 'gui')
        if (this.env === 'gui') {
            this.authToken = window.auth_token;
            // initialize submodules
            this.initSubmodules();
        }
        // Loaded in an iframe in the Puter GUI (i.e. 'app')
        // When SDK is loaded in App mode the initiation process should start when the DOM is ready
        else if (this.env === 'app') {
            const bootstrapAuthToken = this.normalizeAuthTokenCandidate(
                URLParams.get('puter.auth.token') ??
                    URLParams.get('auth_token'),
            );
            try {
                let selectedAuthToken = bootstrapAuthToken;
                if (bootstrapAuthToken) {
                    this.setAuthToken(bootstrapAuthToken);
                } else {
                    // No token in the URL — fall back to a stored token,
                    // but ONLY if it is allowed for the current API origin.
                    // In app mode `puter.api_origin` is URL-controlled, so a
                    // stored token must be bound to (and matched against) the
                    // origin it was minted for. A custom (non-default) origin
                    // additionally requires an explicit binding; an unbound
                    // token is only honored against the default origin.
                    const boundOrigin = this.normalizeStringCandidate(
                        localStorage.getItem(STORAGE_KEY_ORIGIN_V2),
                    );
                    const storedToken = this.normalizeAuthTokenCandidate(
                        localStorage.getItem(STORAGE_KEY_V2),
                    );
                    if (
                        storedToken &&
                        this._storedTokenUsableForCurrentOrigin(boundOrigin)
                    ) {
                        this.setAuthToken(storedToken);
                        selectedAuthToken = storedToken;
                    } else if (storedToken) {
                        // A token exists but is not valid for this API
                        // origin (a URL-supplied custom/attacker origin, or
                        // an unbound token against a custom origin). Treat
                        // as unauthenticated and force a reauth for this
                        // origin instead of replaying the token.
                        this._needsOriginReauth = {
                            reason: 'api_origin_mismatch',
                        };
                    }
                }
                const tokenAppID =
                    this.getAppIDFromAuthToken(selectedAuthToken);
                if (!tokenAppID && !this.appID) {
                    // if appID is already set in localStorage, then we don't need to show the dialog
                    const storedAppID =
                        localStorage.getItem('puter.app.id');
                    if (storedAppID) {
                        this.setAppID(storedAppID);
                    }
                }
            } catch (error) {
                // Handle the error here
                console.error('Error accessing localStorage:', error);
            }
            this.initSubmodules();
            if (this._needsOriginReauth) {
                const reauthSignal = this._needsOriginReauth;
                this._needsOriginReauth = null;
                // The URL-supplied API origin was rejected as untrusted, so
                // snap the API origin back to the trusted default before
                // reauthing. This guarantees the fresh token is bound to —
                // and only ever sent to — the trusted default origin, never
                // the URL-supplied one. Reauth itself is pinned to the
                // configured GUI origin (see triggerReauth).
                this.setAPIOrigin(this.defaultAPIOrigin);
                this.triggerReauth(reauthSignal);
            }
        }
        // SDK was loaded in a 3rd-party website.
        // When SDK is loaded in GUI the initiation process should start when the DOM is ready. This is because
        // the SDK needs to show a dialog to the user to ask for permission to access their Puter account.
        else if (this.env === 'web') {
            // initialize submodules
            this.initSubmodules();
            try {
                const storedToken = this.normalizeAuthTokenCandidate(
                    localStorage.getItem(STORAGE_KEY_V2),
                );
                if (storedToken) this.setAuthToken(storedToken);
                // if appID is already set in localStorage, then we don't need to show the dialog
                if (!this.appID && localStorage.getItem('puter.app.id')) {
                    this.setAppID(localStorage.getItem('puter.app.id'));
                }
            } catch (error) {
                // Handle the error here
                console.error('Error accessing localStorage:', error);
            }

            // Print a CTA for developers to publish their app on the Puter App Store
            this.printDevCTA();

            // If the page was opened directly from disk (file:// protocol),
            // Puter.js cannot function. Warn the developer immediately on
            // load rather than waiting for an action that triggers auth.
            this.warnUnsupportedProtocol();
        } else if (
            this.env === 'web-worker' ||
            this.env === 'service-worker' ||
            this.env === 'nodejs'
        ) {
            this.initSubmodules();
        }

        // Wherever tokens are stored, a value under the retired key is
        // dead weight — drop it even when there's no new token to write
        // over it (`setAuthToken` handles that case).
        if (this.env === 'web' || this.env === 'app') {
            this.discardRetiredAuthToken_();
        }

        // Add prefix logger (needed to happen after modules are initialized)
        (async () => {
            try {
                // Reuses the boot `/whoami` rather than issuing a second
                // one. Nothing to prefix with when there's no token (or the
                // lookup failed), same as when this awaited its own call.
                const whoami = await this.whoamiCache_;
                if (!whoami) return;
                const prefix = `[${
                    whoami.app_name ?? this.appInstanceID ?? 'HOST'
                }]`;
                logger = logger.fields({ prefix });
                this.logger = logger;
            } catch (error) {
                if (this.debugMode) {
                    console.error(
                        'Failed to initialize prefix logger',
                        error,
                    );
                }
            }
        })();

        /** @type {import('./modules/networking/types.js').Networking} */
        this.net = {
            /**
             * Mints a relay URL (server + single-use token) for speaking
             * the Wisp v1 protocol directly, which is what the sockets
             * below do for you.
             *
             * @returns {Promise<string>}
             */
            generateWispV1URL: async () => {
                const { token: wispToken, server: wispServer } = await (
                    await fetchUrl(
                        `${this.APIOrigin}/wisp/relay-token/create`,
                        {
                            method: 'POST',
                            includePuterAuth: true,
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({}),
                        },
                    )
                ).json();
                return `${wispServer}/${wispToken}/`;
            },
            Socket: PSocket,
            tls: {
                TLSSocket: PTLSSocket,
            },
            fetch: pFetch,
        };

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

        // Don't record an app open when running inside the Puter GUI, or
        // when running as a Puter app (i.e. within an iframe in the GUI).
        if (this.env === 'gui' || this.env === 'app') {
            return;
        }

        // setAuthToken is called more than once when auth completes, which
        // causes multiple requests to /rao. This lock prevents that.
        await this.lock_rao_.acquire();
        if (this.rao_requested_) {
            this.lock_rao_.release();
            return;
        }

        try {
            const resp = await fetchUrl(`${this.APIOrigin}/rao`, {
                method: 'POST',
                includePuterAuth: true,
                headers: {
                    Origin: location.origin, // This is ignored in the browser but needed for workers and nodejs
                },
                // Recording an app open is ours, not the user's: a stale
                // token must not turn a page load into a sign-in prompt.
                interactiveReauth: false,
            });
            // Set inside the lock: a caller parked on `p_can_request_rao_`
            // acquires it the moment this releases, and would otherwise
            // record the same open a second time.
            this.rao_requested_ = true;
            return await resp.json();
        } catch (e) {
            console.error(e);
        } finally {
            this.lock_rao_.release();
        }
    }

    /**
     * @returns {Promise<import('./modules/Auth.js').User | null>} The
     *   cached user, or null when there was no token, the token was
     *   rejected, or the request failed.
     * @internal
     * Populates `puter.whoami` for callers that read the cached user
     * synchronously. Non-interactive for the same reason as `/rao`: this
     * runs on every load without the user asking, so a stale token must not
     * raise sign-in UI. Callers that need a definite answer (and the prompt
     * that comes with it) use `puter.auth.getUser()`.
     *
     * Uses `fetchUrl` rather than `this.auth` because `setAuthToken` runs
     * before `initSubmodules` in the app environment, and carries the token
     * explicitly because `includePuterAuth` reads `globalThis.puter`, which
     * isn't assigned until the constructor returns.
     */
    async cacheWhoami_() {
        if (!this.authToken) return null;
        try {
            const resp = await fetchUrl(`${this.APIOrigin}/whoami`, {
                authToken: this.authToken,
                interactiveReauth: false,
                logContext: {
                    service: 'auth',
                    operation: 'whoami',
                    params: {},
                },
            });
            if (!resp.ok) return null;
            this.whoami = await resp.json();
            return this.whoami;
        } catch (e) {
            // Best-effort cache — a network failure leaves it unset.
            return null;
        }
    }

    /**
     * Instantiates a module, registers it for auth/origin updates, and
     * hands it back for the caller to attach. Assigning the result to a
     * named property rather than having this write `this[name]` is what
     * keeps each module's type visible to consumers of the SDK.
     *
     * @template T
     * @param {string} name
     * @param {new (
     *     puter: Puter,
     *     parameters: Record<string, unknown>,
     * ) => T} cls
     * @param {Record<string, unknown>} [parameters]
     * @returns {T}
     */
    registerModule(name, cls, parameters = {}) {
        const instance = new cls(this, parameters);
        instance.puter = this;
        this[name] = instance;
        if (instance._init) instance._init({ puter: this });
        return instance;
    }

    /**
     * Subscribes to auth token / API origin changes. Modules read both live
     * off this instance, so this is only needed by the ones holding a
     * connection that has to be rebuilt.
     *
     * @param {() => void} listener
     * @returns {() => void} Unsubscribes the listener.
     */
    onAuthStateChanged(listener) {
        this._authStateListeners.add(listener);
        return () => this._authStateListeners.delete(listener);
    }

    _emitAuthStateChanged() {
        for (const listener of this._authStateListeners) {
            try {
                listener();
            } catch (error) {
                if (this.debugMode) {
                    console.error('Auth state listener failed', error);
                }
            }
        }
    }

    /** @param {string} appID */
    setAppID = function (appID) {
        // save to localStorage
        try {
            localStorage.setItem('puter.app.id', appID);
        } catch (error) {
            // Handle the error here
            console.error('Error accessing localStorage:', error);
        }
        this.appID = appID;
        this.appDataPath = appID ? `~/AppData/${appID}` : undefined;
    };

    /** @param {string} authToken */
    setAuthToken = function (authToken) {
        const normalizedAuthToken =
            this.normalizeAuthTokenCandidate(authToken);
        this.authToken = normalizedAuthToken;

        // Keep app identity consistent with token claims whenever available.
        const tokenAppID = this.getAppIDFromAuthToken(normalizedAuthToken);
        if (tokenAppID) {
            this.setAppID(tokenAppID);
        }

        // If the SDK is running on a 3rd-party site or an app, then save the authToken in localStorage
        if (this.env === 'web' || this.env === 'app') {
            try {
                if (normalizedAuthToken) {
                    localStorage.setItem(
                        STORAGE_KEY_V2,
                        normalizedAuthToken,
                    );
                    // Persist the origin this token is bound to alongside
                    // it, so a later boot only reuses it for that origin.
                    localStorage.setItem(
                        STORAGE_KEY_ORIGIN_V2,
                        this.APIOrigin,
                    );
                } else {
                    localStorage.removeItem(STORAGE_KEY_V2);
                    localStorage.removeItem(STORAGE_KEY_ORIGIN_V2);
                }
                // Clear the retired key on every write, so a stale value
                // never outlives the token that replaced it.
                localStorage.removeItem(STORAGE_KEY_V1);
            } catch (error) {
                // Handle the error here
                console.error('Error accessing localStorage:', error);
            }
        }
        // initialize loop for updating caches for major directories
        if (this.env === 'gui') {
            // check and update gui fs cache regularly
            setInterval(puter.checkAndUpdateGUIFScache, 10000);
        }
        this._emitAuthStateChanged();

        // rao
        this.request_rao_();

        // perform whoami and cache results
        this.whoamiCache_ = this.cacheWhoami_();
    };

    /**
     * Decides whether a stored token may be attached to requests for the
     * current API origin.
     *
     * - A bound token may only ever be replayed to the exact origin it was
     *   minted against.
     * - An unbound (legacy) token is only honored against the default API
     *   origin — never against a URL-supplied custom `puter.api_origin`.
     */
    _storedTokenUsableForCurrentOrigin = function (boundOrigin) {
        return isStoredTokenUsableForOrigin({
            boundOrigin,
            currentOrigin: this.APIOrigin,
            defaultAPIOrigin: this.defaultAPIOrigin,
        });
    };

    /** @param {string} APIOrigin */
    setAPIOrigin = function (APIOrigin) {
        this.APIOrigin = APIOrigin;
        this._emitAuthStateChanged();
    };

    runWhenPuterHappensCallbacks = function () {
        if (this.env !== 'gui') return;
        if (!globalThis.when_puter_happens) return;

        const callbacks = Array.isArray(globalThis.when_puter_happens)
            ? globalThis.when_puter_happens
            : [globalThis.when_puter_happens];

        for (const fn of callbacks) {
            try {
                fn({ puter: this });
            } catch (error) {
                if (this.debugMode) {
                    console.error(
                        'when_puter_happens callback failed',
                        error,
                    );
                }
            }
        }
    };

    /**
     * Forget the current token, in memory and (on a 3rd-party site or an
     * app) in localStorage. Callers own the surrounding policy — emitting
     * events, driving reauth — this only drops the value.
     *
     * @internal
     */
    _clearAuthToken = function () {
        this.authToken = null;
        if (this.env === 'web' || this.env === 'app') {
            try {
                localStorage.removeItem(STORAGE_KEY_V2);
                localStorage.removeItem(STORAGE_KEY_ORIGIN_V2);
                localStorage.removeItem(STORAGE_KEY_V1);
            } catch (error) {
                // Handle the error here
                console.error('Error accessing localStorage:', error);
            }
        }
    };

    resetAuthToken = function () {
        if (this.env === 'web-worker' || this.env === 'service-worker') {
            throw new Error(
                'Sign out is not permitted from WebWorkers or ServiceWorkers',
            );
        }
        this._clearAuthToken();
        this._emitAuthStateChanged();
    };

    /**
     * Reauth coordinator. Called by the network layer (lib/utils.js) when
     * the backend returns `401 { code: 'reauth_required', reason, auth_id
     * }`.
     *
     * Behavior is environment-specific:
     *
     * - `web` / `app`: clear the stored token, emit an event, and drive the
     *   existing puter.com login popup. Returns a promise that resolves
     *   when the user signs in (so callers can replay) or rejects if reauth
     *   fails / is canceled.
     * - `gui`: no-op — the GUI environment renders its own modal and host
     *   code is responsible for the flow.
     * - Workers / nodejs: there's no UI surface to drive, so reject with a
     *   structured error and let worker code react.
     *
     * Idempotent: parallel callers share a single in-flight promise.
     *
     * @param {{ reason?: string; auth_id?: string }} signal
     */
    triggerReauth = async function (signal = {}) {
        const { reason, auth_id } = signal;
        if (this._reauthInflight) return this._reauthInflight;

        // Emit before clearing so listeners can read state if needed.
        this._emitReauthEvent({ reason, auth_id });

        // Drop the stored token immediately so a failed/canceled reauth
        // doesn't leave a poisoned value in localStorage. The new token
        // (if reauth succeeds) is written by setAuthToken downstream.
        this._clearAuthToken();
        this._emitAuthStateChanged();

        this._reauthInflight = (async () => {
            if (this.env === 'gui') {
                // GUI handles its own modal at the layer above puter-js.
                return;
            }
            if (
                this.env === 'web-worker' ||
                this.env === 'service-worker' ||
                this.env === 'nodejs'
            ) {
                const err = new Error('reauth_required');
                err.code = 'reauth_required';
                err.reason = reason;
                err.auth_id = auth_id;
                throw err;
            }
            if (this.env === 'web') {
                // Drives the puter.com login popup. On success, the
                // postMessage handler at the bottom of this file calls
                // setAuthToken() and updates this.authToken.
                await this.ui.authenticateWithPuter({ auth_id, reason });
                return;
            }
            if (this.env === 'app') {
                try {
                    globalThis.parent?.postMessage?.(
                        {
                            msg: 'reauth_required',
                            appInstanceID: this.appInstanceID,
                            reason,
                            auth_id,
                        },
                        this.defaultGUIOrigin,
                    );
                } catch (e) {
                    // Best-effort: if postMessage isn't available
                    // (sandboxed iframe), fall through to error.
                }
                // Wait for the parent to deliver a fresh token.
                // Validate both event.origin AND event.source — origin
                // alone lets any same-origin frame on the GUI domain
                // deliver a token; pinning source to globalThis.parent
                // ensures the message came from the actual embedder.
                await new Promise((resolve, reject) => {
                    const expectedSource = globalThis.parent;
                    const onToken = (event) => {
                        if (event.origin !== this.defaultGUIOrigin) return;
                        if (
                            expectedSource &&
                            event.source !== expectedSource
                        )
                            return;
                        if (event.data?.msg !== 'puter.token') return;
                        globalThis.removeEventListener('message', onToken);
                        resolve();
                    };
                    globalThis.addEventListener?.('message', onToken);
                    // Give the user a generous window to re-auth.
                    setTimeout(
                        () => {
                            globalThis.removeEventListener?.(
                                'message',
                                onToken,
                            );
                            reject(new Error('reauth_timeout'));
                        },
                        5 * 60 * 1000,
                    );
                });
            }
        })();

        try {
            await this._reauthInflight;
        } finally {
            this._reauthInflight = null;
        }
    };

    /**
     * @param {{
     *     reason?: string;
     *     auth_id?: string;
     *     sentToken?: string;
     * }} signal
     * @internal
     * The non-interactive half of the reauth policy, called by the network
     * layer (lib/networkUtils.js) when a request the user didn't initiate
     * comes back `401 { code: 'reauth_required' | 'token_auth_failed' }`.
     *
     * Boot-time telemetry and cache warmers run on every page load, so
     * escalating their 401 to `triggerReauth` puts a sign-in popup (or the
     * consent dialog, when there's no user activation to open one with) in
     * front of a visitor who did nothing but load the page. Instead: forget
     * the dead token and announce it, leaving the prompt to the next call
     * the user actually makes.
     *
     * `sentToken` is the token the failed request carried. A reauth may have
     * completed while it was in flight, so a token that no longer matches is
     * left alone rather than signing the user back out.
     */
    dropStaleAuthToken = function ({ reason, auth_id, sentToken } = {}) {
        if (sentToken && sentToken !== this.authToken) return;
        this._emitReauthEvent({ reason, auth_id });
        this._clearAuthToken();
        this._emitAuthStateChanged();
    };

    _emitReauthEvent = function ({ reason, auth_id }) {
        try {
            const handlers =
                this.eventHandlers?.['puter.auth.reauth_required'];
            if (Array.isArray(handlers)) {
                for (const h of handlers) {
                    try {
                        h({ reason, auth_id });
                    } catch (e) {
                        /* swallow per-handler errors */
                    }
                }
            }
        } catch (e) {
            // Never let event delivery break the reauth flow itself.
        }
    };

    /**
     * Register a listener for SDK events. Used by host apps to react to
     * `puter.auth.reauth_required`.
     */
    on = function (eventName, handler) {
        if (!this.eventHandlers[eventName])
            this.eventHandlers[eventName] = [];
        this.eventHandlers[eventName].push(handler);
        return () => this.off(eventName, handler);
    };

    off = function (eventName, handler) {
        const handlers = this.eventHandlers[eventName];
        if (!handlers) return;
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
    };

    /**
     * @internal
     * Delete a token left behind under the retired `puter.auth.token` key.
     * The backend no longer honors that format, so a visitor holding one is
     * simply signed out — sending it would only earn a 401, and leaving it
     * in storage would keep tempting later readers.
     */
    discardRetiredAuthToken_ = function () {
        try {
            localStorage.removeItem(STORAGE_KEY_V1);
        } catch (e) {
            // No storage to clean up.
        }
    };

    exit = function (statusCode = 0) {
        if (statusCode && typeof statusCode !== 'number') {
            console.warn(
                'puter.exit() requires status code to be a number. Treating it as 1',
            );
            statusCode = 1;
        }

        globalThis.parent.postMessage(
            {
                msg: 'exit',
                appInstanceID: this.appInstanceID,
                statusCode,
            },
            '*',
        );
    };

    /**
     * A function that generates a domain-safe name by combining a random
     * adjective, a random noun, and a random number (between 0 and 9999).
     * The result is returned as a string with components separated by
     * hyphens. It is useful when you need to create unique identifiers that
     * are also human-friendly.
     *
     * @param {string} [separateWith='-'] - The character to use to separate
     *   the components of the generated name. Default is `'-'`
     * @returns {string} A unique, hyphen-separated string comprising of an
     *   adjective, a noun, and a number.
     */
    randName = function (separateWith = '-') {
        const first_adj = [
            'helpful',
            'sensible',
            'loyal',
            'honest',
            'clever',
            'capable',
            'calm',
            'smart',
            'genius',
            'bright',
            'charming',
            'creative',
            'diligent',
            'elegant',
            'fancy',
            'colorful',
            'avid',
            'active',
            'gentle',
            'happy',
            'intelligent',
            'jolly',
            'kind',
            'lively',
            'merry',
            'nice',
            'optimistic',
            'polite',
            'quiet',
            'relaxed',
            'silly',
            'victorious',
            'witty',
            'young',
            'zealous',
            'strong',
            'brave',
            'agile',
            'bold',
        ];

        const nouns = [
            'street',
            'roof',
            'floor',
            'tv',
            'idea',
            'morning',
            'game',
            'wheel',
            'shoe',
            'bag',
            'clock',
            'pencil',
            'pen',
            'magnet',
            'chair',
            'table',
            'house',
            'dog',
            'room',
            'book',
            'car',
            'cat',
            'tree',
            'flower',
            'bird',
            'fish',
            'sun',
            'moon',
            'star',
            'cloud',
            'rain',
            'snow',
            'wind',
            'mountain',
            'river',
            'lake',
            'sea',
            'ocean',
            'island',
            'bridge',
            'road',
            'train',
            'plane',
            'ship',
            'bicycle',
            'horse',
            'elephant',
            'lion',
            'tiger',
            'bear',
            'zebra',
            'giraffe',
            'monkey',
            'snake',
            'rabbit',
            'duck',
            'goose',
            'penguin',
            'frog',
            'crab',
            'shrimp',
            'whale',
            'octopus',
            'spider',
            'ant',
            'bee',
            'butterfly',
            'dragonfly',
            'ladybug',
            'snail',
            'camel',
            'kangaroo',
            'koala',
            'panda',
            'piglet',
            'sheep',
            'wolf',
            'fox',
            'deer',
            'mouse',
            'seal',
            'chicken',
            'cow',
            'dinosaur',
            'puppy',
            'kitten',
            'circle',
            'square',
            'garden',
            'otter',
            'bunny',
            'meerkat',
            'harp',
        ];

        // return a random combination of first_adj + noun + number (between 0 and 9999)
        // e.g. clever-idea-123
        return (
            first_adj[Math.floor(Math.random() * first_adj.length)] +
            separateWith +
            nouns[Math.floor(Math.random() * nouns.length)] +
            separateWith +
            Math.floor(Math.random() * 10000)
        );
    };

    getUser = function (...args) {
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
            const xhr = utils.initXhr(
                '/whoami',
                this.APIOrigin,
                this.authToken,
                'get',
            );
            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(
                xhr,
                options.success,
                options.error,
                resolve,
                reject,
            );

            xhr.send();
        });
    };

    print = function (...args) {
        // Check if the last argument is an options object with escapeHTML or code property
        let options = {};
        if (
            args.length > 0 &&
            typeof args[args.length - 1] === 'object' &&
            args[args.length - 1] !== null &&
            ('escapeHTML' in args[args.length - 1] ||
                'code' in args[args.length - 1])
        ) {
            options = args.pop();
        }

        for (let arg of args) {
            // Escape HTML if the option is set to true or if code option is true
            if (
                (options.escapeHTML === true || options.code === true) &&
                typeof arg === 'string'
            ) {
                arg = arg
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }

            // Wrap in code/pre tags if code option is true
            if (options.code === true) {
                arg = `<code><pre>${arg}</pre></code>`;
            }

            document.body.innerHTML += arg;
        }
    };

    /**
     * Configures API call logging settings
     *
     * @param {import('./lib/types.js').APILoggingConfig} [config]
     * @returns {this}
     */
    configureAPILogging = function (config = {}) {
        if (this.apiCallLogger) {
            this.apiCallLogger.updateConfig(config);
        }
        return this;
    };

    /**
     * Enables API call logging with optional configuration
     *
     * @param {import('./lib/types.js').APILoggingConfig} [config]
     * @returns {this}
     */
    enableAPILogging = function (config = {}) {
        if (this.apiCallLogger) {
            this.apiCallLogger.updateConfig({ ...config, enabled: true });
        }
        return this;
    };

    /**
     * Disables API call logging
     *
     * @returns {this}
     */
    disableAPILogging = function () {
        if (this.apiCallLogger) {
            this.apiCallLogger.disable();
        }
        return this;
    };

    /**
     * Initializes network connectivity monitoring to purge cache when
     * connection is lost
     *
     * @internal
     */
    initNetworkMonitoring = function () {
        // Only initialize in environments that support navigator.onLine and window events
        if (
            typeof globalThis.navigator === 'undefined' ||
            typeof globalThis.addEventListener !== 'function'
        ) {
            return;
        }

        // Track previous online state
        let wasOnline = navigator.onLine;

        // Function to handle network state changes
        const handleNetworkChange = () => {
            const isOnline = navigator.onLine;

            // If we went from online to offline, purge the cache
            if (wasOnline && !isOnline) {
                console.log('Network connection lost - purging cache');
                try {
                    this._cache.flushall();
                    console.log('Cache purged successfully');
                } catch (error) {
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
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                // Small delay to allow network state to update
                setTimeout(handleNetworkChange, 100);
            });
        }
    };

    /**
     * Prints a styled CTA in the browser console encouraging developers to
     * publish their app on the Puter App Store.
     *
     * @internal
     */
    printDevCTA = function () {
        if (this.quiet || globalThis.PUTER_QUIET) return;
        const isDark =
            globalThis.matchMedia &&
            globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
        const asciiColor = isDark ? '#7c8cff' : '#000fd8';
        const headingColor = isDark ? '#cbd5f5' : 'rgb(0, 57, 137)';
        const linkColor = isDark ? '#93c5fd' : '#3b82f6';
        const mutedColor = isDark ? '#64748b' : '#94a3b8';
        console.log(
            '%c' +
                ' ____  _   _ _____ _____ ____       _ ____  \n' +
                '|  _ \\| | | |_   _| ____|  _ \\     | / ___| \n' +
                '| |_) | | | | | | |  _| | |_) | _  | \\___ \\ \n' +
                '|  __/| |_| | | | | |___|  _ < | |_| |___) |\n' +
                '|_|    \\___/  |_| |_____|_| \\_(_)___/|____/ ',
            `color: ${asciiColor}; font-weight: bold; font-size: 14px; font-family: monospace;`,
        );
        console.log(
            '%cSubmit this app to the Puter App Store:\n' +
                '%chttps://apps.puter.com/',
            `color: ${headingColor}; font-size: 18px; font-weight: bold;`,
            `color: ${linkColor}; font-size: 18px; font-weight: bold; text-decoration: underline;`,
        );
        console.log(
            '%cTo disable this message: %cputer.quiet = true',
            `color: ${mutedColor}; font-size: 11px;`,
            `color: ${mutedColor}; font-size: 11px; font-style: italic;`,
        );
    };

    /**
     * Shows the "Unsupported Protocol" warning dialog when the SDK is
     * loaded directly from the file:// protocol. Runs once on load (when
     * the DOM is ready) so the developer is told to use a web server
     * immediately, instead of only when an action triggers the auth flow.
     *
     * @internal
     */
    warnUnsupportedProtocol = function () {
        if (globalThis.location?.protocol !== 'file:') return;
        if (this._fileProtocolWarned) return;
        this._fileProtocolWarned = true;

        const showDialog = () => {
            // On file:// PuterDialog renders the "Unsupported Protocol"
            // warning instead of the auth consent content.
            const dialog = new PuterDialog(
                () => {},
                () => {},
            );
            document.body.appendChild(dialog);
            dialog.open();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showDialog, {
                once: true,
            });
        } else {
            showDialog();
        }
    };

    /**
     * Checks and updates the GUI FS cache for most-commonly used paths
     *
     * @internal
     */
    checkAndUpdateGUIFScache = function () {
        // only run in gui environment
        if (puter.env !== 'gui') return;
        // only run if user is authenticated
        if (!puter.whoami) return;

        let username = puter.whoami.username;

        // Nothing awaits these refreshes, so a path the user doesn't
        // have — or any transient failure — must not escape as an
        // unhandled rejection.
        const warm = (refresh) => {
            refresh.catch(() => {});
        };

        // common paths
        let home_path = `/${username}`;
        let desktop_path = `/${username}/Desktop`;
        let documents_path = `/${username}/Documents`;
        let public_path = `/${username}/Public`;

        // item:Home
        if (!puter._cache.get(`item:${home_path}`)) {
            console.log(
                `/${username} item is not cached, refetching cache`,
            );
            // fetch home
            warm(puter.fs.stat(home_path));
        }
        // item:Desktop
        if (!puter._cache.get(`item:${desktop_path}`)) {
            console.log(
                `/${username}/Desktop item is not cached, refetching cache`,
            );
            // fetch desktop
            warm(puter.fs.stat(desktop_path));
        }
        // item:Documents
        if (!puter._cache.get(`item:${documents_path}`)) {
            console.log(
                `/${username}/Documents item is not cached, refetching cache`,
            );
            // fetch documents
            warm(puter.fs.stat(documents_path));
        }
        // item:Public
        if (!puter._cache.get(`item:${public_path}`)) {
            console.log(
                `/${username}/Public item is not cached, refetching cache`,
            );
            // fetch public
            warm(puter.fs.stat(public_path));
        }

        // readdir:Home
        if (!puter._cache.get(`readdir:${home_path}`)) {
            console.log(`/${username} is not cached, refetching cache`);
            // fetch home
            warm(puter.fs.readdir(home_path));
        }
        // readdir:Desktop
        if (!puter._cache.get(`readdir:${desktop_path}`)) {
            console.log(
                `/${username}/Desktop is not cached, refetching cache`,
            );
            // fetch desktop
            warm(puter.fs.readdir(desktop_path));
        }
        // readdir:Documents
        if (!puter._cache.get(`readdir:${documents_path}`)) {
            console.log(
                `/${username}/Documents is not cached, refetching cache`,
            );
            // fetch documents
            warm(puter.fs.readdir(documents_path));
        }
        // readdir:Public
        if (!puter._cache.get(`readdir:${public_path}`)) {
            console.log(
                `/${username}/Public is not cached, refetching cache`,
            );
            // fetch public
            warm(puter.fs.readdir(public_path));
        }
    };
}

export const puter = new Puter();
export default puter;
globalThis.puter = puter;
puter.runWhenPuterHappensCallbacks();

/** @type {{ messageTarget: Window }} */
const puterParent = puter.ui.parentApp();
globalThis.puterParent = puterParent;
if (puterParent) {
    console.log('I have a parent, registering tools');
    puterParent.on('message', async (event) => {
        console.log('Got tool req ', event);
        if (event.$ === 'requestTools') {
            console.log('Responding with tools');
            puterParent.postMessage({
                $: 'providedTools',
                tools: JSON.parse(JSON.stringify(puter.tools)),
            });
        }

        if (event.$ === 'executeTool') {
            console.log('xecuting tools');
            /**
             * Puter tools format
             *
             * @type {[
             *     {
             *         exec: Function;
             *         function: {
             *             description: string;
             *             name: string;
             *             parameters: { properties: any; required: string[] };
             *             type: string;
             *         };
             *     },
             * ]}
             */
            const [tool] = puter.tools.filter(
                (e) => e.function.name === event.toolName,
            );

            const response = await tool.exec(event.parameters);
            puterParent.postMessage({
                $: 'toolResponse',
                response,
                tag: event.tag,
            });
        }
    });
    puterParent.postMessage({ $: 'ready' });
}

globalThis.addEventListener &&
    globalThis.addEventListener('message', async (event) => {
        // if the message is not from Puter, then ignore it
        if (event.origin !== puter.defaultGUIOrigin) return;

        if (event.data.msg && event.data.msg === 'requestOrigin') {
            event.source.postMessage(
                {
                    msg: 'originResponse',
                },
                '*',
            );
        } else if (event.data.msg === 'puter.token') {
            // Set the authToken property
            puter.setAuthToken(event.data.token);
            // update appID only when token does not include app identity
            const tokenAppID = puter.getAppIDFromAuthToken(event.data.token);
            if (!tokenAppID && !puter.appID) {
                const fallbackAppID = puter.normalizeStringCandidate(
                    event.data.app_uid,
                );
                if (fallbackAppID) {
                    puter.setAppID(fallbackAppID);
                }
            }

            puter.puterAuthState.authGranted = true;

            // Call onAuth callback
            if (puter.onAuth && typeof puter.onAuth === 'function') {
                puter.getUser().then((user) => {
                    puter.onAuth(user);
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
            }
        }
    });
