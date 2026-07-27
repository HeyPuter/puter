import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').RenameOptions} RenameOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */

/**
 * Renames a file or directory. The item can be addressed by `path` (relative
 * paths resolve against the app's root directory) or by `uid`.
 *
 * @type {{
 *   (options: RenameOptions): Promise<FSItem>,
 *   (
 *     path: string,
 *     newName: string,
 *     success?: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 * }}
 */
const rename = defineOperation({
    positional: ['path', 'newName'],
    request (options) {
        const body = {
            original_client_socket_id: firstDefined(options, 'excludeSocketID', 'original_client_socket_id'),
            new_name: firstDefined(options, 'newName', 'new_name'),
        };

        if ( options.uid !== undefined ) {
            body.uid = options.uid;
        } else if ( options.path !== undefined ) {
            body.path = getAbsolutePathForApp(options.path);
        }

        return { endpoint: '/rename', body };
    },
});

export default rename;
