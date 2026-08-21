import { PuterJSError } from '../../lib/PuterJSError.js';
import { appRootDirPermission } from './lib/permissionStrings.js';
import { req } from './lib/req.js';
import { invalidArgument } from './lib/validate.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('../../index.js').Puter} Puter */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */

const ROUTE = '/auth/request-app-root-dir';

/** How long to keep re-asking after a grant, and the first gap between tries. */
const MAX_TOTAL_WAIT_MS = 5000;
const FIRST_RETRY_DELAY_MS = 100;

/**
 * The uid out of either accepted form of app identifier.
 *
 * @param {unknown} appUidOrObject
 * @returns {string}
 */
export function appUidOf (appUidOrObject) {
    const appUid = (typeof appUidOrObject === 'object' && appUidOrObject !== null)
        ? /** @type {{ uid?: unknown }} */ (appUidOrObject).uid
        : appUidOrObject;

    if ( typeof appUid !== 'string' ) {
        throw invalidArgument('parameter app_uid must be a string');
    }
    return appUid;
}

/**
 * Ask the server for the app's root directory, which it provisions on the first
 * ask. Resolves the fs item, or a result with `error: true` when the caller may
 * not claim it.
 *
 * @param {Puter} puter
 * @param {string} appUid
 * @param {PermsAccess} access
 * @returns {Promise<Record<string, unknown>>}
 */
export async function statAppRootDir (puter, appUid, access) {
    return await req(puter, ROUTE, { app_uid: appUid, access });
}

/**
 * Whether the caller may claim that app's root directory. Uses the route's
 * read-only mode, so unlike {@link statAppRootDir} it doesn't provision the
 * directory just for being asked about it.
 *
 * A refusal is the answer, and comes back as `false`. Anything else means the
 * question couldn't be asked, which is not the same as "no", so it throws.
 *
 * @param {Puter} puter
 * @param {string} appUid
 * @param {PermsAccess} access
 * @returns {Promise<boolean>}
 */
export async function checkAppRootDir (puter, appUid, access) {
    const result = await req(puter, ROUTE, {
        app_uid: appUid,
        access,
        check: true,
    });
    if ( ! result.error ) return true;
    if ( result.code === 'forbidden' ) return false;
    throw new PuterJSError(
        /** @type {string} */ (result.message) ?? 'app root dir check failed',
        /** @type {string} */ (result.code) ?? 'unknown_error',
    );
}

/**
 * Claim the directory, re-asking with a bounded backoff while the server still
 * refuses. A fresh grant may not have reached the permission cache yet, so the
 * first refusal after one isn't final.
 *
 * @param {Puter} puter
 * @param {string} appUid
 * @param {PermsAccess} access
 * @returns {Promise<Record<string, unknown> | undefined>} The fs item, or
 * `undefined` if the server never allowed it.
 */
export async function pollAppRootDir (puter, appUid, access) {
    let result = await statAppRootDir(puter, appUid, access);

    let delay = FIRST_RETRY_DELAY_MS;
    let totalWaited = 0;
    while ( result.error && totalWaited < MAX_TOTAL_WAIT_MS ) {
        await new Promise(r => setTimeout(r, delay));
        totalWaited += delay;
        result = await statAppRootDir(puter, appUid, access);
        delay = Math.min(
            delay * 2,
            Math.max(FIRST_RETRY_DELAY_MS, MAX_TOTAL_WAIT_MS - totalWaited),
        );
    }

    return result.error ? undefined : result;
}

/**
 * Requests access at the given level to the root directory of one of the
 * user's apps. Tries the request first; if it fails, prompts for the
 * permission and retries (with a short backoff to ride out server-side cache
 * invalidation), returning the fs item on success or `undefined` if denied.
 *
 * @param {Puter} puter
 * @param {PermsAccess} access
 * @param {string | { uid: string }} appUidOrObject
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export async function requestAppRootDirAccess (puter, access, appUidOrObject) {
    const appUid = appUidOf(appUidOrObject);

    const first = await statAppRootDir(puter, appUid, access);
    if ( ! first.error ) return first;

    const granted = await puter.ui.requestPermission({
        permission: appRootDirPermission(appUid, access),
    });
    if ( ! granted ) return undefined;

    return await pollAppRootDir(puter, appUid, access);
}

// -- Deprecated aliases --

/**
 * @deprecated Use `request('appRootDir', { app })`.
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export function requestReadAppRootDir (appUid) {
    return requestAppRootDirAccess(this.puter, 'read', appUid);
}

/**
 * @deprecated Use `request('appRootDir', { app, access: 'write' })`.
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export function requestWriteAppRootDir (appUid) {
    return requestAppRootDirAccess(this.puter, 'write', appUid);
}
