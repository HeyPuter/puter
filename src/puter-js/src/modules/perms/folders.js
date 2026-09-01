import { fsPermission } from './lib/permissionStrings.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('../../index.js').Puter} Puter */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */
/** @typedef {import('./types.js').PermsFolderName} PermsFolderName */

/**
 * Where one of the user's special folders lives. The one place the path is
 * spelled out, so a request and its matching `check` can't name it differently.
 *
 * @param {string} username
 * @param {string} folderName
 * @returns {string}
 */
export function folderPathFor (username, folderName) {
    return `/${username}/${folderName}`;
}

/**
 * Whether the folder can be read already. Being able to stat it is the proof:
 * read access can also come from an ACL grant that no `fs:` permission string
 * names, so the permission tables alone would under-report it.
 *
 * @param {Puter} puter
 * @param {string} folderPath
 * @returns {Promise<boolean>}
 */
export async function folderReadable (puter, folderPath) {
    try {
        await puter.fs.stat({ path: folderPath });
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve a folder request to its path, prompting only when the access isn't
 * already held.
 *
 * @param {Puter} puter
 * @param {string} folderName
 * @param {PermsAccess} accessLevel
 * @returns {Promise<string | undefined>}
 */
export async function requestFolderPath (puter, folderName, accessLevel) {
    const whoami = await puter.auth.whoami();
    const folderPath = folderPathFor(whoami.username, folderName);

    // Read access is inferred from being able to stat the folder.
    if ( accessLevel !== 'write' && await folderReadable(puter, folderPath) ) {
        return folderPath;
    }

    const granted = await puter.ui.requestPermission({
        permission: fsPermission(folderPath, accessLevel),
    });
    return granted ? folderPath : undefined;
}

// -- Deprecated aliases --
//
// Kept so apps written against the old one-method-per-folder surface keep
// working. `requestFolder_` takes any folder name, not just the four the
// supported surface covers, so it stays unvalidated.

/**
 * @deprecated Use `request('folder', { name, access })`.
 * @this {PermsModule}
 * @param {string} folderName
 * @param {PermsAccess} accessLevel
 * @returns {Promise<string | undefined>}
 */
export function requestFolder_ (folderName, accessLevel) {
    return requestFolderPath(this.puter, folderName, accessLevel);
}

/**
 * @deprecated Use `request('folder', { name: 'Desktop' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadDesktop () {
    return requestFolderPath(this.puter, 'Desktop', 'read');
}

/**
 * @deprecated Use `request('folder', { name: 'Desktop', access: 'write' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWriteDesktop () {
    return requestFolderPath(this.puter, 'Desktop', 'write');
}

/**
 * @deprecated Use `request('folder', { name: 'Documents' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadDocuments () {
    return requestFolderPath(this.puter, 'Documents', 'read');
}

/**
 * @deprecated Use `request('folder', { name: 'Documents', access: 'write' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWriteDocuments () {
    return requestFolderPath(this.puter, 'Documents', 'write');
}

/**
 * @deprecated Use `request('folder', { name: 'Pictures' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadPictures () {
    return requestFolderPath(this.puter, 'Pictures', 'read');
}

/**
 * @deprecated Use `request('folder', { name: 'Pictures', access: 'write' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWritePictures () {
    return requestFolderPath(this.puter, 'Pictures', 'write');
}

/**
 * @deprecated Use `request('folder', { name: 'Videos' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestReadVideos () {
    return requestFolderPath(this.puter, 'Videos', 'read');
}

/**
 * @deprecated Use `request('folder', { name: 'Videos', access: 'write' })`.
 * @this {PermsModule}
 * @returns {Promise<string | undefined>}
 */
export function requestWriteVideos () {
    return requestFolderPath(this.puter, 'Videos', 'write');
}
