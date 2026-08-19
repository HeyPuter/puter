import { PuterJSError } from '../../lib/PuterJSError.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */
/** @typedef {import('./types.js').PermsFolderName} PermsFolderName */

/** The special folders a permission can be requested for by name. */
const FOLDERS = ['Desktop', 'Documents', 'Pictures', 'Videos'];

/**
 * Resolve a folder request to its path, prompting only when the access isn't
 * already held.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {string} folderName
 * @param {PermsAccess} accessLevel
 * @returns {Promise<string | undefined>}
 */
async function requestFolderPath (puter, folderName, accessLevel) {
    const whoami = await puter.auth.whoami();
    const folderPath = `/${whoami.username}/${folderName}`;

    // Being able to stat the folder means we already have at least read access.
    try {
        await puter.fs.stat({ path: folderPath });
        if ( accessLevel !== 'write' ) {
            return folderPath;
        }
    } catch (e) {
        // No access yet, fall through to request permission.
    }

    const granted = await puter.ui.requestPermission({
        permission: `fs:${folderPath}:${accessLevel}`,
    });
    return granted ? folderPath : undefined;
}

/**
 * Requests access to one of the user's special folders, returning its path if
 * access is (or becomes) granted. Read access is inferred from being able to
 * stat the folder; write access always prompts if not already held.
 *
 * @this {PermsModule}
 * @param {PermsFolderName} folderName - Desktop, Documents, Pictures, or Videos.
 * @param {PermsAccess} [accessLevel] - Defaults to `'read'`.
 * @returns {Promise<string | undefined>} The folder path, or `undefined` if denied.
 */
export async function requestFolder (folderName, accessLevel = 'read') {
    if ( ! FOLDERS.includes(folderName) ) {
        throw new PuterJSError(
            `parameter folderName must be one of: ${FOLDERS.join(', ')}`,
            'invalid_argument',
        );
    }
    if ( accessLevel !== 'read' && accessLevel !== 'write' ) {
        throw new PuterJSError(
            'parameter accessLevel must be `read` or `write`',
            'invalid_argument',
        );
    }
    return await requestFolderPath(this.puter, folderName, accessLevel);
}

// -- Deprecated aliases --
//
// Kept so apps written against the old one-method-per-folder surface keep
// working. `requestFolder_` bypasses the name check the public method applies,
// preserving its any-folder behavior.

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @param {string} folderName
 * @param {PermsAccess} accessLevel
 * @returns {Promise<string | undefined>}
 */
export function requestFolder_ (folderName, accessLevel) {
    return requestFolderPath(this.puter, folderName, accessLevel);
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadDesktop () {
    return this.requestFolder('Desktop', 'read');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWriteDesktop () {
    return this.requestFolder('Desktop', 'write');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadDocuments () {
    return this.requestFolder('Documents', 'read');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWriteDocuments () {
    return this.requestFolder('Documents', 'write');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadPictures () {
    return this.requestFolder('Pictures', 'read');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWritePictures () {
    return this.requestFolder('Pictures', 'write');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadVideos () {
    return this.requestFolder('Videos', 'read');
}

/**
 * @deprecated Use {@link requestFolder} instead.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWriteVideos () {
    return this.requestFolder('Videos', 'write');
}
