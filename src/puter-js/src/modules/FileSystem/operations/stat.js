import { dedupe } from '../../../lib/networkUtils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { fsRequest, parseOperationArgs } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').StatOptions} StatOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */

// Results larger than this are served but never cached.
const MAX_CACHE_SIZE = 20 * 1024 * 1024;

/**
 * Returns information about a file or directory, addressed by `path`
 * (relative paths resolve against the app's root directory) or by `uid`.
 *
 * With `consistency: 'eventual'` a cached entry may be returned instead of
 * hitting the backend; the default `'strong'` always revalidates.
 *
 * @type {{
 *   (options: StatOptions): Promise<FSItem>,
 *   (
 *     path: string,
 *     options?: StatOptions,
 *     success?: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 *   (
 *     path: string,
 *     success: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 * }}
 */
const stat = async function (...args) {
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

    if ( options.consistency === 'eventual' && !options.returnSubdomains && !options.returnPermissions && !options.returnVersions && !options.returnSize ) {
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
        body.auth_token = this.authToken;

        return fsRequest.call(this, {
            endpoint: '/stat',
            // The token travels in the payload rather than the auth header.
            authHeader: false,
            body,
            success: options.success,
            error: options.error,
            transform: (result) => {
                if ( JSON.stringify(result).length <= MAX_CACHE_SIZE ) {
                    puter._cache.set(cacheKey, result);
                }
                return result;
            },
        });
    });
};

export default stat;
