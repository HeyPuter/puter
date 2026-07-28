import EventListener from '../lib/EventListener.js';
import { hasUserActivation, openAuthPopup } from '../lib/auth-popup.js';
import FSItem from './FSItem.js';
import PuterDialog from './PuterDialog.js';

/** @typedef {import('../../types/modules/ui').AlertButton} AlertButton */
/** @typedef {import('../../types/modules/ui').AlertOptions} AlertOptions */
/** @typedef {import('../../types/modules/ui').AppConnection} AppConnection */
/** @typedef {import('../../types/modules/ui').ColorPickerOptions} ColorPickerOptions */
/** @typedef {import('../../types/modules/ui').ConnectionEvent} ConnectionEvent */
/** @typedef {import('../../types/modules/ui').ContextMenuOptions} ContextMenuOptions */
/** @typedef {import('../../types/modules/ui').FontPickerOptions} FontPickerOptions */
/** @typedef {import('../../types/modules/ui').LaunchAppOptions} LaunchAppOptions */
/** @typedef {import('../../types/modules/ui').MenubarOptions} MenubarOptions */
/** @typedef {import('../../types/modules/ui').ThemeData} ThemeData */
/** @typedef {import('../../types/modules/ui').NotificationOptions} NotificationOptions */
/** @typedef {import('../../types/modules/ui').WindowHandle} WindowHandle */
/** @typedef {import('../../types/modules/ui').WindowOptions} WindowOptions */

const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const FILE_SAVE_CANCELLED = Symbol('FILE_SAVE_CANCELLED');
const FILE_OPEN_CANCELLED = Symbol('FILE_OPEN_CANCELLED');

// AppConnection provides an API for interacting with another app.
// It's returned by UI methods, and cannot be constructed directly by user code.
// For basic usage:
// - postMessage(message)        Send a message to the target app
// - on('message', callback)     Listen to messages from the target app
class AppConnection extends EventListener {
    // targetOrigin for postMessage() calls to Puter
    #puterOrigin = '*';

    // Whether the target app is open
    #isOpen;

    // Whether the target app uses the Puter SDK, and so accepts messages
    // (Closing and close events will still function.)
    #usesSDK;

    /**
     * Extra information the target app supplied when the connection was
     * established. Declared here because `from()` sets it on the instance.
     *
     * @type {(Record<string, unknown> & { launchResult?: import('../../types/modules/ui').LaunchAppResult }) | undefined}
     */
    response;

    static from (values, puter, { messageTarget, appInstanceID }) {
        const connection = new AppConnection(puter, {
            target: values.appInstanceID,
            usesSDK: values.usesSDK,
            messageTarget,
            appInstanceID,
        });

        // When a connection is established the app is able to
        // provide some additional information about itself
        connection.response = values.response;

        return connection;
    }

    constructor (puter, { target, usesSDK, messageTarget, appInstanceID }) {
        super([
            'message', // The target sent us something with postMessage()
            'close', // The target app was closed
        ]);
        this.messageTarget = messageTarget;
        this.appInstanceID = appInstanceID;
        this.targetAppInstanceID = target;
        this.#isOpen = true;
        this.#usesSDK = usesSDK;

        this.log = puter.logger.fields({
            category: 'ipc',
        });
        this.log.fields({
            cons_source: appInstanceID,
            source: puter.appInstanceID,
            target,
        }).info(`AppConnection created to ${target}`, this);

        // TODO: Set this.#puterOrigin to the puter origin

        (globalThis.document) && window.addEventListener('message', event => {
            if ( event.data.msg === 'messageToApp' ) {
                if ( event.data.appInstanceID !== this.targetAppInstanceID ) {
                    // Message is from a different AppConnection; ignore it.
                    return;
                }
                // TODO: does this check really make sense?
                if ( event.data.targetAppInstanceID !== this.appInstanceID ) {
                    console.error(`AppConnection received message intended for wrong app! appInstanceID=${this.appInstanceID}, target=${event.data.targetAppInstanceID}`);
                    return;
                }
                this.emit('message', event.data.contents);
                return;
            }

            if ( event.data.msg === 'appClosed' ) {
                if ( event.data.appInstanceID !== this.targetAppInstanceID ) {
                    // Message is from a different AppConnection; ignore it.
                    return;
                }

                this.#isOpen = false;
                this.emit('close', {
                    appInstanceID: this.targetAppInstanceID,
                    statusCode: event.data.statusCode,
                });
            }
        });
    }

    /**
     * Whether the target app uses the Puter SDK. If it doesn't, messaging is
     * unavailable.
     *
     * @returns {boolean}
     */
    get usesSDK () {
        return this.#usesSDK;
    }

    /**
     * Sends a message to the target app. Does nothing — beyond a console
     * warning — if the target isn't using the SDK, or the connection has
     * already closed.
     *
     * @param {unknown} message
     * @returns {void}
     */
    postMessage (message) {
        if ( ! this.#isOpen ) {
            console.warn('Trying to post message on a closed AppConnection');
            return;
        }

        if ( ! this.#usesSDK ) {
            console.warn('Trying to post message to a non-SDK app');
            return;
        }

        this.messageTarget.postMessage({
            msg: 'messageToApp',
            appInstanceID: this.appInstanceID,
            targetAppInstanceID: this.targetAppInstanceID,
            // Note: there was a TODO comment here about specifying the origin,
            // but this should not happen here; the origin should be specified
            // on the other side where the expected origin for the app is known.
            targetAppOrigin: '*',
            contents: message,
        }, this.#puterOrigin);
    }

    /**
     * Attempts to close the target app. An app may close apps it launched
     * itself; without that permission, or once already closed, this does
     * nothing beyond a console warning.
     *
     * @returns {void}
     */
    close () {
        if ( ! this.#isOpen ) {
            console.warn('Trying to close an app on a closed AppConnection');
            return;
        }

        this.messageTarget.postMessage({
            msg: 'closeApp',
            appInstanceID: this.appInstanceID,
            targetAppInstanceID: this.targetAppInstanceID,
        }, this.#puterOrigin);
    }
}

class UI extends EventListener {
    // Used to generate a unique message id for each message sent to the host environment
    // we start from 1 because 0 is falsy and we want to avoid that for the message id
    #messageID = 1;

    // Holds the callback functions for the various events
    // that are triggered when a watched item has changed.
    itemWatchCallbackFunctions = [];

    // Holds the unique app instance ID that is provided by the host environment
    appInstanceID;

    // Holds the unique app instance ID for the parent (if any), which is provided by the host environment
    parentInstanceID;

    // If we have a parent app, holds an AppConnection to it
    #parentAppConnection = null;

    // Holds the callback functions for the various events
    // that can be triggered by the host environment's messages.
    #callbackFunctions = [];

    // onWindowClose() is executed right before the window is closed. Users can override this function
    // to perform a variety of tasks right before window is closed. Users can override this function.
    #onWindowClose;

    // When an item is opened by this app in any way onItemsOpened() is executed. Users can override this function.
    #onItemsOpened;

    #onLaunchedWithItems;

    // List of events that can be listened to.
    #eventNames;

    // The most recent value that we received for a given broadcast, by name.
    #lastBroadcastValue = new Map(); // name -> data

    #overlayActive = false;
    #overlayTimer = null;

    // Replaces boilerplate for most methods: posts a message to the GUI with a unique ID, and sets a callback for it.
    #postMessageWithCallback (name, resolve, args = {}) {
        const msg_id = this.#messageID++;
        this.messageTarget?.postMessage({
            msg: name,
            env: this.env,
            appInstanceID: this.appInstanceID,
            uuid: msg_id,
            ...args,
        }, '*');
        //register callback
        this.#callbackFunctions[msg_id] = (...a) => {
            resolve(...a);
        };
    }

