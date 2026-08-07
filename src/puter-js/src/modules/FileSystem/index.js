import path from 'path-browserify';
import { io } from 'socket.io-client';
import { PuterModule } from '../../lib/PuterModule.js';
import * as utils from '../../lib/utils.js';

// Constants
//
// The last valid time of the local cache.
const LAST_VALID_TS = 'last_valid_ts';

// Operations
import FSItem from '../FSItem.js';
import copy from './operations/copy.js';
import deleteFSEntry from './operations/deleteFSEntry.js';
import getReadURL from './operations/getReadUrl.js';
import mkdir from './operations/mkdir.js';
import move from './operations/move.js';
import read from './operations/read.js';
import readdir from './operations/readdir.js';
import readdirSubdomains from './operations/readdirSubdomains.js';
import rename from './operations/rename.js';
import revokeReadURL from './operations/revokeReadUrl.js';
import sign from './operations/sign.js';
import space from './operations/space.js';
import stat from './operations/stat.js';
import upload from './operations/upload/index.js';
import write from './operations/write.js';

export class PuterJSFileSystemModule extends PuterModule {

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
    getReadURL = getReadURL;
    revokeReadURL = revokeReadURL;
    readdir = readdir;
    readdirSubdomains = readdirSubdomains;
    stat = stat;

    FSItem = FSItem;

    /**
     * Connects the socket used for cache invalidation and upload progress.
     * Unlike the request-based modules, the socket carries the token from the
     * moment it connects, so it has to be rebuilt whenever auth state changes.
     *
     * @param {import('../../../types/puter').Puter} puter
     */
    constructor (puter) {
        super(puter);
        this.cacheUpdateTimer = null;
        // Connect socket.
        this.initializeSocket();
        puter.onAuthStateChanged(() => this.onAuthStateChanged());
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
    initializeSocket () {
        if ( this.socket ) {
            this.socket.disconnect();
        }

        this.socket = io(this.APIOrigin, {
            auth: {
                auth_token: this.authToken,
            },
            // socket.io's autoUnref path expects ws._socket.unref() to exist.
            // Enable it only for Node runtimes that expose a ws-like WebSocket.
            autoUnref: this.shouldUseSocketAutoUnref(),
            transports: ['websocket', 'polling'],
            withCredentials: true,
        });

        this.bindSocketEvents();
    }

    shouldUseSocketAutoUnref () {
        if ( this.puter.env !== 'nodejs' ) {
            return false;
        }

        const WebSocketImpl = globalThis.WebSocket;
        if ( typeof WebSocketImpl !== 'function' ) {
            return false;
        }

        const wsPrototype = WebSocketImpl.prototype ?? {};
        // ws package instances are EventEmitter-like; Undici WebSocket is EventTarget-like.
        // autoUnref is only safe on the ws path.
        return typeof wsPrototype.on === 'function' &&
            typeof wsPrototype.removeListener === 'function';
    }

    bindSocketEvents () {
        // this.socket.on('cache.updated', (msg) => {
        //     // check original_client_socket_id and if it matches this.socket.id, don't post update
        //     if (msg.original_client_socket_id !== this.socket.id) {
        //         this.invalidateCache();
        //     }
        // });

        this.socket.on('item.renamed', (item) => {
            puter._cache.flushall();
        });

        this.socket.on('item.removed', (item) => {
            // check original_client_socket_id and if it matches this.socket.id, don't invalidate cache
            puter._cache.flushall();
        });

        this.socket.on('item.added', (item) => {
            // remove readdir cache for parent
            puter._cache.del(`readdir:${ path.dirname(item.path)}`);
            // remove item cache for parent directory
            puter._cache.del(`item:${ path.dirname(item.path)}`);
        });

        this.socket.on('item.updated', (item) => {
            puter._cache.flushall();
        });

        this.socket.on('item.moved', (item) => {
            puter._cache.flushall();
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
     * Reconnects the socket against the current token and API origin. Called
     * by the SDK whenever either changes.
     *
     * @memberof [FileSystem]
     * @returns {void}
     */
    onAuthStateChanged () {
        // Check cache timestamp and purge if needed (only in GUI environment)
        if ( this.puter.env === 'gui' ) {
            this.checkCacheAndPurge();
            // Start background task to update LAST_VALID_TS every 1 second
            this.startCacheUpdateTimer();
        }

        this.initializeSocket();
    }

    /**
     * The cache-related actions after local and remote updates.
     *
     * @memberof PuterJSFileSystemModule
     * @returns {void}
     */
    invalidateCache () {
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
    async getCacheTimestamp () {
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
    async checkCacheAndPurge () {
        try {
            const serverTimestamp = await this.getCacheTimestamp();
            const localValidTs = parseInt(localStorage.getItem(LAST_VALID_TS)) || 0;

            if ( serverTimestamp - localValidTs > 2000 ) {
                // Server has newer data, purge local cache
                puter._cache.flushall();
                localStorage.setItem(LAST_VALID_TS, '0');
            }
        } catch ( error ) {
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
    startCacheUpdateTimer () {
        if ( this.puter.env !== 'gui' ) {
            return;
        }

        // The auth token is set more than once over a session, and each call
        // lands here; without clearing first, every call would leave another
        // interval running.
        this.stopCacheUpdateTimer();

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
    stopCacheUpdateTimer () {
        if ( this.cacheUpdateTimer ) {
            clearInterval(this.cacheUpdateTimer);
            this.cacheUpdateTimer = null;
        }
    }
}
