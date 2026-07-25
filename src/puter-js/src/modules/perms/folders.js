/** @typedef {import('./index.js').PermsModule} PermsModule */

/**
 * Requests access to one of the user's special folders, returning its path if
 * access is (or becomes) granted. Read access is inferred from being able to
 * stat the folder; write access always prompts if not already held.
 *
 * @this {PermsModule}
 * @param {string} folderName - Desktop, Documents, Pictures, or Videos.
 * @param {'read' | 'write'} accessLevel
 * @returns {Promise<string | undefined>}
 */
export async function requestFolder_ (folderName, accessLevel) {
    const whoami = await this.puter.auth.whoami();
    const folderPath = `/${whoami.username}/${folderName}`;

    // Being able to stat the folder means we already have at least read access.
    try {
        await this.puter.fs.stat({ path: folderPath });
        if ( accessLevel !== 'write' ) {
            return folderPath;
        }
    } catch (e) {
        // No access yet, fall through to request permission.
    }

    const granted = await this.puter.ui.requestPermission({
        permission: `fs:${folderPath}:${accessLevel}`,
    });
    return granted ? folderPath : undefined;
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestReadDesktop () {
    return this.requestFolder_('Desktop', 'read');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestWriteDesktop () {
    return this.requestFolder_('Desktop', 'write');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestReadDocuments () {
    return this.requestFolder_('Documents', 'read');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestWriteDocuments () {
    return this.requestFolder_('Documents', 'write');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestReadPictures () {
    return this.requestFolder_('Pictures', 'read');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestWritePictures () {
    return this.requestFolder_('Pictures', 'write');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestReadVideos () {
    return this.requestFolder_('Videos', 'read');
}

/** @this {PermsModule} @returns {Promise<string | undefined>} */
export function requestWriteVideos () {
    return this.requestFolder_('Videos', 'write');
}
