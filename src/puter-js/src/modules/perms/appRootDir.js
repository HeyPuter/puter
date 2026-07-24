import { PuterJSError } from '../../lib/PuterJSError.js';
import { req } from './lib/req.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */

/**
 * Requests access at the given level to the root directory of one of the
 * user's apps. Tries the request first; if it fails, prompts for the
 * permission and retries (with a short backoff to ride out server-side cache
 * invalidation), returning the fs item on success or `undefined` if denied.
 *
 * @param {import('../../../types/puter').Puter} puter
 * @param {'read' | 'write'} access
 * @param {string | { uid: string }} appUidOrObject
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function requestAppRootDir (puter, access, appUidOrObject) {
    const appUid = (typeof appUidOrObject === 'object' && appUidOrObject !== null)
        ? appUidOrObject.uid
        : appUidOrObject;

    if ( typeof appUid !== 'string' ) {
        throw new PuterJSError('parameter app_uid must be a string', 'invalid_argument');
    }

    let result;
    const fetchIt = async () => {
        result = await req(puter, '/auth/request-app-root-dir', { app_uid: appUid, access });
    };

    await fetchIt();
    if ( ! result.error ) return result;

    const granted = await puter.ui.requestPermission({
        permission: `app-root-dir:${appUid}:${access}`,
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
 * Request read access to the root directory of one of the user's apps.
 *
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid - The app uid, or an object with a `uid`.
 * @returns {Promise<Record<string, unknown> | undefined>} The directory fs item, or `undefined` if denied.
 */
export async function requestReadAppRootDir (appUid) {
    return await requestAppRootDir(this.puter, 'read', appUid);
}

/**
 * Request write access to the root directory of one of the user's apps.
 *
 * @this {PermsModule}
 * @param {string | { uid: string }} appUid - The app uid, or an object with a `uid`.
 * @returns {Promise<Record<string, unknown> | undefined>} The directory fs item, or `undefined` if denied.
 */
export async function requestWriteAppRootDir (appUid) {
    return await requestAppRootDir(this.puter, 'write', appUid);
}
