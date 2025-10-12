import io from '../../lib/socket.io/socket.io.esm.min.js';
import * as utils from '../../lib/utils.js';
import path from '../../lib/path.js';

// Constants
// 
// The last valid time of the local cache.
const LAST_VALID_TS = 'last_valid_ts';

// Operations
import copy from './operations/copy.js';
import mkdir from './operations/mkdir.js';
import move from './operations/move.js';
import read from './operations/read.js';
import readdir from './operations/readdir.js';
import rename from './operations/rename.js';
import sign from './operations/sign.js';
import space from './operations/space.js';
import stat from './operations/stat.js';
import symlink from './operations/symlink.js';
import upload from './operations/upload.js';
import write from './operations/write.js';
// Why is this called deleteFSEntry instead of just delete? because delete is
// a reserved keyword in javascript
import { AdvancedBase } from '../../../../putility/index.js';
import FSItem from '../FSItem.js';
import deleteFSEntry from './operations/deleteFSEntry.js';
import getReadURL from './operations/getReadUrl.js';


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
    getReadURL = getReadURL;
    readdir = readdir;
    stat = stat;

    FSItem = FSItem;

    static NARI_METHODS = {
        // stat: {
        //     positional: ['path'],
        //     firstarg_options: true,
        //     async fn (parameters) {
        //         const svc_fs = await this.context.services.aget('filesystem');
        //         return svc_fs.filesystem.stat(parameters);
        //     }
        // },
    };

    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     * and connects to the socket.
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor(context) {
        super();
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
        this.context = context;
        this.cacheUpdateTimer = null;
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
        if ( this.socket ) {
            this.socket.disconnect();
        }

        this.socket = io(this.APIOrigin, {
            auth: {
                auth_token: this.authToken,
            },
            autoUnref: this.context.env === 'nodejs',
        });

        this.bindSocketEvents();
    }

    bindSocketEvents() {
        // this.socket.on('cache.updated', (msg) => {
        //     // check original_client_socket_id and if it matches this.socket.id, don't post update
        //     if (msg.original_client_socket_id !== this.socket.id) {
        //         this.invalidateCache();
        //     }
        // });

        this.socket.on('item.renamed', (item) => {
            puter._cache.flushall();
            console.log('Flushed cache for item.renamed');
        });

        this.socket.on('item.removed', (item) => {
            // check original_client_socket_id and if it matches this.socket.id, don't invalidate cache
            puter._cache.flushall();
            console.log('Flushed cache for item.removed');
        });

        this.socket.on('item.added', (item) => {
            puter._cache.flushall();
            console.log('Flushed cache for item.added');
        });

        this.socket.on('item.updated', (item) => {
            puter._cache.flushall();
            console.log('Flushed cache for item.updated');
        });

        this.socket.on('item.moved', (item) => {
            puter._cache.flushall();
            console.log('Flushed cache for item.moved');
        });

        this.socket.on('connect', () => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Connected', this.socket.id);
            }
        });

        this.socket.on('disconnect', () => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Disconnected');
            }
        });

        this.socket.on('reconnect', (attempt) => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnected', this.socket.id);
            }
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnection Attemps', attempt);
            }
        });

        this.socket.on('reconnect_error', (error) => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnection Error', error);
            }
        });

        this.socket.on('reconnect_failed', () => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnection Failed');
            }
        });

        this.socket.on('error', (error) => {
            if ( puter.debugMode )
            {
                console.error('FileSystem Socket Error:', error);
            }
        });
    }

    /**
     * Sets a new authentication token and resets the socket connection with the updated token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [FileSystem]
     * @returns {void}
     */
    setAuthToken(authToken) {
        this.authToken = authToken;

        // Check cache timestamp and purge if needed (only in GUI environment)
        if (this.context.env === 'gui') {
            this.checkCacheAndPurge();
            // Start background task to update LAST_VALID_TS every 1 second
            this.startCacheUpdateTimer();
        }

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
    setAPIOrigin(APIOrigin) {
        this.APIOrigin = APIOrigin;
        // reset socket
        this.initializeSocket();
    }

    /**
     * The cache-related actions after local and remote updates.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    invalidateCache() {
        // Action: Update last valid time
        // Set to 0, which means the cache is not up to date.
        localStorage.setItem(LAST_VALID_TS, '0');
        puter._cache.flushall();
    }

    /**
     * Calls the cache API to get the last change timestamp from the server.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {Promise<number>} The timestamp from the server
     */
    async getCacheTimestamp() {
        return new Promise((resolve, reject) => {
            const xhr = utils.initXhr('/cache/last-change-timestamp', this.APIOrigin, this.authToken, 'get', 'application/json');
            
            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(xhr, undefined, undefined, async (result) => {
                try {
                    const response = typeof result === 'string' ? JSON.parse(result) : result;
                    resolve(response.timestamp || Date.now());
                } catch (e) {
                    reject(new Error('Failed to parse response'));
                }
            }, reject);

            xhr.send();
        });
    }

    /**
     * Checks cache timestamp and purges cache if needed.
     * Only runs in GUI environment.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    async checkCacheAndPurge() {
        try {
            const serverTimestamp = await this.getCacheTimestamp();
            const localValidTs = parseInt(localStorage.getItem(LAST_VALID_TS)) || 0;
            
            if (serverTimestamp - localValidTs > 2000) {
                console.log('Cache is not up to date, purging cache');
                // Server has newer data, purge local cache
                puter._cache.flushall();
                localStorage.setItem(LAST_VALID_TS, '0');
            }
        } catch (error) {
            // If we can't get the server timestamp, silently fail
            // This ensures the socket initialization doesn't break
            console.error('Error checking cache timestamp:', error);
        }
    }

    /**
     * Starts the background task to update LAST_VALID_TS every 1 second.
     * Only runs in GUI environment.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    startCacheUpdateTimer() {
        if (this.context.env !== 'gui') {
            return;
        }

        // Clear any existing timer
        // this.stopCacheUpdateTimer();

        // Start new timer
        this.cacheUpdateTimer = setInterval(() => {
            localStorage.setItem(LAST_VALID_TS, Date.now().toString());
        }, 1000);
    }

    /**
     * Stops the background cache update timer.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    stopCacheUpdateTimer() {
        if (this.cacheUpdateTimer) {
            clearInterval(this.cacheUpdateTimer);
            this.cacheUpdateTimer = null;
        }
    }
}
