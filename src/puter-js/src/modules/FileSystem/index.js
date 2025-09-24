import io from '../../lib/socket.io/socket.io.esm.min.js';
import * as utils from '../../lib/utils.js';

// Constants
const LAST_UPDATED_TS = 'last_updated_ts';

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

        // Start cache monitoring
        this.startCacheMonitoring();
    }

    bindSocketEvents() {
        this.socket.on('cache.updated', (item) => {
            const local_ts = puter._cache.get(LAST_UPDATED_TS);
            if (item.ts > local_ts || local_ts === undefined) {
                console.log(`remote timestamp (${item.ts}) is newer than local timestamp (${local_ts}), flushing cache`);
                puter._cache.flushall();
            }
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

            // todo: NAIVE PURGE
            // purge cache on disconnect since we may have become out of sync
            puter._cache.flushall();
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
     * Updates the last updated timestamp in the cache.
     * This should be called whenever file system operations modify the filesystem.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    updateCacheTimestamp() {
        // Add 1 second to mitigate clock skew and disable self-update.
        puter._cache.set(LAST_UPDATED_TS, Date.now() + 1000);
        console.log(`set last updated ts to ${puter._cache.get(LAST_UPDATED_TS)}`);
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
                    resolve(response.timestamp || response.ts || Date.now());
                } catch (e) {
                    reject(new Error('Failed to parse response'));
                }
            }, reject);

            xhr.send();
        });
    }

    /**
     * Starts the cache monitoring service that calls the cache API every 5 seconds.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    startCacheMonitoring() {
        if (this.cacheMonitoringInterval) {
            clearInterval(this.cacheMonitoringInterval);
        }

        this.cacheMonitoringInterval = setInterval(async () => {
            try {
                const remoteTimestamp = await this.getCacheTimestamp();
                const localTimestamp = puter._cache.get(LAST_UPDATED_TS);
                
                if (remoteTimestamp > localTimestamp || localTimestamp === undefined) {
                    console.log(`remote timestamp (${remoteTimestamp}) is newer than local timestamp (${localTimestamp}), flushing cache`);
                    puter._cache.flushall();
                }
            } catch (error) {
                console.error('Failed to get cache timestamp:', error);
            }
        }, 5000);
    }
}
