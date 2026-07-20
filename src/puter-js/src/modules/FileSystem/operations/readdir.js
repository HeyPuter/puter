import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

// Track in-flight requests to avoid duplicate backend calls
// Each entry stores: { promise, timestamp }
const inflightRequests = new Map();

// Time window (in ms) to group duplicate requests together
// Requests made within this window will share the same backend call
const DEDUPLICATION_WINDOW_MS = 2000; // 2 seconds

const readdir = async function (...args) {
    let options;

    // If first argument is an object, it's the options
    if ( typeof args[0] === 'object' && args[0] !== null ) {
        options = args[0];
    } else {
        // Otherwise, we assume separate arguments are provided
        options = {
            path: args[0],
            success: args[1],
            error: args[2],
        };
    }

    return new Promise(async (resolve, reject) => {
        // consistency levels
        if ( ! options.consistency ) {
            options.consistency = 'strong';
        }

        // Either path or uid is required
        if ( !options.path && !options.uid ) {
            throw new Error({ code: 'NO_PATH_OR_UID', message: 'Either path or uid must be provided.' });
        }

        // Presence of `cursor` (null = first page) or `includeTotal` opts
        // into the paginated `{items, cursor?, total?}` envelope.
        const paginated =
            Object.prototype.hasOwnProperty.call(options, 'cursor') ||
            options.includeTotal === true;

        // Generate cache key based on path or uid. Pages are never cached —
        // the cache stores full listings keyed by path only.
        let cacheKey;
        if ( options.path && !paginated ) {
            cacheKey = `readdir:${ options.path}`;
        }

        if ( options.consistency === 'eventual' && cacheKey ) {
            // Check cache
            const cachedResult = await puter._cache.get(cacheKey);
            if ( cachedResult ) {
                resolve(cachedResult);
                return;
            }
        }

        // Generate deduplication key based on all request parameters
        const deduplicationKey = JSON.stringify({
            path: options.path,
            uid: options.uid,
            no_thumbs: options.no_thumbs,
            no_assocs: options.no_assocs,
            no_subdomains: options.no_subdomains,
            consistency: options.consistency,
            limit: options.limit,
            offset: options.offset,
            cursor: paginated ? (options.cursor ?? null) : undefined,
            includeTotal: options.includeTotal,
            sortBy: options.sortBy,
            sortOrder: options.sortOrder,
        });

        // Check if there's already an in-flight request for the same parameters
        const existingEntry = inflightRequests.get(deduplicationKey);
        const now = Date.now();

        if ( existingEntry ) {
            const timeSinceRequest = now - existingEntry.timestamp;

            // Only reuse the request if it's within the deduplication window
            if ( timeSinceRequest < DEDUPLICATION_WINDOW_MS ) {
                // Wait for the existing request and return its result
                try {
                    const result = await existingEntry.promise;
                    resolve(result);
                } catch ( error ) {
                    reject(error);
                }
                return;
            } else {
                // Request is too old, remove it from the tracker
                inflightRequests.delete(deduplicationKey);
            }
        }

        // Create a promise for this request and store it to deduplicate concurrent calls
        const requestPromise = new Promise(async (resolveRequest, rejectRequest) => {
            // If auth token is not provided and we are in the web environment,
            // try to authenticate with Puter
            if ( !puter.authToken && puter.env === 'web' ) {
                try {
                    await puter.ui.authenticateWithPuter();
                } catch (e) {
                    // if authentication fails, throw an error
                    rejectRequest('Authentication failed.');
                    return;
                }
            }

            // create xhr object
            const xhr = utils.initXhr('/readdir', this.APIOrigin, undefined, 'post', 'text/plain;actually=json');

            // set up event handlers for load and error events
            utils.setupXhrEventHandlers(xhr, options.success, options.error, async (result) => {
                // Calculate the size of the result for cache eligibility check
                const resultSize = JSON.stringify(result).length;

                // Cache the result if it's not bigger than MAX_CACHE_SIZE
                const MAX_CACHE_SIZE = 100 * 1024 * 1024;

                if ( cacheKey && resultSize <= MAX_CACHE_SIZE ) {
                    // UPSERT the cache
                    puter._cache.set(cacheKey, result);
                }

                // set each individual item's cache
                const entries = paginated ? (result?.items ?? []) : result;
                for ( const item of entries ) {
                    puter._cache.set(`item:${ item.path}`, item);
                }

                resolveRequest(result);
            }, rejectRequest);

            // Build request payload - support both path and uid parameters
            const payload = {
                no_thumbs: options.no_thumbs,
                no_assocs: options.no_assocs,
                no_subdomains: options.no_subdomains,
                auth_token: this.authToken,
            };
            if ( options.limit !== undefined ) payload.limit = options.limit;
            if ( options.offset !== undefined ) payload.offset = options.offset;
            if ( options.sortBy !== undefined ) payload.sortBy = options.sortBy;
            if ( options.sortOrder !== undefined ) payload.sortOrder = options.sortOrder;
            if ( paginated ) {
                payload.cursor = options.cursor ?? null;
                if ( options.includeTotal !== undefined ) {
                    payload.includeTotal = options.includeTotal;
                }
            }

            // Add either uid or path to the payload
            if ( options.uid ) {
                payload.uid = options.uid;
            } else if ( options.path ) {
                payload.path = getAbsolutePathForApp(options.path);
            }

            xhr.send(JSON.stringify(payload));
        });

        // Store the promise and timestamp in the in-flight tracker
        inflightRequests.set(deduplicationKey, {
            promise: requestPromise,
            timestamp: now,
        });

        // Wait for the request to complete and clean up
        try {
            const result = await requestPromise;
            inflightRequests.delete(deduplicationKey);
            resolve(result);
        } catch ( error ) {
            inflightRequests.delete(deduplicationKey);
            reject(error);
        }
    });
};

export default readdir;