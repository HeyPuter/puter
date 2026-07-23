import kvjs from '@heyputer/kv.js';
import APICallLogger from './lib/APICallLogger.js';
import { fetchUrl } from './lib/networkUtils.js';
import { isStoredTokenUsableForOrigin } from './lib/authTokenOrigin.js';
import path from './lib/path.js';
import localStorageMemory from './lib/polyfills/localStorage.js';
import xhrshim from './lib/polyfills/xhrshim.js';
import * as utils from './lib/utils.js';
import { AI } from './modules/ai/index.js';
import Apps from './modules/Apps.js';
import Auth from './modules/Auth.js';
import { Debug } from './modules/Debug.js';
import Drivers from './modules/Drivers.js';
import Email from './modules/Email.js';
import { PuterJSFileSystemModule } from './modules/FileSystem/index.js';
import FSItem from './modules/FSItem.js';
import Hosting from './modules/Hosting.js';
import { KV } from './modules/kv/index.js';
import { PSocket } from './modules/networking/PSocket.js';
import { PTLSSocket } from './modules/networking/PTLS.js';
import { pFetch } from './modules/networking/requests.js';
import OS from './modules/OS.js';
import Perms from './modules/Perms.js';
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

// localStorage keys for the auth token. v1 is the legacy key. v2 is
// the new key written after the token rotation in the v1→v2 cutover.
// Reads prefer v2; v1 is only consulted to drive the silent-migration
// path (access_token / app kinds) or — for kind='web' — to fail over
// to the interactive reauth flow.
const STORAGE_KEY_V1 = 'puter.auth.token';
const STORAGE_KEY_V2 = 'puter.auth.token.v2';
// Records the API origin a stored v2 token was minted against. A stored token
// is only ever replayed to this origin, so a URL-controlled `puter.api_origin`
// can't harvest a previously-stored token and forward it to a foreign origin.
const STORAGE_KEY_ORIGIN_V2 = 'puter.auth.token.origin.v2';

