import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').CopyOptions} CopyOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */

/**
 * Copies a file or directory to another location. Relative paths resolve
 * against the app's root directory. When `destination` is a directory the item
 * is copied into it under the same name.
 *
 * @type {{
 *   (options: CopyOptions): Promise<FSItem>,
 *   (
 *     source: string,
 *     destination: string,
 *     options?: CopyOptions,
 *     success?: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 * }}
 */
const copy = defineOperation({
    positional: ['source', 'destination'],
    request (options) {
        return {
            endpoint: '/copy',
            body: {
                original_client_socket_id: this.socket.id,
                socket_id: this.socket.id,
                source: getAbsolutePathForApp(options.source),
                destination: getAbsolutePathForApp(options.destination),
                overwrite: options.overwrite,
                new_name: firstDefined(options, 'newName', 'new_name'),
                // if user is copying an item to where its source is, change the name so there is no conflict
                dedupe_name: firstDefined(options, 'dedupeName', 'dedupe_name'),
            },
        };
    },
});

export default copy;
