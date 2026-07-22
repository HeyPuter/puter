import * as utils from '../lib/utils.js';
import { fetchUrl } from '../lib/networkUtils.js';
import PuterDialog from './PuterDialog.js';
import { hasUserActivation, openAuthPopup } from '../lib/auth-popup.js';

class Auth {
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
    constructor (puter) {
        this.puter = puter;
        this.authToken = puter.authToken;
        this.APIOrigin = puter.APIOrigin;
        this.appID = puter.appID;
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

    signIn = (options) => {
        options = options || {};

        return new Promise((resolve, reject) => {
            const signinsession = crypto.randomUUID();
            const msg_id = this.#messageID++;
            const url = `${puter.defaultGUIOrigin}/action/sign-in?embedded_in_popup=true&msg_id=${msg_id}${window.crossOriginIsolated ? `&cross_origin_isolated=true&signin_session=${signinsession}` : ''}${options.attempt_temp_user_creation ? '&attempt_temp_user_creation=true' : ''}`;

            // Guards against settling the promise more than once across the
            // message, popup-closed, and dialog-cancel code paths.
            let settled = false;
            // Interval id for polling whether the user closed the popup.
            let checkClosed = null;
            // The auth popup window we opened. Pinned as the expected
            // `event.source` when validating the token message.
            let popupWindow = null;

            const cleanup = () => {
                if ( checkClosed ) {
                    clearInterval(checkClosed);
                    checkClosed = null;
                }
                window.removeEventListener('message', messageHandler);
            };

            if ( window.crossOriginIsolated ) {
                (async () => {
                    while (true) {
                        try {
                            const result = await fetchUrl(`${this.APIOrigin}/login/wait`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ session: signinsession }),
                            });

                            if ( result.ok ) {
                                const { auth_token } = await result.json();
                                if (settled) return;
                                settled = true;
                                cleanup();
                                puter.setAuthToken(auth_token);
                                resolve({ success: true, token: auth_token });
                                return '';
                            }
                        } catch {}
                        await new Promise(r => setTimeout(r, 1000));
                    }
                })();
            }
            function messageHandler (e) {
                // Only accept the token from the Puter GUI origin AND from the
                // popup window we opened. Origin alone is insufficient (any
                // frame on the GUI domain could post), so also pin
                // event.source. Mirrors the validated handler in index.js.
                // msg_id binds the message to this attempt.
                if ( e.origin !== puter.defaultGUIOrigin ) {
                    return;
                }
                if ( popupWindow && e.source !== popupWindow ) {
                    return;
                }
                if ( e.data?.msg !== 'puter.token' ) {
                    return;
                }
                if ( e.data?.msg_id != msg_id ) {
                    return;
                }
                if ( settled ) {
                    return;
                }
                settled = true;
                cleanup();

                // remove redundant attributes
                delete e.data.msg_id;
                delete e.data.msg;

                if ( e.data.success ) {
                    // set the auth token
                    puter.setAuthToken(e.data.token);
                    resolve(e.data);
                } else {
                    reject(e.data);
                }
            }
            window.addEventListener('message', messageHandler);

            // Once the popup exists, watch for the user closing it without
            // completing sign-in. `popup` is null if the browser blocked it.
            const watchPopup = (popup) => {
                if ( settled ) {
                    return;
                }
                if ( ! popup ) {
                    settled = true;
                    cleanup();
                    reject({ error: 'popup_blocked', msg: 'The sign-in popup was blocked by the browser.' });
                    return;
                }
                // Record the popup so messageHandler can pin event.source.
                popupWindow = popup;
                checkClosed = setInterval(() => {
                    if ( ! popup.closed ) {
                        return;
                    }
                    clearInterval(checkClosed);
                    checkClosed = null;
                    if ( settled ) {
                        return;
                    }
                    settled = true;
                    cleanup();
                    reject({ error: 'auth_window_closed', msg: 'Authentication window was closed by the user without completing the process.' });
                }, 100);
            };

            if ( hasUserActivation() ) {
                // A user gesture is active — open the popup immediately.
                const popup = openAuthPopup(url);
                if ( !window.crossOriginIsolated ) {
                    // cannot watch in isolated mode
                    watchPopup(popup);
                }
            } else {
                // No user gesture: a popup opened now would be blocked by the
                // browser. Show a consent dialog first; the popup is then
                // opened from the user's click on that dialog, which provides
                // the gesture the browser requires.
                const dialog = new PuterDialog(() => {}, () => {}, {
                    popupURL: url,
                    onLaunch: (popup) => watchPopup(popup),
                    onCancel: () => {
                        if ( settled ) {
                            return;
                        }
                        settled = true;
                        cleanup();
                        reject({ error: 'auth_window_closed', msg: 'Authentication window was closed by the user without completing the process.' });
                    },
                });
                document.body.appendChild(dialog);
                dialog.open();
            }
        });
    };

    isSignedIn = () => {
        if ( puter.authToken )
        {
            return true;
        }
        else
        {
            return false;
        }
    };

    getUser = function (...args) {
        if ( ! puter.authToken ) {
            // Fake the server response for backwards compatibility
            // We already know this will fail
            throw {
                'status': 401,
                'message': 'Unauthorized',
            };
        }
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
            const xhr = utils.initXhr('/whoami', puter.APIOrigin, puter.authToken, 'get');

            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(xhr, options.success, options.error, resolve, reject);

            xhr.send();
        });
    };

    signOut = () => {
        puter.resetAuthToken();
    };

    async whoami () {
        if ( ! this.authToken ) {
            // Fake the server response for backwards compatibility
            // We already know this will fail
            throw {
                'status': 401,
                'message': 'Unauthorized',
            };
        }

        const resp = await fetchUrl(`${this.APIOrigin}/whoami`, {
            includePuterAuth: true,
            logContext: { service: 'auth', operation: 'whoami', params: {} },
        });
        return await resp.json();
    }

    async getMonthlyUsage () {
        const resp = await fetchUrl(`${this.APIOrigin}/metering/usage`, {
            includePuterAuth: true,
            logContext: { service: 'auth', operation: 'usage', params: {} },
        });
        return await resp.json();
    }

    async getDetailedAppUsage (appId) {
        if ( ! appId ) {
            throw new Error('appId is required');
        }

        const resp = await fetchUrl(`${this.APIOrigin}/metering/usage/${appId}`, {
            includePuterAuth: true,
            logContext: { service: 'auth', operation: 'detailed_app_usage', params: { appId } },
        });
        return await resp.json();
    }

    async getGlobalUsage () {
        const resp = await fetchUrl(`${this.APIOrigin}/metering/globalUsage`, {
            includePuterAuth: true,
            logContext: { service: 'auth', operation: 'global_usage', params: {} },
        });
        return await resp.json();
    }
}

export default Auth;
