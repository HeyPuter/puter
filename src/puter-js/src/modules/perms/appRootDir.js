import { appRootDirPermission } from './lib/permissionStrings.js';
import { req } from './lib/req.js';
import { assertAccess, invalidArgument } from './lib/validate.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */

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
 * Ask the server for the app's root directory — the directory when the access
 * is held, an error object when it isn't, so it doubles as a check.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {string} appUid
 * @param {PermsAccess} access
 * @returns {Promise<Record<string, unknown>>}
 */
export async function statAppRootDir (puter, appUid, access) {
    return await req(puter, '/auth/request-app-root-dir', {
        app_uid: appUid,
        access,
    });
}

/**
 * Requests access at the given level to the root directory of one of the
 * user's apps. Tries the request first; if it fails, prompts for the
 * permission and retries (with a short backoff to ride out server-side cache
 * invalidation), returning the fs item on success or `undefined` if denied.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {PermsAccess} access
 * @param {string | { uid: string }} appUidOrObject
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function requestAppRootDirAccess (puter, access, appUidOrObject) {
    const appUid = appUidOf(appUidOrObject);

    let result;
    const fetchIt = async () => {
        result = await statAppRootDir(puter, appUid, access);
    };

    await fetchIt();
    if ( ! result.error ) return result;

    const granted = await puter.ui.requestPermission({
        permission: appRootDirPermission(appUid, access),
    });

    if ( granted ) {
        await fetchIt();

        // If the server has cache-invalidation lag, retry with backoff so this
        // still works. A hack, but also a reasonable safeguard.
        let delay = 100;
        const maxTotalWait = 5000;
        let totalWaited = 0;
        while ( result.error && totalWaited < maxTotalWait ) {
            await new Promise(r => setTimeout(r, delay));
            totalWaited += delay;
            await fetchIt();
            if ( ! result.error ) break;
            delay = Math.min(delay * 2, Math.max(100, maxTotalWait - totalWaited));
        }
    }

    return result.error ? undefined : result;
}

/**
 * Request access to the root directory of one of the user's apps.
 *
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid - The app uid, or an object with a `uid`.
 * @param {PermsAccess} [accessLevel] - Defaults to `'read'`.
 * @returns {Promise<Record<string, unknown> | undefined>} The directory fs item, or `undefined` if denied.
 */
export async function requestAppRootDir (appUid, accessLevel = 'read') {
    const access = assertAccess(accessLevel);
    return await requestAppRootDirAccess(this.puter, access, appUid);
}

// -- Deprecated aliases --

/**
 * @deprecated Use {@link requestAppRootDir} instead.
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export function requestReadAppRootDir (appUid) {
    return this.requestAppRootDir(appUid, 'read');
}

/**
 * @deprecated Use {@link requestAppRootDir} instead.
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export function requestWriteAppRootDir (appUid) {
    return this.requestAppRootDir(appUid, 'write');
}
