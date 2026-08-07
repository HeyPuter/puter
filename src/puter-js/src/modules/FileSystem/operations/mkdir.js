import path from 'path-browserify';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').MkdirOptions} MkdirOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */

/**
 * Creates a directory. Relative paths resolve against the app's root
 * directory.
 *
 * @type {{
 *   (options: MkdirOptions): Promise<FSItem>,
 *   (
 *     dirPath: string,
 *     options?: MkdirOptions,
 *     success?: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 *   (
 *     dirPath: string,
 *     success: (value: FSItem) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<FSItem>,
 * }}
 */
const mkdir = defineOperation({
    positional: ['path'],
    request (options) {
        const absolutePath = getAbsolutePathForApp(options.path);

        return {
            endpoint: '/mkdir',
            body: {
                parent: path.dirname(absolutePath),
                path: path.basename(absolutePath),
                overwrite: options.overwrite ?? false,
                dedupe_name: firstDefined(options, 'dedupeName', 'rename') ?? false,
                shortcut_to: options.shortcutTo,
                original_client_socket_id: this.socket.id,
                create_missing_parents: firstDefined(options, 'createMissingParents', 'recursive') ?? false,
            },
        };
    },
});

export default mkdir;
