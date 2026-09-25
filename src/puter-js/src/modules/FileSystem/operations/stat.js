import { dedupe } from '../../../lib/networkUtils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { fsRequest, parseOperationArgs } from './scaffold.js';
import { toShare } from './shareUtil.js';

/** @typedef {import('../types.js').StatOptions} StatOptions */
/** @typedef {import('../types.js').FSItemRead} FSItemRead */
/** @typedef {import('../types.js').FSItemWithShares} FSItemWithShares */

/**
 * @typedef {{
 *   (options: StatOptions & { returnShares: true }): Promise<FSItemWithShares>,
 *   (options: StatOptions): Promise<FSItemRead>,
 *   (
 *     path: string,
 *     options: StatOptions & { returnShares: true },
 *     success?: (value: FSItemWithShares) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItemWithShares>,
 *   (
 *     path: string,
 *     options?: StatOptions,
 *     success?: (value: FSItemRead) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItemRead>,
 *   (
 *     path: string,
 *     success: (value: FSItemRead) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItemRead>,
 * }} StatOperation
 */

// Results larger than this are served but never cached.
const MAX_CACHE_SIZE = 20 * 1024 * 1024;

/**
 * Returns information about a file or directory, addressed by `path`
 * (relative paths resolve against the app's root directory) or by `uid`.
 *
 * With `consistency: 'eventual'` a cached entry may be returned instead of
 * hitting the backend; the default `'strong'` always revalidates.
 *
 * @this {import('../index.js').PuterJSFileSystemModule}
 * @param {...unknown} args
 * @returns {Promise<FSItemRead>}
 */
const statImpl = async function (...args) {
    const options = parseOperationArgs(args, ['path']);

    // consistency levels
    if ( ! options.consistency ) {
        options.consistency = 'strong';
    }

    // Generate cache key based on path or uid
    let cacheKey;
    if ( options.path ) {
        cacheKey = `item:${ options.path}`;
    }

    if ( options.consistency === 'eventual' && !options.returnSubdomains && !options.returnPermissions && !options.returnVersions && !options.returnSize && !options.returnShares ) {
        const cachedResult = await puter._cache.get(cacheKey);
        if ( cachedResult ) {
            return cachedResult;
        }
    }

    // Requests made with the same parameters share one backend call.
    const deduplicationKey = 'fs:stat:' + JSON.stringify({
        path: options.path,
        uid: options.uid,
        returnSubdomains: options.returnSubdomains || options.returnWorkers,
        returnPermissions: options.returnPermissions,
        returnVersions: options.returnVersions,
        returnSize: options.returnSize,
        returnShares: options.returnShares,
        consistency: options.consistency,
    });

    return await dedupe(deduplicationKey, () => {
        const body = {};
        if ( options.uid !== undefined ) {
            body.uid = options.uid;
        } else if ( options.path !== undefined ) {
            body.path = getAbsolutePathForApp(options.path);
        }

        body.return_subdomains = options.returnSubdomains || options.returnWorkers;
        body.return_permissions = options.returnPermissions;
        body.return_versions = options.returnVersions;
        body.return_size = options.returnSize;
        body.return_shares = options.returnShares;
        body.auth_token = this.authToken;

        return fsRequest.call(this, {
            endpoint: '/stat',
            // The token travels in the payload rather than the auth header.
            authHeader: false,
            body,
            success: options.success,
            error: options.error,
            transform: (result) => {
                if ( Array.isArray(result?.shares) ) {
                    result.shares = result.shares.map(toShare);
                }
                // Not cached — a later plain stat must not serve share data.
                if ( ! options.returnShares && JSON.stringify(result).length <= MAX_CACHE_SIZE ) {
                    puter._cache.set(cacheKey, result);
                }
                return result;
            },
        });
    });
};

const stat = /** @type {StatOperation} */ (statImpl);

export default stat;
