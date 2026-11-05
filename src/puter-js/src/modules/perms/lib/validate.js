import { PuterJSError } from '../../../lib/PuterJSError.js';
import { Folder } from '../constants.js';

/** @typedef {import('../types.js').PermsAccess} PermsAccess */
/** @typedef {import('../types.js').PermsFolderName} PermsFolderName */

/** The special folders a permission can be requested for by name. */
export const FOLDER_NAMES = Object.values(Folder);

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

/**
 * @param {unknown} create
 * @returns {import('../types.js').PermsCreateKind | undefined}
 */
export const assertCreateKind = (create) => {
    if (
        create !== undefined &&
        create !== true &&
        create !== false &&
        create !== 'dir' &&
        create !== 'file'
    ) {
        throw invalidArgument('`create` must be true, false, "dir", or "file"');
    }
    return create;
};

/**
 * Refuses a field the resource doesn't take, so a misspelled option fails
 * instead of being ignored.
 *
 * @param {Record<string, unknown>} details
 * @param {string[]} allowed
 */
export const assertKnownFields = (details, allowed) => {
    for ( const key of Object.keys(details) ) {
        if ( ! allowed.includes(key) ) {
            throw invalidArgument(
                `unknown field: ${key} (expected one of: ${allowed.join(', ')})`,
            );
        }
    }
};
