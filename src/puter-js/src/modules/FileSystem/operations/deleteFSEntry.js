import { getAbsolutePathOrUidForApp } from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';

/** @typedef {import('../types.js').DeleteOptions} DeleteOptions */

/**
 * Deletes one or more files or directories. Relative paths resolve against the
 * app's root directory; a UID-shaped string is read as a uid.
 *
 * Named `deleteFSEntry` rather than `delete` because `delete` is a reserved
 * keyword; it is exposed as `puter.fs.delete`.
 *
 * @type {{
 *   (options: DeleteOptions): Promise<void>,
 *   (
 *     paths: string | string[],
 *     options?: DeleteOptions,
 *     success?: () => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<void>,
 * }}
 */
const deleteFSEntry = defineOperation({
    positional: ['paths'],
    request (options) {
        // A single path doesn't have to be wrapped in an array by the caller.
        const paths = Array.isArray(options.paths) ? options.paths : [options.paths];

        return {
            endpoint: '/delete',
            body: {
                paths: paths.map((path) => getAbsolutePathOrUidForApp(path)),
                descendants_only: firstDefined(options, 'descendantsOnly', 'descendants_only') ?? false,
                recursive: options.recursive ?? true,
            },
        };
    },
});

export default deleteFSEntry;