    #postMessageAsync (name, args = {}) {
        return new Promise(resolve => {
            this.#postMessageWithCallback(name, resolve, args);
        });
    }

    #postMessageWithObject (name, value) {
        const dehydrator = this.util.rpc.getDehydrator({
            target: this.messageTarget,
        });
        this.messageTarget?.postMessage({
            msg: name,
            env: this.env,
            appInstanceID: this.appInstanceID,
            value: dehydrator.dehydrate(value),
        }, '*');
    };

    async #ipc_stub ({
        callback,
        method,
        parameters,
    }) {
        let p, resolve;
        await new Promise(done_setting_resolve => {
            p = new Promise(resolve_ => {
                resolve = resolve_;
                done_setting_resolve();
            });
        });
        const callback_id = this.util.rpc.registerCallback(resolve);
        this.messageTarget?.postMessage({
            $: 'puter-ipc',
            v: 2,
            appInstanceID: this.appInstanceID,
            env: this.env,
            msg: method,
            parameters,
            uuid: callback_id,
        }, '*');
        const ret = await p;
        if ( callback ) callback(ret);
        return ret;
    };

    // Read live off the owning instance rather than copied, so it reflects a
    // sign-in that happens after the module was constructed. UI can't extend
    // PuterModule because it already extends EventListener.
    get authToken () {
        return this.puter.authToken;
    }

    constructor (puter, { appInstanceID, parentInstanceID }) {
        const eventNames = [
            'localeChanged',
            'themeChanged',
            'connection',
        ];
        super(eventNames);
        this.#eventNames = eventNames;
        this.puter = puter;
        this.appInstanceID = appInstanceID;
        this.parentInstanceID = parentInstanceID;
        this.appID = puter.appID;
        this.env = puter.env;
        this.util = puter.util;

        if ( this.env === 'app' ) {
            this.messageTarget = window.parent;
        }
        else if ( this.env === 'gui' ) {
            return;
        }

        if ( this.parentInstanceID ) {
            this.#parentAppConnection = new AppConnection(this.puter, {
                target: this.parentInstanceID,
                usesSDK: true,
                messageTarget: this.messageTarget,
                appInstanceID: this.appInstanceID,
            });
        }

        // Tell the host environment that this app is using the Puter SDK and is ready to receive messages,
        // this will allow the OS to send custom messages to the app
        this.messageTarget?.postMessage({
            msg: 'READY',
            appInstanceID: this.appInstanceID,
        }, '*');

        // When this app's window is focused send a message to the host environment
        (globalThis.document) && window.addEventListener('focus', (e) => {
            this.messageTarget?.postMessage({
                msg: 'windowFocused',
                appInstanceID: this.appInstanceID,
            }, '*');
        });

        // Bind the message event listener to the window
        let lastDraggedOverElement = null;
        (globalThis.document) && window.addEventListener('message', async (e) => {
            if ( ! e.data ) return;
            // `error`
            if ( e.data.error ) {
                throw e.data.error;
            }
            // `focus` event
            else if ( e.data.msg && e.data.msg === 'focus' ) {
                window.focus();
            }
            // `click` event
            else if ( e.data.msg && e.data.msg === 'click' ) {
                // Get the element that was clicked on and click it
                const clicked_el = document.elementFromPoint(e.data.x, e.data.y);
                if ( clicked_el !== null )
                {
                    clicked_el.click();
                }
            }
            // `dragover` event based on the `drag` event from the host environment
            else if ( e.data.msg && e.data.msg === 'drag' ) {
                // Get the element being dragged over
                const draggedOverElement = document.elementFromPoint(e.data.x, e.data.y);
                if ( draggedOverElement !== lastDraggedOverElement ) {
                    // If the last element exists and is different from the current, dispatch a dragleave on it
                    if ( lastDraggedOverElement ) {
                        const dragLeaveEvent = new Event('dragleave', {
                            bubbles: true,
                            cancelable: true,
                            clientX: e.data.x,
                            clientY: e.data.y,
                        });
                        lastDraggedOverElement.dispatchEvent(dragLeaveEvent);
                    }
                    // If the current element exists and is different from the last, dispatch dragenter on it
                    if ( draggedOverElement ) {
                        const dragEnterEvent = new Event('dragenter', {
                            bubbles: true,
                            cancelable: true,
                            clientX: e.data.x,
                            clientY: e.data.y,
                        });
                        draggedOverElement.dispatchEvent(dragEnterEvent);
                    }

                    // Update the lastDraggedOverElement
                    lastDraggedOverElement = draggedOverElement;
                }
            }
            // `drop` event
            else if ( e.data.msg && e.data.msg === 'drop' ) {
                if ( lastDraggedOverElement ) {
                    const dropEvent = new CustomEvent('drop', {
                        bubbles: true,
                        cancelable: true,
                        detail: {
                            clientX: e.data.x,
                            clientY: e.data.y,
                            items: e.data.items,
                        },
                    });
                    lastDraggedOverElement.dispatchEvent(dropEvent);

                    // Reset the lastDraggedOverElement
                    lastDraggedOverElement = null;
                }
            }
            // windowWillClose
            else if ( e.data.msg === 'windowWillClose' ) {
                // If the user has not overridden onWindowClose() then send a message back to the host environment
                // to let it know that it is ok to close the window.
                if ( this.#onWindowClose === undefined ) {
                    this.messageTarget?.postMessage({
                        msg: true,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');
                }
                // If the user has overridden onWindowClose() then send a message back to the host environment
                // to let it know that it is NOT ok to close the window. Then execute onWindowClose() and the user will
                // have to manually close the window.
                else {
                    this.messageTarget?.postMessage({
                        msg: false,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');
                    this.#onWindowClose();
                }
            }
            // itemsOpened
            else if ( e.data.msg === 'itemsOpened' ) {
                // If the user has not overridden onItemsOpened() then only send a message back to the host environment
                if ( this.#onItemsOpened === undefined ) {
                    this.messageTarget?.postMessage({
                        msg: true,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');
                }
                // If the user has overridden onItemsOpened() then send a message back to the host environment
                // and execute onItemsOpened()
                else {
                    this.messageTarget?.postMessage({
                        msg: false,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');

                    let items = [];
                    if ( e.data.items.length > 0 ) {
                        for ( let index = 0; index < e.data.items.length; index++ )
                        {
                            items.push(new FSItem(e.data.items[index]));
                        }
                    }
                    this.#onItemsOpened(items);
                }
            }
            // getAppDataSucceeded
            else if ( e.data.msg === 'getAppDataSucceeded' ) {
                let appDataItem = new FSItem(e.data.item);
                if ( e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id] ) {
                    this.#callbackFunctions[e.data.original_msg_id](appDataItem);
                }
            }
            // instancesOpenSucceeded
            else if ( e.data.msg === 'instancesOpenSucceeded' ) {
                if ( e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id] ) {
                    this.#callbackFunctions[e.data.original_msg_id](e.data.instancesOpen);
                }
            }
            // readAppDataFileSucceeded
            else if ( e.data.msg === 'readAppDataFileSucceeded' ) {
                let appDataItem = new FSItem(e.data.item);
                if ( e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id] ) {
                    this.#callbackFunctions[e.data.original_msg_id](appDataItem);
                }
            }
            // readAppDataFileFailed
            else if ( e.data.msg === 'readAppDataFileFailed' ) {
                if ( e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id] ) {
                    this.#callbackFunctions[e.data.original_msg_id](null);
                }
            }
            // Determine if this is a response to a previous message and if so, is there
            // a callback function for this message? if answer is yes to both then execute the callback
            else if ( e.data.original_msg_id !== undefined && this.#callbackFunctions[e.data.original_msg_id] ) {
                if ( e.data.msg === 'fileOpenPicked' ) {
                    // 1 item returned
                    if ( e.data.items.length === 1 ) {
                        this.#callbackFunctions[e.data.original_msg_id](new FSItem(e.data.items[0]));
                    }
                    // multiple items returned
                    else if ( e.data.items.length > 1 ) {
                        // multiple items returned
                        let items = [];
                        for ( let index = 0; index < e.data.items.length; index++ )
                        {
                            items.push(new FSItem(e.data.items[index]));
                        }
                        this.#callbackFunctions[e.data.original_msg_id](items);
                    }
                }
                else if ( e.data.msg === 'directoryPicked' ) {
                    // 1 item returned
                    if ( e.data.items.length === 1 ) {
                        this.#callbackFunctions[e.data.original_msg_id](new FSItem({
                            uid: e.data.items[0].uid,
                            name: e.data.items[0].fsentry_name,
                            path: e.data.items[0].path,
                            readURL: e.data.items[0].read_url,
                            writeURL: e.data.items[0].write_url,
                            metadataURL: e.data.items[0].metadata_url,
                            isDirectory: true,
                            size: e.data.items[0].fsentry_size,
                            accessed: e.data.items[0].fsentry_accessed,
                            modified: e.data.items[0].fsentry_modified,
                            created: e.data.items[0].fsentry_created,
                        }));
                    }
                    // multiple items returned
                    else if ( e.data.items.length > 1 ) {
                        // multiple items returned
                        let items = [];
                        for ( let index = 0; index < e.data.items.length; index++ )
                        {
                            items.push(new FSItem(e.data.items[index]));
                        }
                        this.#callbackFunctions[e.data.original_msg_id](items);
                    }
                }
                else if ( e.data.msg === 'colorPicked' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.color);
                }
                else if ( e.data.msg === 'fontPicked' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.font);
                }
                else if ( e.data.msg === 'alertResponded' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.response);
                }
                else if ( e.data.msg === 'promptResponded' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.response);
                }
                else if ( e.data.msg === 'notificationShown' ) {
                    this.#callbackFunctions[e.data.original_msg_id](e.data.uid);
                }
                else if ( e.data.msg === 'languageReceived' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.language);
                }
                else if ( e.data.msg === 'fileSaved' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](new FSItem(e.data.saved_file));
                }
                else if ( e.data.msg === 'fileSaveCancelled' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](FILE_SAVE_CANCELLED);
                }
                else if ( e.data.msg === 'fileOpenCancelled' ) {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](FILE_OPEN_CANCELLED);
                }
                else {
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data);
                }

                //remove this callback function since it won't be needed again
                delete this.#callbackFunctions[e.data.original_msg_id];
            }
            // Item Watch response
            else if ( e.data.msg === 'itemChanged' && e.data.data && e.data.data.uid ) {
                //excute callback
                if ( this.itemWatchCallbackFunctions[e.data.data.uid] && typeof this.itemWatchCallbackFunctions[e.data.data.uid] === 'function' )
                {
                    this.itemWatchCallbackFunctions[e.data.data.uid](e.data.data);
                }
            }
            // Broadcasts
            else if ( e.data.msg === 'broadcast' ) {
                const { name, data } = e.data;
                if ( ! this.#eventNames.includes(name) ) {
                    return;
                }
                this.emit(name, data);
                this.#lastBroadcastValue.set(name, data);
            }
            else if ( e.data.msg === 'connection' ) {
                e.data.usesSDK = true; // we can safely assume this
                const conn = AppConnection.from(e.data, this.puter, {
                    messageTarget: this.messageTarget,
                    appInstanceID: this.appInstanceID,
                });
                const accept = value => {
                    this.messageTarget?.postMessage({
                        $: 'connection-resp',
                        connection: e.data.appInstanceID,
                        accept: true,
                        value,
                    }, '*');
                };
                const reject = value => {
                    this.messageTarget?.postMessage({
                        $: 'connection-resp',
                        connection: e.data.appInstanceID,
                        accept: false,
                        value,
                    }, '*');
                };
                this.emit('connection', {
                    conn, accept, reject,
                });
            }
        });

        // We need to send the mouse position to the host environment
        // This is important since a lot of UI elements depend on the mouse position (e.g. ContextMenus, Tooltips, etc.)
        // and the host environment needs to know the mouse position to show these elements correctly.
        // The host environment can't just get the mouse position since when the mouse is over an iframe it
        // will not be able to get the mouse position. So we need to send the mouse position to the host environment.
        globalThis.document?.addEventListener('mousemove', async (event) => {
            // Get the mouse position from the event object
            this.mouseX = event.clientX;
            this.mouseY = event.clientY;

            // send the mouse position to the host environment
            this.messageTarget?.postMessage({
                msg: 'mouseMoved',
                appInstanceID: this.appInstanceID,
                x: this.mouseX,
                y: this.mouseY,
            }, '*');
        });

        // click
        globalThis.document?.addEventListener('click', async (event) => {
            // Get the mouse position from the event object
            this.mouseX = event.clientX;
            this.mouseY = event.clientY;

            // send the mouse position to the host environment
            this.messageTarget?.postMessage({
                msg: 'mouseClicked',
                appInstanceID: this.appInstanceID,
                x: this.mouseX,
                y: this.mouseY,
            }, '*');
        });
    }

    /**
     * Registers a function to run when the window is about to close. Not
     * called when the app exits through `puter.exit()`.
     *
     * @param {() => void} callback
     * @returns {void}
     */
    onWindowClose (callback) {
        this.#onWindowClose = callback;
    };

    /**
     * Registers a handler for items this app was launched with.
     *
     * @deprecated Also fires when items are dropped on the app; handle the
     * `drop` event instead.
     * @param {(items: FSItem[]) => void} callback
     * @returns {void}
     */
    onItemsOpened (callback) {
        // DEPRECATED - this is also called when items are dropped on the app, which in new versions should be handled
        // with the 'drop' event.
        // Check if a file was opened with this app, i.e. check URL parameters of window/iframe
        // Even though the file has been opened when the app is launched, we need to wait for the onItemsOpened callback to be set
        // before we can call it. This is why we need to check the URL parameters here.
        // This should also be done only the very first time the callback is set (hence the if(!this.#onItemsOpened) check) since
        // the URL parameters will be checked every time the callback is set which can cause problems if the callback is set multiple times.
        if ( ! this.#onItemsOpened ) {
            let URLParams = new URLSearchParams(globalThis.location.search);
            if ( URLParams.has('puter.item.name') && URLParams.has('puter.item.uid') && URLParams.has('puter.item.read_url') ) {
                let fpath = URLParams.get('puter.item.path');

                if ( !fpath.startsWith('~/') && !fpath.startsWith('/') )
                {
                    fpath = `~/${fpath}`;
                }

                callback([new FSItem({
                    name: URLParams.get('puter.item.name'),
                    path: fpath,
                    uid: URLParams.get('puter.item.uid'),
                    readURL: URLParams.get('puter.item.read_url'),
                    writeURL: URLParams.get('puter.item.write_url'),
                    metadataURL: URLParams.get('puter.item.metadata_url'),
                    size: URLParams.get('puter.item.size'),
                    accessed: URLParams.get('puter.item.accessed'),
                    modified: URLParams.get('puter.item.modified'),
                    created: URLParams.get('puter.item.created'),
                })]);
            }
        }

        this.#onItemsOpened = callback;
    };

    // Check if the app was launched with items
    // This is useful for apps that are launched with items (e.g. when a file is opened with the app)
    /**
     * Whether the app was launched to open one or more items — by
     * double-clicking a file, the 'Open With…' menu, and so on.
     *
     * @returns {boolean}
     */
    wasLaunchedWithItems () {
        const URLParams = new URLSearchParams(globalThis.location.search);
        return URLParams.has('puter.item.name') &&
            URLParams.has('puter.item.uid') &&
            URLParams.has('puter.item.read_url');
    };

    /**
     * Registers a handler called with the items the app was launched with,
     * each a file or a directory.
     *
     * @param {(items: FSItem[]) => void} callback
     * @returns {void}
     */
    onLaunchedWithItems (callback) {
        // Check if a file was opened with this app, i.e. check URL parameters of window/iframe
        // Even though the file has been opened when the app is launched, we need to wait for the onLaunchedWithItems callback to be set
        // before we can call it. This is why we need to check the URL parameters here.
        // This should also be done only the very first time the callback is set (hence the if(!this.#onLaunchedWithItems) check) since
        // the URL parameters will be checked every time the callback is set which can cause problems if the callback is set multiple times.
        if ( ! this.#onLaunchedWithItems ) {
            let URLParams = new URLSearchParams(globalThis.location.search);
            if ( URLParams.has('puter.item.name') && URLParams.has('puter.item.uid') && URLParams.has('puter.item.read_url') ) {
                let fpath = URLParams.get('puter.item.path');

                if ( !fpath.startsWith('~/') && !fpath.startsWith('/') )
                {
                    fpath = `~/${fpath}`;
                }

                callback([new FSItem({
                    name: URLParams.get('puter.item.name'),
                    path: fpath,
                    uid: URLParams.get('puter.item.uid'),
                    readURL: URLParams.get('puter.item.read_url'),
                    writeURL: URLParams.get('puter.item.write_url'),
                    metadataURL: URLParams.get('puter.item.metadata_url'),
                    size: URLParams.get('puter.item.size'),
                    accessed: URLParams.get('puter.item.accessed'),
                    modified: URLParams.get('puter.item.modified'),
                    created: URLParams.get('puter.item.created'),
                })]);
            }
        }

        this.#onLaunchedWithItems = callback;
    };

    /**
     * Asks the desktop to walk the user through confirming their email.
     * Resolves once the dialog closes.
     *
     * @returns {Promise<unknown>}
     */
    requestEmailConfirmation () {
        return new Promise((resolve, reject) => {
            this.#postMessageWithCallback('requestEmailConfirmation', resolve, { });
        });
    };

    /**
     * Shows an alert dialog, blocking the parent window until the user picks a
     * button. Resolves to that button's `value`, or its `label` when no value
     * is set. `callback` is vestigial and never invoked.
     *
     * @param {string} [message]
     * @param {AlertButton[]} [buttons]
     * @param {AlertOptions} [options]
     * @param {unknown} [callback] ignored
     * @returns {Promise<string>}
     */
    alert (message, buttons, options, callback) {
        if ( this.messageTarget ) {
            return new Promise((resolve) => {
                this.#postMessageWithCallback('ALERT', resolve, { message, buttons, options });
            });
        }
        // Standalone fallback: render web component
        return new Promise((resolve) => {
            const el = document.createElement('puter-alert');
            el.setAttribute('message', message || '');
            el.buttons = buttons;
            el.options = options;
            el.addEventListener('response', (e) => resolve(e.detail));
            document.body.appendChild(el);
            el.open();
        });
    };

    /**
     * Opens the developer payments account page. Resolves once the desktop
     * acknowledges the request.
     *
     * @returns {Promise<unknown>}
     */
    openDevPaymentsAccount () {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('openDevPaymentsAccount', resolve, { });
        });
    }

    /**
     * Resolves to the instances of this app that are currently open.
     * `callback` is vestigial and never invoked.
     *
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    instancesOpen (callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('getInstancesOpen', resolve, { });
        });
    };

    /**
     * Shows a dialog for sharing a link to social platforms. `callback` is
     * vestigial and never invoked.
     *
     * @param {string} url
     * @param {string} [message] prefilled post text, where the platform supports it
     * @param {{ left?: number, top?: number }} [options] dialog position; both default to 0
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    socialShare (url, message, options, callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('socialShare', resolve, { url, message, options });
        });
    };

    /**
     * Shows a prompt dialog, blocking the parent window until the user
     * responds. Resolves to the entered value, or `false` if they cancel.
     * `callback` is vestigial and never invoked.
     *
     * @param {string} [message]
     * @param {string} [placeholder]
     * @param {{ defaultValue?: string }} [options]
     * @param {unknown} [callback] ignored
     * @returns {Promise<string | false>}
     */
    prompt (message, placeholder, options, callback) {
        if ( this.messageTarget ) {
            return new Promise((resolve) => {
                this.#postMessageWithCallback('PROMPT', resolve, { message, placeholder, options });
            });
        }
        // Standalone fallback: render web component
        return new Promise((resolve) => {
            const el = document.createElement('puter-prompt');
            if ( message ) el.setAttribute('message', message);
            if ( placeholder ) el.setAttribute('placeholder', placeholder);
            if ( options?.defaultValue ) el.setAttribute('default-value', options.defaultValue);
            el.options = options;
            el.addEventListener('response', (e) => resolve(e.detail));
            document.body.appendChild(el);
            el.open();
        });
    };

    /**
     * Shows a desktop notification. Resolves to its uid.
     *
     * @param {NotificationOptions} [options]
     * @returns {Promise<string>}
     */
    notify (options) {
        if ( this.messageTarget ) {
            return new Promise((resolve) => {
                const normalized = { ...(options ?? {}) };
                if ( normalized.roundIcon !== undefined && normalized.round_icon === undefined ) {
                    normalized.round_icon = normalized.roundIcon;
                }
                this.#postMessageWithCallback('showNotification', resolve, { options: normalized });
            });
        }
        // Standalone fallback: render web component
        return new Promise((resolve) => {
            const opts = options ?? {};
            const el = document.createElement('puter-notification');
            if ( opts.title ) el.setAttribute('title', opts.title);
            if ( opts.text ) el.setAttribute('text', opts.text);
            if ( opts.icon ) el.setAttribute('icon', opts.icon);
            if ( opts.type ) el.setAttribute('type', opts.type);
            if ( opts.round_icon || opts.roundIcon ) el.setAttribute('round-icon', '');
            if ( opts.duration !== undefined ) el.setAttribute('duration', String(opts.duration));
            el.addEventListener('close', () => resolve(opts.uid || null));
            document.body.appendChild(el);
            resolve(opts.uid || null);
        });
    };

    /**
     * Shows a directory picker over the user's Puter storage. Resolves to one
     * `FSItem`, or an array of them when multiple selection is allowed.
     *
     * @param {{ multiple?: boolean }} [options]
     * @param {(value: FSItem | FSItem[]) => void} [callback]
     * @returns {Promise<FSItem | FSItem[]>}
     */
    showDirectoryPicker (options, callback) {
        return new Promise((resolve, reject) => {
            if ( ! globalThis.open ) {
                return reject('This API is not compatible in Web Workers.');
            }

            const msg_id = this.#messageID++;
            if ( this.env === 'app' ) {
                this.messageTarget?.postMessage({
                    msg: 'showDirectoryPicker',
                    appInstanceID: this.appInstanceID,
                    uuid: msg_id,
                    options: options,
                    env: this.env,
                }, '*');
            } else {
                let w = 700;
                let h = 400;
                let title = 'Puter: Open Directory';
                var left = (screen.width / 2) - (w / 2);
                var top = (screen.height / 2) - (h / 2);
                window.open(
                    `${puter.defaultGUIOrigin}/action/show-directory-picker?embedded_in_popup=true&msg_id=${msg_id}&appInstanceID=${this.appInstanceID}&env=${this.env}&options=${JSON.stringify(options)}`,
                    title,
                    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`,
                );
            }

            //register callback
            this.#callbackFunctions[msg_id] = resolve;
        });
    };

    /**
     * Shows a file picker over the user's Puter storage. Resolves to one
     * `FSItem`, or an array of them when multiple selection is allowed. The
     * returned promise also carries `undefinedOnCancel`, which resolves to
     * `undefined` instead of staying pending when the user cancels.
     *
     * @param {{ multiple?: boolean, accept?: string }} [options]
     * @param {(value: FSItem | FSItem[]) => void} [callback]
     * @returns {Promise<FSItem | FSItem[]>}
     */
    showOpenFilePicker (options, callback) {
        const undefinedOnCancel = createDeferred();
        const resolveOnlyPromise = new Promise((resolve, reject) => {
            if ( ! globalThis.open ) {
                return reject('This API is not compatible in Web Workers.');
            }

            const msg_id = this.#messageID++;

            if ( this.env === 'app' ) {
                this.messageTarget?.postMessage({
                    msg: 'showOpenFilePicker',
                    appInstanceID: this.appInstanceID,
                    uuid: msg_id,
                    options: options ?? {},
                    env: this.env,
                }, '*');
            } else {
                let w = 700;
                let h = 400;
                let title = 'Puter: Open File';
                var left = (screen.width / 2) - (w / 2);
                var top = (screen.height / 2) - (h / 2);
                window.open(
                    `${puter.defaultGUIOrigin}/action/show-open-file-picker?embedded_in_popup=true&msg_id=${msg_id}&appInstanceID=${this.appInstanceID}&env=${this.env}&options=${JSON.stringify(options ?? {})}`,
                    title,
                    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`,
                );
            }
            //register callback
            this.#callbackFunctions[msg_id] = (maybe_result) => {
                // Only resolve cancel events if this was called with `.undefinedOnCancel`
                if ( maybe_result === FILE_OPEN_CANCELLED ) {
                    undefinedOnCancel.resolve(undefined);
                    return;
                }
                undefinedOnCancel.resolve(maybe_result);
                resolve(maybe_result);
            };
        });
        resolveOnlyPromise.undefinedOnCancel = undefinedOnCancel.promise;
        return resolveOnlyPromise;
    };

    /**
     * Shows a font picker. Resolves to the chosen font. Accepts either a
     * default font name or an options object. `default` is a legacy alias for
     * `defaultFont`.
     *
     * @param {string | (FontPickerOptions & { default?: string })} [options]
     * @returns {Promise<{ fontFamily: string }>}
     */
    showFontPicker (options) {
        if ( this.messageTarget ) {
            return new Promise((resolve) => {
                this.#postMessageWithCallback('showFontPicker', resolve, { options: options ?? {} });
            });
        }
        // Standalone fallback: render web component
        return new Promise((resolve) => {
            const opts = typeof options === 'string' ? { defaultFont: options } : (options ?? {});
            const el = document.createElement('puter-font-picker');
            const defaultFont = opts.defaultFont || opts.default || 'System UI';
            el.setAttribute('default-font', defaultFont);
            el.addEventListener('response', (e) => resolve(e.detail));
            document.body.appendChild(el);
            el.open();
        });
    };

    /**
     * Shows a color picker. Resolves to the chosen color. Accepts either a
     * default color or an options object. `default` and `defaultValue` are
     * legacy aliases for `defaultColor`.
     *
     * @param {string | (ColorPickerOptions & { default?: string, defaultValue?: string })} [options]
     * @returns {Promise<string>}
     */
    showColorPicker (options) {
        if ( this.messageTarget ) {
            return new Promise((resolve) => {
                this.#postMessageWithCallback('showColorPicker', resolve, { options: options ?? {} });
            });
        }
        // Standalone fallback: render web component
        return new Promise((resolve) => {
            const opts = typeof options === 'string' ? { defaultColor: options } : (options ?? {});
            const el = document.createElement('puter-color-picker');
            const defaultColor = opts.defaultValue || opts.defaultColor || opts.default || '#3b82f6';
            el.setAttribute('default-color', defaultColor);
            el.addEventListener('response', (e) => resolve(e.detail));
            document.body.appendChild(el);
            el.open();
        });
    };

    /**
     * Asks the desktop to show its upgrade flow.
     *
     * @returns {Promise<unknown>}
     */
    requestUpgrade () {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('requestUpgrade', resolve, { });
        });
    };

    /**
     * Shows a picker for choosing where to save a file, and saves `content`
     * there. Resolves to the saved `FSItem`; if the user cancels, the promise
     * stays pending (use `undefinedOnCancel` on it to resolve instead).
     *
     * @param {unknown} [content] the data to write; a URL to fetch when `type` is 'url',
     *   or the path of an existing file when 'move' or 'copy'
     * @param {string} [suggestedName] name to prefill in the dialog
     * @param {'url' | 'move' | 'copy'} [type] how `content` is read; inferred as 'url' for a URL
     * @returns {Promise<FSItem>}
     */
    showSaveFilePicker (content, suggestedName, type) {
        const undefinedOnCancel = createDeferred();
        const resolveOnlyPromise = new Promise((resolve, reject) => {
            if ( ! globalThis.open ) {
                return reject('This API is not compatible in Web Workers.');
            }

            const msg_id = this.#messageID++;
            if ( !type && Object.prototype.toString.call(content) === '[object URL]' ) {
                type = 'url';
            }
            const url = type === 'url' ? content.toString() : undefined;
            const source_path = ['move', 'copy'].includes(type) ? content : undefined;

            if ( this.env === 'app' ) {
                this.messageTarget?.postMessage({
                    msg: 'showSaveFilePicker',
                    appInstanceID: this.appInstanceID,
                    content: url ? undefined : content,
                    save_type: type,
                    url,
                    source_path,
                    suggestedName: suggestedName ?? '',
                    env: this.env,
                    uuid: msg_id,
                }, '*');
            } else {
                // Create a Blob from your binary data
                let blob = new Blob([content], { type: 'application/octet-stream' });

                // Create an object URL for the Blob
                let objectUrl = URL.createObjectURL(blob);

                let w = 700;
                let h = 400;
                let title = 'Puter: Save File';
                var left = (screen.width / 2) - (w / 2);
                var top = (screen.height / 2) - (h / 2);

                // Open the picker popup first so we can bind the data handler to the
                // exact window we opened. window.open() returns synchronously and the
                // popup cannot post back until this function yields, so there is no race.
                const popup = window.open(
                    `${puter.defaultGUIOrigin}/action/show-save-file-picker?embedded_in_popup=true&msg_id=${msg_id}&appInstanceID=${this.appInstanceID}&env=${this.env}&blobUrl=${encodeURIComponent(objectUrl)}`,
                    title,
                    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`,
                );

                // Only hand the file content to the trusted Puter GUI popup we just
                // opened. Without this, any framing parent or sibling iframe could post
                // { msg: 'sendMeFileData' } and receive the content the page meant to save.
                const onSendMeFileData = (e) => {
                    if ( e.data?.msg !== 'sendMeFileData' ) return;
                    // Reject anything that isn't our popup on the trusted GUI origin.
                    if ( e.origin !== puter.defaultGUIOrigin ) return;
                    if ( ! popup || e.source !== popup ) return;

                    // Send the file data to the popup, targeting the trusted origin only.
                    e.source.postMessage({
                        msg: 'showSaveFilePickerPopup',
                        content: url ? undefined : content,
                        url: url ? url.toString() : undefined,
                        suggestedName: suggestedName ?? '',
                        env: this.env,
                        uuid: msg_id,
                    }, puter.defaultGUIOrigin);

                    // The trusted popup has the data; remove this exact listener.
                    window.removeEventListener('message', onSendMeFileData);
                };
                window.addEventListener('message', onSendMeFileData);
            }
            //register callback
            this.#callbackFunctions[msg_id] = (maybe_result) => {
                // Only resolve cancel events if this was called with `.undefinedOnCancel`
                if ( maybe_result === FILE_SAVE_CANCELLED ) {
                    undefinedOnCancel.resolve(undefined);
                    return;
                }
                undefinedOnCancel.resolve(maybe_result);
                resolve(maybe_result);
            };
        });

        resolveOnlyPromise.undefinedOnCancel = undefinedOnCancel.promise;

        return resolveOnlyPromise;
    };

    /**
     * Sets a window title. `callback` is vestigial and never invoked.
     *
     * @param {string} title
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowTitle (title, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowTitle', resolve, { new_title: title, window_id: window_id });
        });
    };

    /**
     * Sets a window's width. Values below 200 are clamped to 200. `callback` is vestigial and never invoked.
     *
     * @param {number} width
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowWidth (width, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowWidth', resolve, { width: width, window_id: window_id });
        });
    };

    /**
     * Sets a window's height. Values below 200 are clamped to 200. `callback` is vestigial and never invoked.
     *
     * @param {number} height
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowHeight (height, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowHeight', resolve, { height: height, window_id: window_id });
        });
    };

    /**
     * Sets a window's width and height. Values below 200 are clamped to 200. `callback` is vestigial and never invoked.
     *
     * @param {number} width
     * @param {number} height
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowSize (width, height, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowSize', resolve, { width: width, height: height, window_id: window_id });
        });
    };

    /**
     * Moves a window to a position on screen. `callback` is vestigial and never invoked.
     *
     * @param {number} x
     * @param {number} y
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowPosition (x, y, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowPosition', resolve, { x, y, window_id });
        });
    };

    /**
     * Sets a window's vertical position. `callback` is vestigial and never invoked.
     *
     * @param {number} y
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowY (y, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowY', resolve, { y, window_id });
        });
    };

    /**
     * Sets a window's horizontal position. `callback` is vestigial and never invoked.
     *
     * @param {number} x
     * @param {string | WindowHandle} [window_id] the window to target; defaults to the app's main window
     * @param {unknown} [callback] ignored
     * @returns {Promise<unknown>}
     */
    setWindowX (x, window_id, callback) {
        if ( typeof window_id === 'function' ) {
            callback = window_id;
            window_id = undefined;
        } else if ( typeof window_id === 'object' && window_id !== null ) {
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowX', resolve, { x, window_id });
        });
    };

    /**
     * Shows the app's window.
     *
     * @returns {void}
     */
    showWindow () {
        this.#postMessageWithObject('showWindow');
    };

    /**
     * Hides the app's window.
     *
     * @returns {void}
     */
    hideWindow () {
        this.#postMessageWithObject('hideWindow');
    };

    /**
     * Toggles the app's window between shown and hidden.
     *
     * @returns {void}
     */
    toggleWindow () {
        this.#postMessageWithObject('toggleWindow');
    };

    /**
     * Installs a menubar along the top of the window.
     *
     * @param {MenubarOptions} spec
     * @returns {void}
     */
    setMenubar (spec) {
        if ( this.messageTarget ) {
            this.#postMessageWithObject('setMenubar', spec);
            return;
        }
        // Standalone fallback: render web component
        // Replace any existing menubar
        document.querySelectorAll('puter-menubar').forEach(el => el.remove());
        const el = document.createElement('puter-menubar');
        // Forward an explicit theme ('dark' | 'light') to the web component;
        // unset → the component follows the system preference. The component
        // also forwards this to the dropdowns it spawns. (env=web only.)
        if ( spec.theme ) el.setAttribute('theme', spec.theme);
        el.items = spec.items || [];
        document.body.appendChild(el);
    };

    /**
     * Asks the user to grant a permission to this app. Inside the Puter GUI
     * the request is relayed to the desktop; on the web the permission
     * dialog is shown in a popup window on the Puter origin.
     *
     * @param {{ permission: string }} options
     * @returns {Promise<boolean>} `true` only if the permission was granted.
     */
    async requestPermission (options) {
        if ( this.env === 'app' ) {
            const result = await this.#postMessageAsync('requestPermission', { options });
            return result.granted === true;
        }

        // The popup flow is for third-party websites only. In every other
        // environment it either can't work (workers and node have no window
        // to open a popup from) or makes no sense — inside the Puter GUI
        // itself ('gui') the popup would prompt the user to grant this
        // permission to Puter's own origin. Those callers keep the previous
        // behavior of resolving false.
        if ( this.env !== 'web' ) {
            return false;
        }
        if ( ! globalThis.open || ! globalThis.document ) {
            return false;
        }
        const permission = options?.permission;
        if ( typeof permission !== 'string' || permission === '' ) {
            return false;
        }

        // How long to wait, after the popup is observed closed, for a
        // decision message that may still be in flight.
        const CLOSE_GRACE_MS = 1000;

        // The popup's messages arrive tagged with the browser's canonical
        // serialization of its origin, while `defaultGUIOrigin` is
        // configuration-supplied text — a trailing slash, an explicit default
        // port, or a stray path would fail a raw comparison. A dropped message
        // here doesn't just hang: an unseen `permissionPromptReady` makes the
        // popup's close read as a severed opener, and an unseen decision then
        // reports a permission the user granted as denied. Parse once and
        // compare canonical-to-canonical. A configured origin that can't parse
        // can't host the prompt at all, so deny up front.
        let gui_origin;
        try {
            gui_origin = new URL(puter.defaultGUIOrigin).origin;
        } catch (e) {
            return false;
        }

        return new Promise((resolve) => {
            // Unique per request, and not reused across page loads. The counter
            // alone is a small integer that restarts at 1 on every load, and there
            // is a window — the whole time the no-gesture consent dialog waits for
            // its Continue click — where no popup exists yet, so `event.source` is
            // not pinned and any window on the GUI origin is accepted. A permission
            // popup left open from before a reload posts exactly this message shape
            // to its opener on the way out, and its counter value would collide
            // with a fresh request's, settling it with a decision the user made
            // about a different permission. The random suffix is what makes the
            // two impossible to confuse. The GUI echoes the value back verbatim as
            // a string, which the loose `!=` below compares correctly.
            const msg_id = `${this.#messageID++}-${Math.random().toString(36).slice(2, 10)}`;
            const url = `${gui_origin}/action/request-permission?embedded_in_popup=true&msg_id=${encodeURIComponent(msg_id)}&permission=${encodeURIComponent(permission)}`;

            // Guards against settling more than once across the message,
            // popup-closed, and dialog-cancel code paths.
            let settled = false;
            // Interval id for polling whether the user closed the popup.
            let checkClosed = null;
            // The popup we opened; pinned as the expected `event.source`.
            let popupWindow = null;
            // The consent dialog, when the no-gesture path had to create one.
            let consentDialog = null;
            // Set when the popup announces itself, which it can only do while
            // the opener relationship is intact. See the `closed` handler.
            let promptReady = false;

            const cleanup = () => {
                if ( checkClosed ) {
                    clearInterval(checkClosed);
                    checkClosed = null;
                }
                window.removeEventListener('message', messageHandler);
                // Once answered the dialog is inert; leaving it appended would
                // stack one dead element per request for the page's lifetime.
                consentDialog?.remove();
                consentDialog = null;
            };

            const settle = (granted) => {
                if ( settled ) return;
                settled = true;
                cleanup();
                resolve(granted);
            };

            const messageHandler = (e) => {
                // Only accept the decision from the Puter GUI origin AND from
                // the popup we opened. Origin alone is insufficient (any frame
                // on the GUI domain could post), so also pin event.source.
                // msg_id binds the message to this request.
                if ( e.origin !== gui_origin ) return;
                if ( popupWindow && e.source !== popupWindow ) return;
                if ( e.data?.original_msg_id != msg_id ) return;
                // The popup reporting that it is up and can reach us. Carries
                // no decision — it only tells the `closed` handler below which
                // kind of window it is looking at.
                if ( e.data?.msg === 'permissionPromptReady' ) {
                    promptReady = true;
                    return;
                }
                if ( e.data?.msg !== 'permissionGranted' ) return;
                settle(e.data.granted === true);
            };
            window.addEventListener('message', messageHandler);

            // Once the popup exists, watch for the user closing it without
            // answering. `popup` is null if the browser blocked it.
            const watchPopup = (popup) => {
                if ( settled ) return;
                if ( ! popup ) {
                    settle(false);
                    return;
                }
                // Pin the expected event.source before anything can return
                // early: until this is set the message handler accepts a
                // decision from any window on the GUI origin, and the wait for
                // the consent dialog's Continue click is user-paced.
                popupWindow = popup;
                // A severed opener relationship means the popup can't
                // postMessage back and `popup.closed` tells us nothing about
                // the window the user is looking at — it reads `true` for a
                // detached proxy. Poll the permission check instead (mirrors
                // signIn's /login/wait fallback), giving up after a timeout.
                // `crossOriginIsolated` alone misses this: COOP severs the
                // relationship on its own, while being isolated also requires
                // COEP.
                if ( window.crossOriginIsolated || popup.closed ) {
                    pollDecision();
                    return;
                }
                // `closed` read right after `window.open()` cannot see COOP
                // severing yet: the popup is still the initial about:blank in
                // this browsing-context group, and the group is only swapped
                // when the navigation to the Puter origin *commits*. So
                // severing shows up here, in the poll, as `closed` flipping
                // true — indistinguishable, by itself, from the user closing
                // the window.
                //
                // The two are told apart by whether the popup ever announced
                // itself: that message can only arrive while the opener
                // relationship is intact, so having seen it proves a close is a
                // real close and the answer is now. Never having seen it means
                // the channel may be severed, with the prompt live in a window
                // that cannot answer — reporting a denial there would tell the
                // site "denied" while the user goes on to click Allow and commit
                // the grant, so the decision is read back from the server
                // instead. Elapsed time cannot stand in for this: a slow popup
                // navigation commits the severing whenever it commits.
                checkClosed = setInterval(() => {
                    if ( ! popup.closed ) return;
                    clearInterval(checkClosed);
                    checkClosed = null;
                    const severed = ! promptReady;
                    // The GUI posts the decision and then closes the popup,
                    // and cross-process postMessage delivery is not ordered
                    // relative to `closed` becoming true. Give an in-flight
                    // decision message its grace period before acting on the
                    // close — on either branch, since a real answer already on
                    // its way outranks whatever the close is taken to mean.
                    setTimeout(() => {
                        if ( settled ) return;
                        if ( severed ) {
                            // The decision can still be read back from the
                            // server. A denial can't (nothing is written for
                            // it), so this only ends early on a grant —
                            // otherwise it waits out the poll timeout before
                            // answering false.
                            pollDecision();
                            return;
                        }
                        settle(false);
                    }, CLOSE_GRACE_MS);
                }, 100);
            };

            const pollDecision = async () => {
                const POLL_INTERVAL_MS = 2000;
                const POLL_TIMEOUT_MS = 5 * 60 * 1000;
                // Per-attempt budget, generous enough that a slow-but-working
                // connection still gets an answer, short enough that the deadline
                // below stays meaningful.
                const POLL_REQUEST_TIMEOUT_MS = 10000;
                // The check needs this site's own token, and a permission popup
                // deliberately never hands one over. Without it every iteration
                // would skip the request and the loop would just burn its whole
                // timeout before answering — so answer now.
                if ( ! puter.authToken ) {
                    settle(false);
                    return;
                }
                const started = Date.now();
                while ( ! settled && Date.now() - started < POLL_TIMEOUT_MS ) {
                    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                    if ( settled ) return;
                    if ( ! puter.authToken ) continue;
                    // Time-box each attempt. The loop only re-reads the clock
                    // between iterations, so a request that never settles — a
                    // stalled connection, a proxy that accepts and never replies
                    // — parks this `await` forever: POLL_TIMEOUT_MS is never
                    // reached, `settle` is never called, and the caller's promise
                    // stays pending for the life of the page with the listener
                    // still attached. The popup is already closed on this branch,
                    // so nothing the user does can recover it.
                    const controller = typeof AbortController !== 'undefined'
                        ? new AbortController()
                        : null;
                    const attempt_timer = setTimeout(
                        () => controller?.abort(),
                        POLL_REQUEST_TIMEOUT_MS,
                    );
                    try {
                        const resp = await fetch(`${puter.APIOrigin}/auth/check-permissions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${puter.authToken}`,
                            },
                            body: JSON.stringify({ permissions: [permission] }),
                            ...(controller ? { signal: controller.signal } : {}),
                        });
                        if ( ! resp.ok ) continue;
                        const data = await resp.json();
                        if ( data?.permissions?.[permission] === true ) {
                            settle(true);
                        }
                    } catch (e) {
                        // Transient network failure, or this attempt's abort; keep
                        // polling until the deadline above is reached.
                    } finally {
                        // Runs on the `continue` paths too.
                        clearTimeout(attempt_timer);
                    }
                }
                settle(false);
            };

            // Every path out of here resolves a boolean, so anything that
            // throws while launching — `window.open` refused outright by a
            // policy or an override rather than returning null, a dialog that
            // won't construct, no `document.body` yet because this was called
            // from a <head> script — has to deny rather than reject.
            try {
                if ( hasUserActivation() ) {
                    // A user gesture is active — open the popup immediately.
                    // Unique window name per request: window.open() reuses a
                    // window with the same name, which would hijack a popup an
                    // earlier, still-pending request is waiting on.
                    watchPopup(openAuthPopup(url, `puter-permission-${msg_id}`));
                } else {
                    // No user gesture: a popup opened now would be blocked by
                    // the browser. Show a consent dialog first; the popup is
                    // then opened from the user's click on that dialog, which
                    // provides the gesture the browser requires.
                    const dialog = new PuterDialog(() => {}, () => {}, {
                        popupURL: url,
                        // Same unique-name reasoning as the direct path above.
                        popupName: `puter-permission-${msg_id}`,
                        onLaunch: (popup) => watchPopup(popup),
                        onCancel: () => settle(false),
                    });
                    consentDialog = dialog;
                    document.body.appendChild(dialog);
                    dialog.open();
                }
            } catch (e) {
                // `settle` runs cleanup, so the message listener is dropped too.
                settle(false);
            }
        });
    };

    /**
     * Greys out a menubar item so it cannot be clicked.
     *
     * @param {string} item_id
     * @returns {void}
     */
    disableMenuItem (item_id) {
        this.#postMessageWithObject('disableMenuItem', { id: item_id });
    };

    /**
     * Re-enables a menubar item disabled with `disableMenuItem`.
     *
     * @param {string} item_id
     * @returns {void}
     */
    enableMenuItem (item_id) {
        this.#postMessageWithObject('enableMenuItem', { id: item_id });
    };

    /**
     * Sets a menubar item's icon. Must be a `data:image` URI.
     *
     * @param {string} item_id
     * @param {string} icon
     * @returns {void}
     */
    setMenuItemIcon (item_id, icon) {
        this.#postMessageWithObject('setMenuItemIcon', { id: item_id, icon: icon });
    };

    /**
     * Sets the icon a menubar item shows while hovered or active. Must be a
     * `data:image` URI.
     *
     * @param {string} item_id
     * @param {string} icon
     * @returns {void}
     */
    setMenuItemIconActive (item_id, icon) {
        this.#postMessageWithObject('setMenuItemIconActive', { id: item_id, icon: icon });
    };

    /**
     * Shows or clears the check mark on a menubar item.
     *
     * @param {string} item_id
     * @param {boolean} checked
     * @returns {void}
     */
    setMenuItemChecked (item_id, checked) {
        this.#postMessageWithObject('setMenuItemChecked', { id: item_id, checked: checked });
    };

    /**
     * Opens a context menu at the pointer. Item actions run on click.
     *
     * @param {ContextMenuOptions} spec
     * @returns {void}
     */
    contextMenu (spec) {
        if ( this.messageTarget ) {
            this.#postMessageWithObject('contextMenu', spec);
            return;
        }
        // Standalone fallback: render web component
        const el = document.createElement('puter-context-menu');
        // Forward an explicit theme ('dark' | 'light') to the web component;
        // unset → the component follows the system preference. The component
        // also forwards this to any submenus it spawns. (env=web only.)
        if ( spec.theme ) el.setAttribute('theme', spec.theme);
        el.items = spec.items || [];
        // Use mouse position or provided position
        const x = spec.x ?? (globalThis.event?.clientX ?? 0);
        const y = spec.y ?? (globalThis.event?.clientY ?? 0);
        el.setAttribute('x', String(x));
        el.setAttribute('y', String(y));
        document.body.appendChild(el);
    };

    /**
     * Asynchronously extracts entries from DataTransferItems, like files and directories.
     *
     * @private
     * @function
     * @async
     * @param {DataTransferItemList} dataTransferItems - List of data transfer items from a drag-and-drop operation.
     * @param {Object} [options={}] - Optional settings.
     * @param {boolean} [options.raw=false] - Determines if the file path should be processed.
     * @returns {Promise<Array<File|Entry>>} - A promise that resolves to an array of File or Entry objects.
     * @throws {Error} - Throws an error if there's an EncodingError and provides information about how to solve it.
     *
     * @example
     * const items = event.dataTransfer.items;
     * const entries = await getEntriesFromDataTransferItems(items, { raw: false });
     */
    getEntriesFromDataTransferItems = async function (dataTransferItems, options = { raw: false }) {
        const checkErr = (err) => {
            if ( this.getEntriesFromDataTransferItems.didShowInfo ) return;
            if ( err.name !== 'EncodingError' ) return;
            this.getEntriesFromDataTransferItems.didShowInfo = true;
            const infoMsg = `${err.name} occurred within datatransfer-files-promise module\n`
                + `Error message: "${err.message}"\n`
                + 'Try serving html over http if currently you are running it from the filesystem.';
            console.warn(infoMsg);
        };

        const readFile = (entry, path = '') => {
            return new Promise((resolve, reject) => {
                entry.file(file => {
                    if ( ! options.raw ) file.filepath = path + file.name; // save full path
                    resolve(file);
                }, (err) => {
                    checkErr(err);
                    reject(err);
                });
            });
        };

        const dirReadEntries = (dirReader, path) => {
            return new Promise((resolve, reject) => {
                dirReader.readEntries(async entries => {
                    let files = [];
                    for ( let entry of entries ) {
                        const itemFiles = await getFilesFromEntry(entry, path);
                        files = files.concat(itemFiles);
                    }
                    resolve(files);
                }, (err) => {
                    checkErr(err);
                    reject(err);
                });
            });
        };

        const readDir = async (entry, path) => {
            const dirReader = entry.createReader();
            const newPath = `${path + entry.name}/`;
            let files = [];
            let newFiles;
            do {
                newFiles = await dirReadEntries(dirReader, newPath);
                files = files.concat(newFiles);
            } while ( newFiles.length > 0 );
            return files;
        };

        const getFilesFromEntry = async (entry, path = '') => {
            if ( entry === null )
            {
                return;
            }
            else if ( entry.isFile ) {
                const file = await readFile(entry, path);
                return [file];
            }
            else if ( entry.isDirectory ) {
                const files = await readDir(entry, path);
                files.push(entry);
                return files;
            }
        };

        let files = [];
        let entries = [];

        // Pull out all entries before reading them
        for ( let i = 0, ii = dataTransferItems.length; i < ii; i++ ) {
            entries.push(dataTransferItems[i].webkitGetAsEntry());
        }

        // Recursively read through all entries
        for ( let entry of entries ) {
            const newFiles = await getFilesFromEntry(entry);
            files = files.concat(newFiles);
        }

        return files;
    };

    /**
     * Asks the user to authenticate with their Puter account. Resolves once
     * they have; rejects if they cancel. Most APIs call this for you.
     *
     * @returns {Promise<void>}
     */
    authenticateWithPuter () {
        if ( this.env !== 'web' ) {
            return;
        }

        // if authToken is already present, resolve immediately
        if ( this.authToken ) {
            return new Promise((resolve) => {
                resolve();
            });
        }

        // If a prompt is already open, return a promise that resolves based on the existing prompt's result.
        if ( puter.puterAuthState.isPromptOpen ) {
            return new Promise((resolve, reject) => {
                puter.puterAuthState.resolver = { resolve, reject };
            });
        }

        // Show the permission prompt and set the state.
        puter.puterAuthState.isPromptOpen = true;
        puter.puterAuthState.authGranted = null;

        return new Promise((resolve, reject) => {
            if ( ! puter.authToken ) {
                const puterDialog = new PuterDialog(resolve, reject);
                document.body.appendChild(puterDialog);
                puterDialog.open();
            } else {
                // If authToken is already present, resolve immediately
                resolve();
            }
        });
    };

    /**
     * @overload
     * @param {LaunchAppOptions} options
     * @returns {Promise<AppConnection>}
     */
    /**
     * @overload
     * @param {string} [appName]
     * @param {Record<string, unknown>} [args]
     * @param {(connection: AppConnection) => void} [callback]
     * @returns {Promise<AppConnection>}
     */
    /**
     * Opens the named app in Puter with the given arguments, or takes a single
     * options object. Resolves to a connection to the launched app.
     *
     * @param {string | LaunchAppOptions} [nameOrOptions]
     * @param {Record<string, unknown>} [args]
     * @param {(connection: AppConnection) => void} [callback]
     * @returns {Promise<AppConnection>}
     */
    launchApp = async function launchApp (nameOrOptions, args, callback) {
        let pseudonym = undefined;
        let file_paths = undefined;
        let items = undefined;
        let app_name = nameOrOptions; // becomes string after branch below

        // Handle case where app_name is an options object
        if ( typeof app_name === 'object' && app_name !== null ) {
            const options = app_name;
            app_name = options.name || options.app_name;
            file_paths = options.file_paths;
            args = args || options.args;
            callback = callback || options.callback;
            pseudonym = options.pseudonym;
            items = options.items;
        }

        if ( items ) {
            if ( ! Array.isArray(items) ) items = [];
            for ( let i = 0 ; i < items.length ; i++ ) {
                if ( items[i] instanceof FSItem ) {
                    items[i] = items[i]._internalProperties.file_signature;
                }
            }
        }

        if ( app_name && app_name.includes('#(as)') ) {
            [app_name, pseudonym] = app_name.split('#(as)');
        }

        if ( ! app_name ) app_name = puter.appName;

        const app_info = await this.#ipc_stub({
            method: 'launchApp',
            callback,
            parameters: {
                app_name,
                file_paths,
                items,
                pseudonym,
                args,
            },
        });

        return AppConnection.from(app_info, this.puter, {
            messageTarget: this.messageTarget,
            appInstanceID: this.appInstanceID,
        });
    };

    connectToInstance = async function connectToInstance (app_name) {
        const app_info = await this.#ipc_stub({
            method: 'connectToInstance',
            parameters: {
                app_name,
            },
        });

        return AppConnection.from(app_info, this.puter, {
            messageTarget: this.messageTarget,
            appInstanceID: this.appInstanceID,
        });
    };

    /**
     * The connection to the app that launched this one, or `null` when there
     * is no parent app.
     *
     * @returns {AppConnection | null}
     */
    parentApp () {
        return this.#parentAppConnection;
    }

    /**
     * Creates and shows a window. Resolves to a handle whose `id` the
     * `setWindow*` methods accept. `callback` is vestigial and never invoked.
     *
     * @param {WindowOptions} [options]
     * @param {unknown} [callback] ignored
     * @returns {Promise<WindowHandle>}
     */
    createWindow (options, callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('createWindow', (res) => {
                resolve(res.window);
            }, { options: options ?? {} });
        });
    };

    // Menubar
    menubar () {
        // Remove previous style tag
        document.querySelectorAll('style.puter-stylesheet').forEach(function (el) {
            el.remove();
        });

        // Add new style tag
        const style = document.createElement('style');
        style.classList.add('puter-stylesheet');
        style.innerHTML = `
        .--puter-menubar {
            border-bottom: 1px solid #e9e9e9;
            background-color: #fbf9f9;
            padding-top: 3px;
            padding-bottom: 2px;
            display: inline-block;
            position: fixed;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            height: 31px;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
            z-index: 9999;
        }
        
        .--puter-menubar, .--puter-menubar * {
            user-select: none;
            -webkit-user-select: none;
            cursor: default;
        }
        
        .--puter-menubar .dropdown-item-divider>hr {
            margin-top: 5px;
            margin-bottom: 5px;
            border-bottom: none;
            border-top: 1px solid #00000033;
        }
        
        .--puter-menubar>li {
            display: inline-block;
            padding: 10px 5px;
        }
        
        .--puter-menubar>li>ul {
            display: none;
            z-index: 999999999999;
            list-style: none;
            background-color: rgb(233, 233, 233);
            width: 200px;
            border: 1px solid #e4ebf3de;
            box-shadow: 0px 0px 5px #00000066;
            padding-left: 6px;
            padding-right: 6px;
            padding-top: 4px;
            padding-bottom: 4px;
            color: #333;
            border-radius: 4px;
            padding: 2px;
            min-width: 200px;
            margin-top: 5px;
            position: absolute;
        }
        
        .--puter-menubar .menubar-item {
            display: block;
            line-height: 24px;
            margin-top: -7px;
            text-align: center;
            border-radius: 3px;
            padding: 0 5px;
        }
        
        .--puter-menubar .menubar-item-open {
            background-color: rgb(216, 216, 216);
        }
        
        .--puter-menubar .dropdown-item {
            padding: 5px;
            padding: 5px 30px;
            list-style-type: none;
            user-select: none;
            font-size: 13px;
        }
        
        .--puter-menubar .dropdown-item-icon, .--puter-menubar .dropdown-item-icon-active {
            pointer-events: none;
            width: 18px;
            height: 18px;
            margin-left: -23px;
            margin-bottom: -4px;
            margin-right: 5px;
        }
        .--puter-menubar .dropdown-item-disabled .dropdown-item-icon{
            display: inline-block !important;
        }
        .--puter-menubar .dropdown-item-disabled .dropdown-item-icon-active{
            display: none !important;
        }
        .--puter-menubar .dropdown-item-icon-active {
            display:none;
        }
        .--puter-menubar .dropdown-item:hover .dropdown-item-icon{
            display: none;
        }
        .--puter-menubar .dropdown-item:hover .dropdown-item-icon-active{
            display: inline-block;
        }
        .--puter-menubar .dropdown-item-hide-icon .dropdown-item-icon, .--puter-menubar .dropdown-item-hide-icon .dropdown-item-icon-active{
            display: none !important;
        }
        .--puter-menubar .dropdown-item a {
            color: #333;
            text-decoration: none;
        }
        
        .--puter-menubar .dropdown-item:hover, .--puter-menubar .dropdown-item:hover a {
            background-color: rgb(59 134 226);
            color: white;
            border-radius: 4px;
        }
        
        .--puter-menubar .dropdown-item-disabled, .--puter-menubar .dropdown-item-disabled:hover {
            opacity: 0.5;
            background-color: transparent;
            color: initial;
            cursor: initial;
            pointer-events: none;
        }
        
        .--puter-menubar .menubar * {
            user-select: none;
        }                
        `;
        let head = document.head || document.getElementsByTagName('head')[0];
        head.appendChild(style);

        document.addEventListener('click', function (e) {
            // Don't hide if clicking on disabled item
            if ( e.target.classList.contains('dropdown-item-disabled') )
            {
                return false;
            }
            // Hide open menus
            if ( ! (e.target).classList.contains('menubar-item') ) {
                document.querySelectorAll('.menubar-item.menubar-item-open').forEach(function (el) {
                    el.classList.remove('menubar-item-open');
                });

                document.querySelectorAll('.dropdown').forEach(el => el.style.display = 'none');
            }
        });

        // When focus is gone from this window, hide open menus
        window.addEventListener('blur', function (e) {
            document.querySelectorAll('.dropdown').forEach(function (el) {
                el.style.display = 'none';
            });
            document.querySelectorAll('.menubar-item.menubar-item-open').forEach(el => el.classList.remove('menubar-item-open'));
        });

        // Returns the siblings of the element
        const siblings = function (e) {
            const siblings = [];

            // if no parent, return empty list
            if ( ! e.parentNode ) {
                return siblings;
            }

            // first child of the parent node
            let sibling  = e.parentNode.firstChild;

            // get all other siblings
            while ( sibling ) {
                if ( sibling.nodeType === 1 && sibling !== e ) {
                    siblings.push(sibling);
                }
                sibling = sibling.nextSibling;
            }
            return siblings;
        };

        // Open dropdown
        document.querySelectorAll('.menubar-item').forEach(el => el.addEventListener('mousedown', function (e) {
            // Hide all other menus
            document.querySelectorAll('.dropdown').forEach(function (el) {
                el.style.display = 'none';
            });

            // Remove open class from all menus, except this menu that was just clicked
            document.querySelectorAll('.menubar-item.menubar-item-open').forEach(function (el) {
                if ( el != e.target )
                {
                    el.classList.remove('menubar-item-open');
                }
            });

            // If menu is already open, close it
            if ( this.classList.contains('menubar-item-open') ) {
                document.querySelectorAll('.menubar-item.menubar-item-open').forEach(function (el) {
                    el.classList.remove('menubar-item-open');
                });
            }

            // If menu is not open, open it
            else if ( ! e.target.classList.contains('dropdown-item') ) {
                this.classList.add('menubar-item-open');

                // show all sibling
                siblings(this).forEach(function (el) {
                    el.style.display = 'block';
                });
            }

        }));

        // If a menu is open, and you hover over another menu, open that menu
        document.querySelectorAll('.--puter-menubar .menubar-item').forEach(el => el.addEventListener('mouseover', function (e) {
            const open_menus = document.querySelectorAll('.menubar-item.menubar-item-open');
            if ( open_menus.length > 0 && open_menus[0] !== e.target ) {
                e.target.dispatchEvent(new Event('mousedown'));
            }
        }));
    };

    /**
     * @overload
     * @param {'localeChanged'} eventName
     * @param {(data: { language: string }) => void} callback
     * @returns {void}
     */
    /**
     * @overload
     * @param {'themeChanged'} eventName
     * @param {(data: ThemeData) => void} callback
     * @returns {void}
     */
    /**
     * @overload
     * @param {'connection'} eventName
     * @param {(data: ConnectionEvent) => void} callback
     * @returns {void}
     */
    /**
     * Listens for a broadcast from Puter. A broadcast that already happened is
     * replayed to the handler immediately with its most recent value.
     *
     * - `localeChanged` — on startup and when the user's locale changes.
     * - `themeChanged` — on startup and when the desktop theme changes.
     * - `connection` — when another app asks to connect to this one.
     *
     * @param {string} eventName
     * @param {(data: unknown) => void} callback
     * @returns {void}
     */
    on (eventName, callback) {
        super.on(eventName, callback);
        // If we already received a broadcast for this event, run the callback immediately
        if ( this.#eventNames.includes(eventName) && this.#lastBroadcastValue.has(eventName) ) {
            callback(this.#lastBroadcastValue.get(eventName));
        }
    }

    #showTime = null;
    #hideTimeout = null;

    /**
     * Covers the screen with a spinner overlay. Nested calls share one
     * spinner, which goes away once every caller has hidden it.
     *
     * @param {string} [html] message under the spinner; defaults to "Working..."
     * @returns {void}
     */
    showSpinner (html) {
        if ( this.#overlayActive ) return;

        // Create and add stylesheet for spinner if it doesn't exist
        if ( ! document.getElementById('puter-spinner-styles') ) {
            const styleSheet = document.createElement('style');
            styleSheet.id = 'puter-spinner-styles';
            styleSheet.textContent = `
                .puter-loading-spinner {
                    width: 50px;
                    height: 50px;
                    border: 5px solid #f3f3f3;
                    border-top: 5px solid #3498db;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin-bottom: 10px;
                }
    
                .puter-loading-text {
                    font-family: Arial, sans-serif;
                    font-size: 16px;
                    margin-top: 10px;
                    text-align: center;
                    width: 100%;
                }
    
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
    
                .puter-loading-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 120px; 
                    background: #ffffff; 
                    border-radius: 10px;
                    padding: 20px;
                    min-width: 120px;
                }
            `;
            document.head.appendChild(styleSheet);
        }

        const overlay = document.createElement('div');
        overlay.classList.add('puter-loading-overlay');

        const styles = {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            zIndex: '2147483647',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'all',
        };

        Object.assign(overlay.style, styles);

        // Create container for spinner and text
        const container = document.createElement('div');
        container.classList.add('puter-loading-container');

        // Add spinner and text
        container.innerHTML = `
            <div class="puter-loading-spinner"></div>
            <div class="puter-loading-text">${html ?? 'Working...'}</div>
        `;

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        this.#overlayActive = true;
        this.#showTime = Date.now(); // Add show time tracking
        this.#overlayTimer = setTimeout(() => {
            this.#overlayTimer = null;
        }, 1000);
    }

    /**
     * Hides the spinner shown by `showSpinner`.
     *
     * @returns {void}
     */
    hideSpinner () {
        if ( ! this.#overlayActive ) return;

        if ( this.#overlayTimer ) {
            clearTimeout(this.#overlayTimer);
            this.#overlayTimer = null;
        }

        // Calculate how long the spinner has been shown
        const elapsedTime = Date.now() - this.#showTime;
        const remainingTime = Math.max(0, 1200 - elapsedTime);

        // If less than 1 second has passed, delay the hide
        if ( remainingTime > 0 ) {
            if ( this.#hideTimeout ) {
                clearTimeout(this.#hideTimeout);
            }

            this.#hideTimeout = setTimeout(() => {
                this.#removeSpinner();
            }, remainingTime);
        } else {
            this.#removeSpinner();
        }
    }

    // Add private method to handle spinner removal
    #removeSpinner () {
        const overlay = document.querySelector('.puter-loading-overlay');
        if ( overlay ) {
            overlay.parentNode?.removeChild(overlay);
        }

        this.#overlayActive = false;
        this.#showTime = null;
        this.#hideTimeout = null;
    }

    isWorkingActive () {
        return this.#overlayActive;
    }

    /**
     * Gets the current language/locale code (e.g., 'en', 'fr', 'es').
     *
     * @returns {Promise<string>} A promise that resolves with the current language code.
     *
     * @example
     * const currentLang = await puter.ui.getLanguage();
     * console.log(`Current language: ${currentLang}`); // e.g., "Current language: fr"
     */
    getLanguage () {
        // resolve with the current language code if in GUI environment
        if ( this.env === 'gui' ) {
            // resolve with the current language code
            return new Promise((resolve) => {
                resolve(window.locale);
            });
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('getLanguage', resolve, {});
        });
    }
}

export default UI;
