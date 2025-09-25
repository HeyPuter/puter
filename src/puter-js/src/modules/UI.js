import FSItem from './FSItem.js';
import PuterDialog from './PuterDialog.js';
import EventListener  from '../lib/EventListener.js';
import putility from '@heyputer/putility';

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
    
    static from (values, context) {
        const connection = new AppConnection(context, {
            target: values.appInstanceID,
            usesSDK: values.usesSDK,
        });

        // When a connection is established the app is able to
        // provide some additional information about itself
        connection.response = values.response;

        return connection;
    }

    constructor(context, { target, usesSDK }) {
        super([
            'message', // The target sent us something with postMessage()
            'close',   // The target app was closed
        ]);
        this.messageTarget = context.messageTarget;
        this.appInstanceID = context.appInstanceID;
        this.targetAppInstanceID = target;
        this.#isOpen = true;
        this.#usesSDK = usesSDK;

        this.log = context.puter.logger.fields({
            category: 'ipc',
        });
        this.log.fields({
            cons_source: context.appInstanceID,
            source: context.puter.appInstanceID,
            target,
        }).info(`AppConnection created to ${target}`, this);

        // TODO: Set this.#puterOrigin to the puter origin

        (globalThis.document) && window.addEventListener('message', event => {
            if (event.data.msg === 'messageToApp') {
                if (event.data.appInstanceID !== this.targetAppInstanceID) {
                    // Message is from a different AppConnection; ignore it.
                    return;
                }
                // TODO: does this check really make sense?
                if (event.data.targetAppInstanceID !== this.appInstanceID) {
                    console.error(`AppConnection received message intended for wrong app! appInstanceID=${this.appInstanceID}, target=${event.data.targetAppInstanceID}`);
                    return;
                }
                this.emit('message', event.data.contents);
                return;
            }

            if (event.data.msg === 'appClosed') {
                if (event.data.appInstanceID !== this.targetAppInstanceID) {
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

    // Does the target app use the Puter SDK? If not, certain features will be unavailable.
    get usesSDK() { return this.#usesSDK; }

    // Send a message to the target app. Requires the target to use the Puter SDK.
    postMessage(message) {
        if (!this.#isOpen) {
            console.warn('Trying to post message on a closed AppConnection');
            return;
        }

        if (!this.#usesSDK) {
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

    // Attempt to close the target application
    close() {
        if (!this.#isOpen) {
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
    #postMessageWithCallback = function(name, resolve, args = {}) {
        const msg_id = this.#messageID++;
        this.messageTarget?.postMessage({
            msg: name,
            env: this.env,
            appInstanceID: this.appInstanceID,
            uuid: msg_id,
            ...args,
        }, '*');
        //register callback
        this.#callbackFunctions[msg_id] = resolve;
    }

    #postMessageWithObject = function(name, value) {
        const dehydrator = this.util.rpc.getDehydrator({
            target: this.messageTarget
        });
        this.messageTarget?.postMessage({
            msg: name,
            env: this.env,
            appInstanceID: this.appInstanceID,
            value: dehydrator.dehydrate(value),
        }, '*');
    }
    
    #ipc_stub = async function ({
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
        if ( ! resolve ) debugger;
        const callback_id = this.util.rpc.registerCallback(resolve);
        this.messageTarget?.postMessage({
            $: 'puter-ipc', v: 2,
            appInstanceID: this.appInstanceID,
            env: this.env,
            msg: method,
            parameters,
            uuid: callback_id,
        }, '*');
        const ret = await p;
        if ( callback ) callback(ret);
        return ret;
    }

    constructor (context, { appInstanceID, parentInstanceID }) {
        const eventNames = [
            'localeChanged',
            'themeChanged',
            'connection',
        ];
        super(eventNames);
        this.#eventNames = eventNames;
        this.context = context;
        this.appInstanceID = appInstanceID;
        this.parentInstanceID = parentInstanceID;
        this.appID = context.appID;
        this.env = context.env;
        this.util = context.util;

        if(this.env === 'app'){
            this.messageTarget = window.parent;
        }
        else if(this.env === 'gui'){
            return;
        }

        // Context to pass to AppConnection instances
        this.context = this.context.sub({
            appInstanceID: this.appInstanceID,
            messageTarget: this.messageTarget,
        });

        if (this.parentInstanceID) {
            this.#parentAppConnection = new AppConnection(this.context, {
                target: this.parentInstanceID,
                usesSDK: true
            });
        }

        // Tell the host environment that this app is using the Puter SDK and is ready to receive messages,
        // this will allow the OS to send custom messages to the app
        this.messageTarget?.postMessage({
            msg: "READY",
            appInstanceID: this.appInstanceID,
        }, '*');

        // When this app's window is focused send a message to the host environment
        (globalThis.document) && window.addEventListener('focus', (e) => {
            this.messageTarget?.postMessage({
                msg: "windowFocused",
                appInstanceID: this.appInstanceID,
            }, '*');
        });

        // Bind the message event listener to the window
        let lastDraggedOverElement = null;
        (globalThis.document) && window.addEventListener('message', async (e) => {
            // `error`
            if(e.data.error){
                throw e.data.error;
            }
            // `focus` event
            else if(e.data.msg && e.data.msg === 'focus'){
                window.focus();
            }
            // `click` event
            else if(e.data.msg && e.data.msg === 'click'){
                // Get the element that was clicked on and click it
                const clicked_el = document.elementFromPoint(e.data.x, e.data.y);
                if(clicked_el !== null)
                    clicked_el.click();
            }
            // `dragover` event based on the `drag` event from the host environment
            else if(e.data.msg && e.data.msg === 'drag'){
                // Get the element being dragged over
                const draggedOverElement = document.elementFromPoint(e.data.x, e.data.y);
                if(draggedOverElement !== lastDraggedOverElement){
                    // If the last element exists and is different from the current, dispatch a dragleave on it
                    if(lastDraggedOverElement){
                        const dragLeaveEvent = new Event('dragleave', {
                            bubbles: true,
                            cancelable: true,
                            clientX: e.data.x,
                            clientY: e.data.y
                        });
                        lastDraggedOverElement.dispatchEvent(dragLeaveEvent);
                    }
                    // If the current element exists and is different from the last, dispatch dragenter on it
                    if(draggedOverElement){
                        const dragEnterEvent = new Event('dragenter', {
                            bubbles: true,
                            cancelable: true,
                            clientX: e.data.x,
                            clientY: e.data.y
                        });
                        draggedOverElement.dispatchEvent(dragEnterEvent);
                    }

                    // Update the lastDraggedOverElement
                    lastDraggedOverElement = draggedOverElement;
                }
            }
            // `drop` event
            else if(e.data.msg && e.data.msg === 'drop'){
                if(lastDraggedOverElement){
                    const dropEvent = new CustomEvent('drop', {
                        bubbles: true,
                        cancelable: true,
                        detail: {
                            clientX: e.data.x,
                            clientY: e.data.y,
                            items: e.data.items
                        }
                    });
                    lastDraggedOverElement.dispatchEvent(dropEvent);
                    
                    // Reset the lastDraggedOverElement
                    lastDraggedOverElement = null;
                }
            }
            // windowWillClose
            else if(e.data.msg === 'windowWillClose'){
                // If the user has not overridden onWindowClose() then send a message back to the host environment
                // to let it know that it is ok to close the window.
                if(this.#onWindowClose === undefined){
                    this.messageTarget?.postMessage({
                        msg: true,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');
                }
                // If the user has overridden onWindowClose() then send a message back to the host environment
                // to let it know that it is NOT ok to close the window. Then execute onWindowClose() and the user will 
                // have to manually close the window.
                else{
                    this.messageTarget?.postMessage({
                        msg: false,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');
                    this.#onWindowClose();
                }
            }
            // itemsOpened
            else if(e.data.msg === 'itemsOpened'){
                // If the user has not overridden onItemsOpened() then only send a message back to the host environment
                if(this.#onItemsOpened === undefined){
                    this.messageTarget?.postMessage({
                        msg: true,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');        
                }
                // If the user has overridden onItemsOpened() then send a message back to the host environment
                // and execute onItemsOpened()
                else{
                    this.messageTarget?.postMessage({
                        msg: false,
                        appInstanceID: this.appInstanceID,
                        original_msg_id: e.data.msg_id,
                    }, '*');

                    let items = [];
                    if(e.data.items.length > 0){
                        for (let index = 0; index < e.data.items.length; index++)
                            items.push(new FSItem(e.data.items[index]))
                    }
                    this.#onItemsOpened(items);
                }
            }
            // getAppDataSucceeded
            else if(e.data.msg === 'getAppDataSucceeded'){
                let appDataItem = new FSItem(e.data.item);
                if(e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id]){
                    this.#callbackFunctions[e.data.original_msg_id](appDataItem);
                }
            }
            // instancesOpenSucceeded
            else if(e.data.msg === 'instancesOpenSucceeded'){
                if(e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id]){
                    this.#callbackFunctions[e.data.original_msg_id](e.data.instancesOpen);
                }
            }
            // readAppDataFileSucceeded
            else if(e.data.msg === 'readAppDataFileSucceeded'){
                let appDataItem = new FSItem(e.data.item);
                if(e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id]){
                    this.#callbackFunctions[e.data.original_msg_id](appDataItem);
                }
            }
            // readAppDataFileFailed
            else if(e.data.msg === 'readAppDataFileFailed'){
                if(e.data.original_msg_id && this.#callbackFunctions[e.data.original_msg_id]){
                    this.#callbackFunctions[e.data.original_msg_id](null);
                }
            }
            // Determine if this is a response to a previous message and if so, is there
            // a callback function for this message? if answer is yes to both then execute the callback
            else if(e.data.original_msg_id !== undefined && this.#callbackFunctions[e.data.original_msg_id]){
                if(e.data.msg === 'fileOpenPicked'){
                    // 1 item returned
                    if(e.data.items.length === 1){
                        this.#callbackFunctions[e.data.original_msg_id](new FSItem(e.data.items[0]));                             
                    }
                    // multiple items returned
                    else if(e.data.items.length > 1){
                        // multiple items returned
                        let items = [];
                        for (let index = 0; index < e.data.items.length; index++)
                            items.push(new FSItem(e.data.items[index]))
                        this.#callbackFunctions[e.data.original_msg_id](items);
                    }
                }
                else if(e.data.msg === 'directoryPicked'){
                    // 1 item returned
                    if(e.data.items.length === 1){
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
                    else if(e.data.items.length > 1){
                        // multiple items returned
                        let items = [];
                        for (let index = 0; index < e.data.items.length; index++)
                            items.push(new FSItem(e.data.items[index]))
                        this.#callbackFunctions[e.data.original_msg_id](items);
                    }
                }
                else if(e.data.msg === 'colorPicked'){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.color);
                }
                else if(e.data.msg === 'fontPicked'){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.font); 
                }
                else if(e.data.msg === 'alertResponded'){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.response); 
                }
                else if(e.data.msg === 'promptResponded'){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.response); 
                }
                else if(e.data.msg === 'languageReceived'){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data.language); 
                }
                else if(e.data.msg === "fileSaved"){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](new FSItem(e.data.saved_file)); 
                }
                else if(e.data.msg === "fileSaveCancelled"){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](FILE_SAVE_CANCELLED);
                }
                else if(e.data.msg === "fileOpenCancelled"){
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](FILE_OPEN_CANCELLED);
                }
                else{
                    // execute callback
                    this.#callbackFunctions[e.data.original_msg_id](e.data);
                }

                //remove this callback function since it won't be needed again
                delete this.#callbackFunctions[e.data.original_msg_id];
            }
            // Item Watch response
            else if(e.data.msg === "itemChanged" && e.data.data && e.data.data.uid){
                //excute callback
                if(this.itemWatchCallbackFunctions[e.data.data.uid] && typeof this.itemWatchCallbackFunctions[e.data.data.uid] === 'function')
                    this.itemWatchCallbackFunctions[e.data.data.uid](e.data.data);
            }
            // Broadcasts
            else if (e.data.msg === 'broadcast') {
                const { name, data } = e.data;
                if (!this.#eventNames.includes(name)) {
                    return;
                }
                this.emit(name, data);
                this.#lastBroadcastValue.set(name, data);
            }
            else if ( e.data.msg === 'connection' ) {
                e.data.usesSDK = true; // we can safely assume this
                const conn = AppConnection.from(e.data, this.context);
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
        globalThis.document?.addEventListener('mousemove', async (event)=>{
            // Get the mouse position from the event object
            this.mouseX = event.clientX;
            this.mouseY = event.clientY;

            // send the mouse position to the host environment
            this.messageTarget?.postMessage({
                msg: "mouseMoved",
                appInstanceID: this.appInstanceID,
                x: this.mouseX,
                y: this.mouseY,
            }, '*');
        });

        // click
        globalThis.document?.addEventListener('click', async (event)=>{
            // Get the mouse position from the event object
            this.mouseX = event.clientX;
            this.mouseY = event.clientY;

            // send the mouse position to the host environment
            this.messageTarget?.postMessage({
                msg: "mouseClicked",
                appInstanceID: this.appInstanceID,
                x: this.mouseX,
                y: this.mouseY,
            }, '*');
        })
    }

    onWindowClose = function(callback) {
        this.#onWindowClose = callback;
    }

    onItemsOpened = function(callback) {
        // DEPRECATED - this is also called when items are dropped on the app, which in new versions should be handled
        // with the 'drop' event.
        // Check if a file was opened with this app, i.e. check URL parameters of window/iframe
        // Even though the file has been opened when the app is launched, we need to wait for the onItemsOpened callback to be set
        // before we can call it. This is why we need to check the URL parameters here.
        // This should also be done only the very first time the callback is set (hence the if(!this.#onItemsOpened) check) since
        // the URL parameters will be checked every time the callback is set which can cause problems if the callback is set multiple times.
        if(!this.#onItemsOpened){
            let URLParams = new URLSearchParams(globalThis.location.search);
            if(URLParams.has('puter.item.name') && URLParams.has('puter.item.uid') && URLParams.has('puter.item.read_url')){
                let fpath = URLParams.get('puter.item.path');

                if(!fpath.startsWith('~/') && !fpath.startsWith('/'))
                    fpath = '~/' + fpath;

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
    }

    // Check if the app was launched with items
    // This is useful for apps that are launched with items (e.g. when a file is opened with the app)
    wasLaunchedWithItems = function() {
        const URLParams = new URLSearchParams(globalThis.location.search);
        return URLParams.has('puter.item.name') && 
               URLParams.has('puter.item.uid') && 
               URLParams.has('puter.item.read_url');
    }

    onLaunchedWithItems = function(callback) {
        // Check if a file was opened with this app, i.e. check URL parameters of window/iframe
        // Even though the file has been opened when the app is launched, we need to wait for the onLaunchedWithItems callback to be set
        // before we can call it. This is why we need to check the URL parameters here.
        // This should also be done only the very first time the callback is set (hence the if(!this.#onLaunchedWithItems) check) since
        // the URL parameters will be checked every time the callback is set which can cause problems if the callback is set multiple times.
        if(!this.#onLaunchedWithItems){
            let URLParams = new URLSearchParams(globalThis.location.search);
            if(URLParams.has('puter.item.name') && URLParams.has('puter.item.uid') && URLParams.has('puter.item.read_url')){
                let fpath = URLParams.get('puter.item.path');

                if(!fpath.startsWith('~/') && !fpath.startsWith('/'))
                    fpath = '~/' + fpath;

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
    }

    requestEmailConfirmation = function() {
        return new Promise((resolve, reject) => {
            this.#postMessageWithCallback('requestEmailConfirmation', resolve, {  });
        });
    }

    alert = function(message, buttons, options, callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('ALERT', resolve, { message, buttons, options });
        })
    }

    instancesOpen = function(callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('getInstancesOpen', resolve, {  });
        })
    }

    socialShare = function(url, message, options, callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('socialShare', resolve, { url, message, options });
        })
    }

    prompt = function(message, placeholder, options, callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('PROMPT', resolve, { message, placeholder, options });
        })
    }

    showDirectoryPicker = function(options, callback){
        return new Promise((resolve, reject) => {
            if (!globalThis.open) {
                return reject("This API is not compatible in Web Workers.");
            }
            const msg_id = this.#messageID++;
            if(this.env === 'app'){
                this.messageTarget?.postMessage({
                    msg: "showDirectoryPicker",
                    appInstanceID: this.appInstanceID,
                    uuid: msg_id,
                    options: options,
                    env: this.env,
                }, '*');
            }else{
                let w = 700;
                let h = 400;
                let title = 'Puter: Open Directory';
                var left = (screen.width/2)-(w/2);
                var top = (screen.height/2)-(h/2);
                window.open(`${puter.defaultGUIOrigin}/action/show-directory-picker?embedded_in_popup=true&msg_id=${msg_id}&appInstanceID=${this.appInstanceID}&env=${this.env}&options=${JSON.stringify(options)}`, 
                title, 
                'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left);
            }

            //register callback
            this.#callbackFunctions[msg_id] = resolve;
        })
    }

    showOpenFilePicker = function(options, callback){
        const undefinedOnCancel = new putility.libs.promise.TeePromise();
        const resolveOnlyPromise = new Promise((resolve, reject) => {
            if (!globalThis.open) {
                return reject("This API is not compatible in Web Workers.");
            }
            const msg_id = this.#messageID++;

            if(this.env === 'app'){
                this.messageTarget?.postMessage({
                    msg: "showOpenFilePicker",
                    appInstanceID: this.appInstanceID,
                    uuid: msg_id,
                    options: options ?? {},
                    env: this.env,
                }, '*');
            }else{                
                let w = 700;
                let h = 400;
                let title = 'Puter: Open File';
                var left = (screen.width/2)-(w/2);
                var top = (screen.height/2)-(h/2);
                window.open(`${puter.defaultGUIOrigin}/action/show-open-file-picker?embedded_in_popup=true&msg_id=${msg_id}&appInstanceID=${this.appInstanceID}&env=${this.env}&options=${JSON.stringify(options ?? {})}`, 
                title, 
                'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left);
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
        })
        resolveOnlyPromise.undefinedOnCancel = undefinedOnCancel;
        return resolveOnlyPromise;
    }

    showFontPicker = function(options){
        return new Promise((resolve) => {
            this.#postMessageWithCallback('showFontPicker', resolve, { options: options ?? {} });
        })
    }

    showColorPicker = function(options){
        return new Promise((resolve) => {
            this.#postMessageWithCallback('showColorPicker', resolve, { options: options ?? {} });
        })
    }

    showSaveFilePicker = function(content, suggestedName, type){
        const undefinedOnCancel = new putility.libs.promise.TeePromise();
        const resolveOnlyPromise = new Promise((resolve, reject) => {
            if (!globalThis.open) {
                return reject("This API is not compatible in Web Workers.");
            }
            const msg_id = this.#messageID++;
            if ( ! type && Object.prototype.toString.call(content) === '[object URL]' ) {
                type = 'url';
            }
            const url = type === 'url' ? content.toString() : undefined;
            const source_path = ['move','copy'].includes(type) ? content : undefined;
            
            if(this.env === 'app'){
                this.messageTarget?.postMessage({
                    msg: "showSaveFilePicker",
                    appInstanceID: this.appInstanceID,
                    content: url ? undefined : content,
                    save_type: type,
                    url,
                    source_path,
                    suggestedName: suggestedName ?? '',
                    env: this.env,
                    uuid: msg_id
                }, '*');
            }else{
                window.addEventListener('message', async (e) => {
                    if(e.data?.msg === "sendMeFileData"){
                        // Send the blob URL to the host environment
                        e.source.postMessage({
                            msg: "showSaveFilePickerPopup",
                            content: url ? undefined : content,
                            url: url ? url.toString() : undefined,
                            suggestedName: suggestedName ?? '',
                            env: this.env,
                            uuid: msg_id
                        }, '*');

                        // remove the event listener
                        window.removeEventListener('message', this);
                    }
                });
                // Create a Blob from your binary data
                let blob = new Blob([content], {type: 'application/octet-stream'});

                // Create an object URL for the Blob
                let objectUrl = URL.createObjectURL(blob);

                let w = 700;
                let h = 400;
                let title = 'Puter: Save File';
                var left = (screen.width/2)-(w/2);
                var top = (screen.height/2)-(h/2);
                window.open(`${puter.defaultGUIOrigin}/action/show-save-file-picker?embedded_in_popup=true&msg_id=${msg_id}&appInstanceID=${this.appInstanceID}&env=${this.env}&blobUrl=${encodeURIComponent(objectUrl)}`, 
                title, 
                'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width='+w+', height='+h+', top='+top+', left='+left);
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
        
        resolveOnlyPromise.undefinedOnCancel = undefinedOnCancel;
        
        return resolveOnlyPromise;
    }

    setWindowTitle = function(title, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowTitle', resolve, { new_title: title, window_id: window_id});
        })
    }

    setWindowWidth = function(width, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }
        
        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowWidth', resolve, { width: width, window_id: window_id });
        })
    }

    setWindowHeight = function(height, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }
        
        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowHeight', resolve, { height: height, window_id: window_id });
        })
    }

    setWindowSize = function(width, height, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }
        
        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowSize', resolve, { width: width, height: height, window_id: window_id });
        })
    }

    setWindowPosition = function(x, y, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }
        
        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowPosition', resolve, { x, y, window_id });
        })
    }

    setWindowY = function(y, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowY', resolve, { y, window_id });
        })
    }

    setWindowX = function(x, window_id, callback) {
        if(typeof window_id === 'function'){
            callback = window_id;
            window_id = undefined;
        }else if(typeof window_id === "object" && window_id !== null){
            window_id = window_id.id;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('setWindowX', resolve, { x, window_id });
        })
    }

    setMenubar = function(spec) {
        this.#postMessageWithObject('setMenubar', spec);
    }

    requestPermission = function(options) {
        return new Promise((resolve) => {
            if (this.env === 'app') {
                return new Promise((resolve) => {
                    this.#postMessageWithCallback('requestPermission', resolve, { options });
                })
            } else {
                // TODO: Implement for web
                resolve(false);
            }
        })
    }

    disableMenuItem = function(item_id) {
        this.#postMessageWithObject('disableMenuItem', {id: item_id});
    }

    enableMenuItem = function(item_id) {
        this.#postMessageWithObject('enableMenuItem', {id: item_id});
    }

    setMenuItemIcon = function(item_id, icon) {
        this.#postMessageWithObject('setMenuItemIcon', {id: item_id, icon: icon});
    }

    setMenuItemIconActive = function(item_id, icon) {
        this.#postMessageWithObject('setMenuItemIconActive', {id: item_id, icon: icon});
    }

    setMenuItemChecked = function(item_id, checked) {
        this.#postMessageWithObject('setMenuItemChecked', {id: item_id, checked: checked});
    }

    contextMenu = function(spec) {
        this.#postMessageWithObject('contextMenu', spec);
    }

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
    getEntriesFromDataTransferItems = async function(dataTransferItems, options = { raw: false }) {
        const checkErr = (err) => {
            if (this.getEntriesFromDataTransferItems.didShowInfo) return
            if (err.name !== 'EncodingError') return
            this.getEntriesFromDataTransferItems.didShowInfo = true
            const infoMsg = `${err.name} occurred within datatransfer-files-promise module\n`
                + `Error message: "${err.message}"\n`
                + 'Try serving html over http if currently you are running it from the filesystem.'
            console.warn(infoMsg)
        }

        const readFile = (entry, path = '') => {
            return new Promise((resolve, reject) => {
                entry.file(file => {
                    if (!options.raw) file.filepath = path + file.name // save full path
                    resolve(file)
                }, (err) => {
                    checkErr(err)
                    reject(err)
                })
            })
        }

        const dirReadEntries = (dirReader, path) => {
            return new Promise((resolve, reject) => {
                dirReader.readEntries(async entries => {
                    let files = []
                    for (let entry of entries) {
                        const itemFiles = await getFilesFromEntry(entry, path)
                        files = files.concat(itemFiles)
                    }
                    resolve(files)
                }, (err) => {
                    checkErr(err)
                    reject(err)
                })
            })
        }

        const readDir = async (entry, path) => {
            const dirReader = entry.createReader()
            const newPath = path + entry.name + '/'
            let files = []
            let newFiles
            do {
                newFiles = await dirReadEntries(dirReader, newPath)
                files = files.concat(newFiles)
            } while (newFiles.length > 0)
            return files
        }

        const getFilesFromEntry = async (entry, path = '') => {
            if(entry === null)
                return;
            else if (entry.isFile) {
                const file = await readFile(entry, path)
                return [file]
            }
            else if (entry.isDirectory) {
                const files = await readDir(entry, path)
                files.push(entry)
                return files
            }
        }

        let files = []
        let entries = []

        // Pull out all entries before reading them
        for (let i = 0, ii = dataTransferItems.length; i < ii; i++) {
            entries.push(dataTransferItems[i].webkitGetAsEntry())
        }

        // Recursively read through all entries
        for (let entry of entries) {
            const newFiles = await getFilesFromEntry(entry)
            files = files.concat(newFiles)
        }

        return files
    }

    authenticateWithPuter = function() {
        if(this.env !== 'web'){
            return;
        }

        // if authToken is already present, resolve immediately
        if(this.authToken){
            return new Promise((resolve) => {
                resolve();
            })
        }

        // If a prompt is already open, return a promise that resolves based on the existing prompt's result.
        if (puter.puterAuthState.isPromptOpen) {
            return new Promise((resolve, reject) => {
                puter.puterAuthState.resolver = { resolve, reject };
            });
        }

        // Show the permission prompt and set the state.
        puter.puterAuthState.isPromptOpen = true;
        puter.puterAuthState.authGranted = null;

        return new Promise((resolve, reject) => {
            if (!puter.authToken) {
                const puterDialog = new PuterDialog(resolve, reject);
                document.body.appendChild(puterDialog);
                puterDialog.open();
            } else {
                // If authToken is already present, resolve immediately
                resolve();
            }
        });
    }

    // Returns a Promise<AppConnection>
    /**
     * launchApp opens the specified app in Puter with the specified argumets.
     * @param {*} nameOrOptions - name of the app as a string, or an options object
     * @param {*} args - named parameters that will be passed to the app as arguments
     * @param {*} callback - in case you don't want to use `await` or `.then()`
     * @returns 
     */
    launchApp = async function launchApp(nameOrOptions, args, callback) {
        let pseudonym = undefined;
        let file_paths = undefined;
        let items = undefined;
        let app_name = nameOrOptions; // becomes string after branch below
        
        // Handle case where app_name is an options object
        if (typeof app_name === 'object' && app_name !== null) {
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
            for ( let i=0 ; i < items.length ; i++ ) {
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
        
        return AppConnection.from(app_info, this.context);
    }

    connectToInstance = async function connectToInstance (app_name) {
        const app_info = await this.#ipc_stub({
            method: 'connectToInstance',
            parameters: {
                app_name,
            }
        });

        return AppConnection.from(app_info, this.context);
    }

    parentApp() {
        return this.#parentAppConnection;
    }

    createWindow = function (options, callback) {
        return new Promise((resolve) => {
            this.#postMessageWithCallback('createWindow', (res)=>{
                resolve(res.window);
            }, { options: options ?? {} });
        })
    }

    // Menubar
    menubar = function(){
        // Remove previous style tag
        document.querySelectorAll('style.puter-stylesheet').forEach(function(el) {
            el.remove();
        })

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

        document.addEventListener('click', function(e){
            // Don't hide if clicking on disabled item
            if(e.target.classList.contains('dropdown-item-disabled'))
                return false;
            // Hide open menus
            if(!(e.target).classList.contains('menubar-item')){
                document.querySelectorAll('.menubar-item.menubar-item-open').forEach(function(el) {
                    el.classList.remove('menubar-item-open');
                })

                document.querySelectorAll('.dropdown').forEach(el => el.style.display = "none");
            }
        });

        // When focus is gone from this window, hide open menus
        window.addEventListener('blur', function(e){
            document.querySelectorAll('.dropdown').forEach(function(el) {
                el.style.display = "none";
            })
            document.querySelectorAll('.menubar-item.menubar-item-open').forEach(el => el.classList.remove('menubar-item-open'));
        });

        // Returns the siblings of the element
        const siblings = function (e) {
            const siblings = []; 

            // if no parent, return empty list
            if(!e.parentNode) {
                return siblings;
            }

            // first child of the parent node
            let sibling  = e.parentNode.firstChild;

            // get all other siblings
            while (sibling) {
                if (sibling.nodeType === 1 && sibling !== e) {
                    siblings.push(sibling);
                }
                sibling = sibling.nextSibling;
            }
            return siblings;
        };

        // Open dropdown
        document.querySelectorAll('.menubar-item').forEach(el => el.addEventListener('mousedown', function(e){
            // Hide all other menus
            document.querySelectorAll('.dropdown').forEach(function(el) {
                el.style.display = 'none';
            });
             
            // Remove open class from all menus, except this menu that was just clicked
            document.querySelectorAll('.menubar-item.menubar-item-open').forEach(function(el) {
                if(el != e.target)
                    el.classList.remove('menubar-item-open');
            });
            
            // If menu is already open, close it
            if(this.classList.contains('menubar-item-open')){
                document.querySelectorAll('.menubar-item.menubar-item-open').forEach(function(el) {
                    el.classList.remove('menubar-item-open');
                });
            }

            // If menu is not open, open it
            else if(!e.target.classList.contains('dropdown-item')){
                this.classList.add('menubar-item-open')
        
                // show all sibling
                siblings(this).forEach(function(el) {
                    el.style.display = 'block';
                });
            }

        }));

        // If a menu is open, and you hover over another menu, open that menu
        document.querySelectorAll('.--puter-menubar .menubar-item').forEach(el => el.addEventListener('mouseover', function(e){
            const open_menus = document.querySelectorAll('.menubar-item.menubar-item-open');
            if(open_menus.length > 0 && open_menus[0] !== e.target){
                e.target.dispatchEvent(new Event('mousedown'));
            }
        }))
    }

    on(eventName, callback) {
        super.on(eventName, callback);
        // If we already received a broadcast for this event, run the callback immediately
        if (this.#eventNames.includes(eventName) && this.#lastBroadcastValue.has(eventName)) {
            callback(this.#lastBroadcastValue.get(eventName));
        }
    }

    #showTime = null;
    #hideTimeout = null;

    showSpinner(html) {
        if (this.#overlayActive) return;
    
        // Create and add stylesheet for spinner if it doesn't exist
        if (!document.getElementById('puter-spinner-styles')) {
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
            pointerEvents: 'all'
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
    
    hideSpinner() {
        if (!this.#overlayActive) return;
    
        if (this.#overlayTimer) {
            clearTimeout(this.#overlayTimer);
            this.#overlayTimer = null;
        }
    
        // Calculate how long the spinner has been shown
        const elapsedTime = Date.now() - this.#showTime;
        const remainingTime = Math.max(0, 1200 - elapsedTime);
    
        // If less than 1 second has passed, delay the hide
        if (remainingTime > 0) {
            if (this.#hideTimeout) {
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
    #removeSpinner() {
        const overlay = document.querySelector('.puter-loading-overlay');
        if (overlay) {
            overlay.parentNode?.removeChild(overlay);
        }
    
        this.#overlayActive = false;
        this.#showTime = null;
        this.#hideTimeout = null;
    }

    isWorkingActive() {
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
    getLanguage() {
        // In GUI environment, access the global locale directly
        if(this.env === 'gui'){
            return window.locale;
        }

        return new Promise((resolve) => {
            this.#postMessageWithCallback('getLanguage', resolve, {});
        });
    }
}

export default UI
