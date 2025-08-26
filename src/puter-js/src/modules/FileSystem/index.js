import io from '../../lib/socket.io/socket.io.esm.min.js';

// Operations
import space from "./operations/space.js";
import mkdir from "./operations/mkdir.js";
import copy from "./operations/copy.js";
import rename from "./operations/rename.js";
import upload from "./operations/upload.js";
import read from "./operations/read.js";
import move from "./operations/move.js";
import write from "./operations/write.js";
import sign from "./operations/sign.js";
import symlink from './operations/symlink.js';
// Why is this called deleteFSEntry instead of just delete? because delete is 
// a reserved keyword in javascript
import deleteFSEntry from "./operations/deleteFSEntry.js";
import { AdvancedBase } from '../../../../putility/index.js';
import FSItem from '../FSItem.js';
import getReadUrl from './operations/getReadUrl.js';

export class PuterJSFileSystemModule extends AdvancedBase {

    space = space;
    mkdir = mkdir;
    copy = copy;
    rename = rename;
    upload = upload;
    read = read;
    // Why is this called deleteFSEntry instead of just delete? because delete is
    // a reserved keyword in javascript.
    delete = deleteFSEntry;
    move = move;
    write = write;
    sign = sign;
    symlink = symlink;
    getReadUrl = getReadUrl;

    FSItem = FSItem

    static NARI_METHODS = {
        stat: {
            positional: ['path'],
            firstarg_options: true,
            async fn (parameters) {
                const svc_fs = await this.context.services.aget('filesystem');
                return svc_fs.filesystem.stat(parameters);
            }
        },
        readdir: {
            positional: ['path'],
            firstarg_options: true,
            async fn (parameters) {
                const svc_fs = await this.context.services.aget('filesystem');
                return svc_fs.filesystem.readdir(parameters);
            }
        },
    }

    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     * and connects to the socket.
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (context) {
        super();
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
        this.context = context;
        // Connect socket.
        this.initializeSocket();

        // We need to use `Object.defineProperty` instead of passing
        // `authToken` and `APIOrigin` because they will change.
        const api_info = {};
        Object.defineProperty(api_info, 'authToken', {
            get: () => this.authToken,
        });
        Object.defineProperty(api_info, 'APIOrigin', {
            get: () => this.APIOrigin,
        });
    }


    /**
     * Initializes the socket connection to the server using the current API origin.
     * If a socket connection already exists, it disconnects it before creating a new one.
     * Sets up various event listeners on the socket to handle different socket events like
     * connect, disconnect, reconnect, reconnect_attempt, reconnect_error, reconnect_failed, and error.
     *
     * @memberof FileSystem
     * @returns {void}
     */
    initializeSocket() {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.socket = io(this.APIOrigin, {
            auth: {
                auth_token: this.authToken,
            }
        });

        this.bindSocketEvents();
    }

    bindSocketEvents() {
        this.socket.on('connect', () => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Connected', this.socket.id);
        });

        this.socket.on('disconnect', () => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Disconnected');
        });

        this.socket.on('reconnect', (attempt) => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnected', this.socket.id);
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnection Attemps', attempt);
        });

        this.socket.on('reconnect_error', (error) => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnection Error', error);
        });

        this.socket.on('reconnect_failed', () => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnection Failed');
        });

        this.socket.on('error', (error) => {
            if(puter.debugMode)
                console.error('FileSystem Socket Error:', error);
        });
    }

    /**
     * Sets a new authentication token and resets the socket connection with the updated token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [FileSystem]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
        // reset socket
        this.initializeSocket();
    }

    /**
     * Sets the API origin and resets the socket connection with the updated API origin.
     * 
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Apps]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
        // reset socket
        this.initializeSocket();
    }
}
