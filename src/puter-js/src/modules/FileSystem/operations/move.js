import path from 'path-browserify';
import { getAbsolutePathOrUidForApp, looksLikeUid } from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';
import stat from './stat.js';

/** @typedef {import('../types.js').MoveOptions} MoveOptions */
/** @typedef {import('../../FSItem.js').FSItem} FSItem */

/**
 * Moves a file or directory to another location. Relative paths resolve
 * against the app's root directory; a UID-shaped string is read as a uid. When
 * `destination` is a directory the item is moved into it under the same name;
 * otherwise the last path component is used as the new name.
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
        const source = getAbsolutePathOrUidForApp(options.source);
        let destination = getAbsolutePathOrUidForApp(options.destination);
        let newName = firstDefined(options, 'newName', 'new_name');

        // A path destination is either a directory to move into or the item's
        // new path; a uid can only be a directory, so it needs no lookup.
        if ( ! newName && ! looksLikeUid(destination) ) {
            let destinationIsDir = false;
            try {
                const destStats = await stat.call(this, destination);
                destinationIsDir = Boolean(destStats.is_dir);
            } catch (e) {
                // Only a missing destination is a new path. A denied or failed
                // lookup must not turn the move into a rename.
                if ( e?.code !== 'subject_does_not_exist' ) {
                    if ( typeof options.error === 'function' ) options.error(e);
                    throw e;
                }
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
                // give the moved item a deduped name ("x (1).txt") instead of
                // conflicting — the "Keep Both" conflict resolution
                dedupe_name: firstDefined(options, 'dedupeName', 'dedupe_name'),
                new_name: newName,
                create_missing_parents: firstDefined(options, 'createMissingParents', 'create_missing_parents'),
                new_metadata: firstDefined(options, 'newMetadata', 'new_metadata'),
                original_client_socket_id: firstDefined(options, 'excludeSocketID', 'original_client_socket_id'),
            },
        };
    },
});

export default move;
