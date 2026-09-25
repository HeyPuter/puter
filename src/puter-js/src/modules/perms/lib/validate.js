import { PuterJSError } from '../../../lib/PuterJSError.js';

/** @typedef {import('../types.js').PermsAccess} PermsAccess */
/** @typedef {import('../types.js').PermsFolderName} PermsFolderName */

/** The special folders a permission can be requested for by name. */
export const FOLDER_NAMES = ['Desktop', 'Documents', 'Pictures', 'Videos'];

/**
 * @param {string} message
 * @returns {PuterJSError}
 */
export const invalidArgument = (message) =>
    new PuterJSError(message, 'invalid_argument');

/**
 * @param {unknown} accessLevel
 * @returns {PermsAccess}
 */
export const assertAccess = (accessLevel) => {
    if ( accessLevel !== 'read' && accessLevel !== 'write' ) {
        throw invalidArgument('access must be `read` or `write`');
    }
    return accessLevel;
};

/**
 * @param {unknown} folderName
 * @returns {PermsFolderName}
 */
export const assertFolderName = (folderName) => {
    if ( typeof folderName !== 'string' || ! FOLDER_NAMES.includes(folderName) ) {
        throw invalidArgument(
            `folder name must be one of: ${FOLDER_NAMES.join(', ')}`,
        );
    }
    return /** @type {PermsFolderName} */ (folderName);
};