const puterInit = function () {
    'use strict';

    class Puter {
        // The environment that the SDK is running in. Can be 'gui', 'app' or 'web'.
        // 'gui' means the SDK is running in the Puter GUI, i.e. Puter.com.
        // 'app' means the SDK is running as a Puter app, i.e. within an iframe in the Puter GUI.
        // 'web' means the SDK is running in a 3rd-party website.
        env;

        #defaultAPIOrigin = 'https://api.puter.com';
        #defaultGUIOrigin = 'https://puter.com';

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

        // An optional callback when the user is authenticated. This can be set by the app using the SDK.
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
        initSubmodules = function () {
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
            this.registerModule('email', Email);
            this.registerModule('perms', Perms);
            this.registerModule('drivers', Drivers);
            this.registerModule('debug', Debug);
            this.registerModule('peer', Peer);

            // Path
            this.path = path;

            // Register web components for standalone UI fallback
            registerComponents();
        };

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

            // "modules" in puter.js are external interfaces for the developer
            this.modules_ = [];

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
                    let needsSilentMigration = false;
                    if (bootstrapAuthToken) {
                        // URL-param tokens may still be v1 (host apps that
                        // haven't rebuilt yet). Set immediately so submodules
                        // can run, then attempt silent migration in the
                        // background.
                        this.setAuthToken(bootstrapAuthToken);
                        needsSilentMigration = true;
                    } else {
                        // No token in the URL — fall back to a stored token,
                        // but ONLY if it is allowed for the current API origin.
                        // In app mode `puter.api_origin` is URL-controlled, so a
                        // stored token must be bound to (and matched against) the
                        // origin it was minted for. A custom (non-default) origin
                        // additionally requires an explicit binding; an unbound
                        // legacy token is only honored against the default origin.
                        const boundOrigin = this.normalizeStringCandidate(
                            localStorage.getItem(STORAGE_KEY_ORIGIN_V2),
                        );
                        const v2 = this.normalizeAuthTokenCandidate(
                            localStorage.getItem(STORAGE_KEY_V2),
                        );
                        // v1 (legacy) tokens never carry an origin binding.
                        const v1 = v2
                            ? null
                            : this.normalizeAuthTokenCandidate(
                                  localStorage.getItem(STORAGE_KEY_V1),
                              );
                        const storedToken = v2 ?? v1;
                        if (
                            storedToken &&
                            this._storedTokenUsableForCurrentOrigin(
                                v2 ? boundOrigin : null,
                            )
                        ) {
                            this.setAuthToken(storedToken);
                            selectedAuthToken = storedToken;
                            if (v1) needsSilentMigration = true;
                        } else if (storedToken) {
                            // A token exists but is not valid for this API
                            // origin (a URL-supplied custom/attacker origin, or
                            // an unbound legacy token against a custom origin).
                            // Treat as unauthenticated and force a reauth for
                            // this origin instead of replaying the token.
                            this._needsOriginReauth = {
                                reason: 'api_origin_mismatch',
                            };
                        }
                    }
                    if (needsSilentMigration && selectedAuthToken) {
                        // Fire-and-forget. On success, setAuthToken inside the
                        // migration helper updates submodules with the v2
                        // token. On failure the next 401 reauth_required
                        // triggers the interactive flow.
                        this._silentMigrateV1Token(selectedAuthToken);
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
                    // Prefer the v2 storage key. Fall back to v1 and
                    // run a silent migration in the background.
                    const v2 = this.normalizeAuthTokenCandidate(
                        localStorage.getItem(STORAGE_KEY_V2),
                    );
                    if (v2) {
                        this.setAuthToken(v2);
                    } else {
                        const v1 = this.normalizeAuthTokenCandidate(
                            localStorage.getItem(STORAGE_KEY_V1),
                        );
                        if (v1) {
                            this.setAuthToken(v1);
                            // For kind='access_token' the backend will swap
                            // this for a v2 token. For kind='web' it'll
                            // refuse (409) and the next request bounces us
                            // through the reauth popup.
                            this._silentMigrateV1Token(v1);
                        }
                    }
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

            // Add prefix logger (needed to happen after modules are initialized)
            (async () => {
                try {
                    const whoami = await this.auth.whoami();
                    const prefix = `[${
                        whoami?.app_name ?? this.appInstanceID ?? 'HOST'
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

            // Lock to prevent multiple requests to `/rao`
            this.lock_rao_ = new Lock();
            // Promise that resolves when it's okay to request `/rao`
            this.p_can_request_rao_ = Promise.resolve();
            // Flag that indicates if a request to `/rao` has been made
            this.rao_requested_ = false;

            this.net = {
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

            let had_error = false;
            try {
                const resp = await fetchUrl(`${this.APIOrigin}/rao`, {
                    method: 'POST',
                    includePuterAuth: true,
                    headers: {
                        Origin: location.origin, // This is ignored in the browser but needed for workers and nodejs
                    },
                });
                return await resp.json();
            } catch (e) {
                had_error = true;
                console.error(e);
            } finally {
                this.lock_rao_.release();
            }
            if (!had_error) {
                this.rao_requested_ = true;
            }
        }

        registerModule(name, cls, parameters = {}) {
            const instance = new cls(this, parameters);
            instance.puter = this;
            this.modules_.push(name);
            this[name] = instance;
            if (instance._init) instance._init({ puter: this });
        }

        updateSubmodules() {
            // Update submodules with new auth token and API origin
            for (const name of this.modules_) {
                if (!this[name]) continue;
                this[name]?.setAuthToken?.(this.authToken);
                this[name]?.setAPIOrigin?.(this.APIOrigin);
            }
        }

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
                    // Always clear the legacy v1 key on a write — once we
                    // have a v2 token, the v1 one must not linger or it
                    // would be picked up by older code paths.
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
            // reinitialize submodules
            this.updateSubmodules();

            // rao
            this.request_rao_();

            // perform whoami and cache results
            this.getUser().then((user) => {
                this.whoami = user;
            });
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

        setAPIOrigin = function (APIOrigin) {
            this.APIOrigin = APIOrigin;
            // reinitialize submodules
            this.updateSubmodules();
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

        resetAuthToken = function () {
            if (this.env === 'worker' || this.env === 'service-worker') {
                throw new Error(
                    'Sign out is not permitted from WebWorkers or ServiceWorkers',
                );
            }
            this.authToken = null;
            // If the SDK is running on a 3rd-party site or an app, then save the authToken in localStorage
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
            // reinitialize submodules
            this.updateSubmodules();
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
            this.authToken = null;
            if (this.env === 'web' || this.env === 'app') {
                try {
                    localStorage.removeItem(STORAGE_KEY_V2);
                    localStorage.removeItem(STORAGE_KEY_ORIGIN_V2);
                    localStorage.removeItem(STORAGE_KEY_V1);
                } catch (e) {
                    console.error('Error accessing localStorage:', e);
                }
            }
            this.updateSubmodules();

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
         * Best-effort silent v1→v2 token migration via the backend
         * `/auth/migrate-token` endpoint. Used at boot when only a legacy
         * `puter.auth.token` is present; on success the v2 token is set via
         * setAuthToken (which clears the v1 key).
         *
         * Returns true on successful migration, false otherwise. Failures fall
         * through to the existing 401-reauth path: any subsequent API call
         * against the v1 token will receive a `reauth_required` and route
         * through triggerReauth.
         */
        _silentMigrateV1Token = async function (v1Token) {
            if (!v1Token) return false;
            try {
                // The `puter_token_v2` companion cookie set by this
                // endpoint is only consumed by same-origin requests to
                // the GUI origin, and the main domain doesn't serve
                // credentialed CORS — `include` from a third-party app
                // origin fails the preflight outright. Only ask for
                // credentials when we're actually on the GUI origin;
                // everywhere else the JSON token response is all we need.
                const sameOrigin =
                    globalThis.location?.origin === this.defaultGUIOrigin;
                const resp = await fetchUrl(
                    `${this.defaultGUIOrigin}/auth/migrate-token`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${v1Token}`,
                            'Content-Type': 'application/json',
                        },
                        withCredentials: sameOrigin,
                        body: JSON.stringify({}),
                    },
                );
                if (!resp.ok) {
                    // 409 = backend refuses silent migration for this kind
                    // (web sessions). Any caller will then 401 reauth_required
                    // and the interactive flow takes over.
                    return false;
                }
                const data = await resp.json().catch(() => null);
                const token = data?.token;
                if (typeof token === 'string' && token.length > 0) {
                    this.setAuthToken(token);
                    return true;
                }
                return false;
            } catch (e) {
                // Network errors etc. — fall back to reauth on next 401.
                return false;
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
         * @param {Object} config - Configuration options for API call logging
         * @param {boolean} config.enabled - Enable/disable API call logging
         * @param {boolean} config.enabled - Enable/disable API call logging
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
         * @param {Object} config - Optional configuration to apply when
         *   enabling
         */
        enableAPILogging = function (config = {}) {
            if (this.apiCallLogger) {
                this.apiCallLogger.updateConfig({ ...config, enabled: true });
            }
            return this;
        };

        /** Disables API call logging */
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
         * @private
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
         * @private
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
         * @private
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
         * @private
         */
        checkAndUpdateGUIFScache = function () {
            // only run in gui environment
            if (puter.env !== 'gui') return;
            // only run if user is authenticated
            if (!puter.whoami) return;

            let username = puter.whoami.username;

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
                puter.fs.stat(home_path);
            }
            // item:Desktop
            if (!puter._cache.get(`item:${desktop_path}`)) {
                console.log(
                    `/${username}/Desktop item is not cached, refetching cache`,
                );
                // fetch desktop
                puter.fs.stat(desktop_path);
            }
            // item:Documents
            if (!puter._cache.get(`item:${documents_path}`)) {
                console.log(
                    `/${username}/Documents item is not cached, refetching cache`,
                );
                // fetch documents
                puter.fs.stat(documents_path);
            }
            // item:Public
            if (!puter._cache.get(`item:${public_path}`)) {
                console.log(
                    `/${username}/Public item is not cached, refetching cache`,
                );
                // fetch public
                puter.fs.stat(public_path);
            }

            // readdir:Home
            if (!puter._cache.get(`readdir:${home_path}`)) {
                console.log(`/${username} is not cached, refetching cache`);
                // fetch home
                puter.fs.readdir(home_path);
            }
            // readdir:Desktop
            if (!puter._cache.get(`readdir:${desktop_path}`)) {
                console.log(
                    `/${username}/Desktop is not cached, refetching cache`,
                );
                // fetch desktop
                puter.fs.readdir(desktop_path);
            }
            // readdir:Documents
            if (!puter._cache.get(`readdir:${documents_path}`)) {
                console.log(
                    `/${username}/Documents is not cached, refetching cache`,
                );
                // fetch documents
                puter.fs.readdir(documents_path);
            }
            // readdir:Public
            if (!puter._cache.get(`readdir:${public_path}`)) {
                console.log(
                    `/${username}/Public is not cached, refetching cache`,
                );
                // fetch public
                puter.fs.readdir(public_path);
            }
        };
    }

    // Create a new Puter object and return it
    const puterobj = new Puter();

    // Return the Puter object
    return puterobj;
};

export const puter = puterInit();
export default puter;
globalThis.puter = puter;
puter.runWhenPuterHappensCallbacks();

puter.tools = [];
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
            // puterDialog.close();
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
            // Remove the event listener to avoid memory leaks
            // window.removeEventListener('message', messageListener);

            puter.puterAuthState.authGranted = true;
            // Resolve the promise
            // resolve();

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
