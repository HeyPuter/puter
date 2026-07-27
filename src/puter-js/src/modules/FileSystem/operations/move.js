import path from 'path-browserify';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';
import stat from './stat.js';

/** @typedef {import('../../../../types/modules/filesystem').MoveOptions} MoveOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */

/**
 * Moves a file or directory to another location. Relative paths resolve
 * against the app's root directory. When `destination` is a directory the item
 * is moved into it under the same name; otherwise the last path component is
 * used as the new name.
 *
 * @type {{
 *   (options: MoveOptions): Promise<FSItem>,
 *   (
 *     source: string,
 *     destination: string,
 *     options?: MoveOptions,
 *     success?: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 * }}
 */
const move = defineOperation({
    positional: ['source', 'destination'],
    async request (options) {
        const source = getAbsolutePathForApp(options.source);
        let destination = getAbsolutePathForApp(options.destination);
        let newName = firstDefined(options, 'newName', 'new_name');

        if ( ! newName ) {
            // Whether the destination names a directory to move into, or the
            // new path of the item itself.
            let destinationIsDir = false;
            try {
                const destStats = await stat.call(this, destination);
                destinationIsDir = Boolean(destStats.is_dir);
            } catch (e) {
                // Destination doesn't exist — treat it as the new path.
            }
            if ( ! destinationIsDir ) {
                newName = path.basename(destination);
                destination = path.dirname(destination);
            }
        }

        return {
            endpoint: '/move',
            body: {
                source,
                destination,
                overwrite: options.overwrite,
                new_name: newName,
                create_missing_parents: firstDefined(options, 'createMissingParents', 'create_missing_parents'),
                new_metadata: firstDefined(options, 'newMetadata', 'new_metadata'),
                original_client_socket_id: firstDefined(options, 'excludeSocketID', 'original_client_socket_id'),
            },
        };
    },
});

export default move;
